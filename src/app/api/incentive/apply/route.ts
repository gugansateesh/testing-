import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken } from '@/lib/verifyAuth'
import { calculateIncentive } from '@/lib/incentive'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const admin = createAdminClient()
  
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.split(' ')[1]
  
  const authResult = await verifyToken(token)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = { id: authResult.userId }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { submission_id, legacy_publication_id, category } = body

  if (!submission_id && !legacy_publication_id) {
    return NextResponse.json({ error: 'Missing submission_id or legacy_publication_id' }, { status: 400 })
  }
  if (!category) {
    return NextResponse.json({ error: 'Missing category' }, { status: 400 })
  }

  // Validate required fields per category
  if (category === 'conference' && !body.h_index) {
    return NextResponse.json({ error: 'H-Index is required for Conference applications' }, { status: 400 })
  }
  if (category === 'patent' && (body.patent_type === 'application' || body.patent_type === 'grant')) {
    if (!body.patent_forms_confirmed) {
      return NextResponse.json({ error: 'Patent forms must be confirmed for this application type' }, { status: 400 })
    }
  }
  if (category === 'citation' && !body.citation_count) {
    return NextResponse.json({ error: 'Citation Count is required for Citation Incentive applications' }, { status: 400 })
  }

  const calculationParams = {
    authorCount: body.author_count,
    authorPosition: body.author_position,
    impactFactor: body.impact_factor,
    journalQuartile: body.journal_quartile,
    hIndex: body.h_index,
    publisherTier: body.publisher_tier,
    bookType: body.book_type,
    patentType: body.patent_type,
    citationCount: body.citation_count,
    selfCitationCount: body.self_citation_count
  }

  const { finalAmount } = calculateIncentive(category, calculationParams)

  const payload = {
    applicant_id: user.id,
    category,
    author_count: body.author_count ? Number(body.author_count) : null,
    author_position: body.author_position ? Number(body.author_position) : null,
    impact_factor: body.impact_factor ? Number(body.impact_factor) : null,
    journal_quartile: body.journal_quartile || null,
    h_index: body.h_index ? Number(body.h_index) : null,
    publisher_tier: body.publisher_tier || null,
    book_type: body.book_type || null,
    patent_type: body.patent_type || null,
    patent_forms_confirmed: body.patent_forms_confirmed || false,
    citation_count: body.citation_count ? Number(body.citation_count) : null,
    self_citation_count: body.self_citation_count ? Number(body.self_citation_count) : 0,
    calculated_amount: finalAmount,
    status: 'pending',
    rejection_remark: null,
    reviewed_at: null
  }

  if (submission_id) {
    // Old flow (from active submissions)
    const { data: sub, error: subError } = await admin
      .from('submissions')
      .select('submitted_by, status')
      .eq('id', submission_id)
      .single()

    if (subError || !sub) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }
    
    if (sub.submitted_by !== user.id || sub.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden. Submission must belong to you and be approved.' }, { status: 403 })
    }

    const { data: existing } = await admin
      .from('incentive_applications')
      .select('id, status')
      .eq('submission_id', submission_id)
      .single()

    if (existing) {
      if (existing.status !== 'rejected') {
        return NextResponse.json({ error: 'Application already exists and is not rejected.' }, { status: 400 })
      }
      const { error: updateError } = await admin
        .from('incentive_applications')
        .update({ ...payload, submission_id })
        .eq('id', existing.id)

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    } else {
      const { error: insertError } = await admin
        .from('incentive_applications')
        .insert({ ...payload, submission_id })

      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, amount: finalAmount })
  }

  if (legacy_publication_id) {
    const { data: faculty, error: facErr } = await admin
      .from('master_faculty')
      .select('emp_id, name')
      .eq('user_id', user.id)
      .single()
      
    if (facErr || !faculty) {
      return NextResponse.json({ error: 'User is not mapped to a faculty record.' }, { status: 403 })
    }

    const { data: legacy, error: legErr } = await admin
      .from('legacy_publications')
      .select('*')
      .eq('id', legacy_publication_id)
      .single()

    if (legErr || !legacy) {
      return NextResponse.json({ error: 'Legacy publication not found' }, { status: 404 })
    }

    if (legacy.emp_id !== faculty.emp_id) {
      return NextResponse.json({ error: 'Forbidden. Legacy publication does not belong to you.' }, { status: 403 })
    }

    // Check if submission already exists for this legacy publication (using DOI or Title instead of unmigrated column)
    let existingSub = null;
    if (legacy.doi) {
      const { data: byDoi } = await admin
        .from('submissions')
        .select('id')
        .eq('doi', legacy.doi)
        .maybeSingle()
      existingSub = byDoi
    }
    
    if (!existingSub && legacy.title) {
      const { data: byTitle } = await admin
        .from('submissions')
        .select('id')
        .eq('title', legacy.title)
        .maybeSingle()
      existingSub = byTitle
    }

    if (existingSub) {
      // Update existing incentive app
      const { data: existingInc } = await admin
        .from('incentive_applications')
        .select('id, status')
        .eq('submission_id', existingSub.id)
        .eq('applicant_id', user.id)
        .maybeSingle()

      if (existingInc) {
        if (existingInc.status !== 'rejected') {
          return NextResponse.json({ error: 'Application already exists and is not rejected.' }, { status: 400 })
        }
        
        // Update submission proofs if provided
        const subUpdates: any = {}
        if (body.proof_full_paper_url) subUpdates.proof_full_paper_url = body.proof_full_paper_url
        if (body.proof_scopus_url) subUpdates.proof_scopus_url = body.proof_scopus_url
        if (body.proof_published_url) subUpdates.proof_published_url = body.proof_published_url
        
        if (Object.keys(subUpdates).length > 0) {
          await admin.from('submissions').update(subUpdates).eq('id', existingSub.id)
        }

        const { error: updateError } = await admin
          .from('incentive_applications')
          .update({ ...payload, submission_id: existingSub.id })
          .eq('id', existingInc.id)

        if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
      } else {
        const { error: insertError } = await admin
          .from('incentive_applications')
          .insert({ ...payload, applicant_id: user.id, submission_id: existingSub.id })

        if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, amount: finalAmount })
    } else {
      // Create new submission & incentive sequentially (skipping RPC since it's not pushed)
      const subPayload = {
        title: legacy.title,
        authors: legacy.authors,
        source_title: legacy.source_title,
        volume: body.volume || legacy.volume,
        issue: body.issue || legacy.issue,
        year: legacy.year,
        doi: legacy.doi,
        scopus_link: legacy.link,
        doc_type_scopus: legacy.document_type_scopus,
        doc_type_report: legacy.document_type_report,
        department: legacy.department,
        faculty_name: faculty.name,
        submitted_by: user.id,
        doc_type: legacy.document_type_report, // fallback
        isbn_no: body.isbn_no,
        issn_no: body.issn_no,
        publication_date: body.publication_date,
        proof_full_paper_url: body.proof_full_paper_url,
        proof_scopus_url: body.proof_scopus_url,
        proof_published_url: body.proof_published_url
      }
      
      const { data: newSub, error: subErr } = await admin
        .from('submissions')
        .insert([{ ...subPayload, status: 'approved' }])
        .select('id')
        .single()
        
      if (subErr) {
        console.error('Submission Insert Error:', subErr)
        return NextResponse.json({ error: subErr.message }, { status: 500 })
      }

      const { error: incErr } = await admin
        .from('incentive_applications')
        .insert({
          ...payload,
          applicant_id: user.id,
          submission_id: newSub.id
        })
        
      if (incErr) {
        console.error('Incentive Insert Error:', incErr)
        return NextResponse.json({ error: incErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, amount: finalAmount, submission_id: newSub.id })
    }
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
}
