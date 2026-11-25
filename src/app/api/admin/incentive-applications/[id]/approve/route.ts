import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { calculateIncentive } from '@/lib/incentive'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const params = await props.params;
  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any = {}
  try {
    body = await request.json()
  } catch {}

  const { data: existing, error: fetchError } = await admin
    .from('incentive_applications')
    .select('*')
    .eq('id', params.id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  }

  const payload: any = {
    status: 'approved',
    rejection_remark: null,
    reviewed_at: new Date().toISOString()
  }

  // Update overrides if provided
  let overrideCount = false
  const updatedParams = {
    authorCount: existing.author_count,
    authorPosition: existing.author_position,
    impactFactor: existing.impact_factor,
    journalQuartile: existing.journal_quartile,
    hIndex: existing.h_index,
    publisherTier: existing.publisher_tier,
    bookType: existing.book_type,
    patentType: existing.patent_type,
    citationCount: existing.citation_count,
    selfCitationCount: existing.self_citation_count
  }

  if (body.author_count !== undefined) {
    updatedParams.authorCount = Number(body.author_count)
    payload.author_count = updatedParams.authorCount
    overrideCount = true
  }
  if (body.author_position !== undefined) {
    updatedParams.authorPosition = Number(body.author_position)
    payload.author_position = updatedParams.authorPosition
    overrideCount = true
  }
  if (body.impact_factor !== undefined) {
    updatedParams.impactFactor = Number(body.impact_factor)
    payload.impact_factor = updatedParams.impactFactor
    overrideCount = true
  }
  if (body.journal_quartile !== undefined) {
    updatedParams.journalQuartile = body.journal_quartile
    payload.journal_quartile = updatedParams.journalQuartile
    overrideCount = true
  }
  if (body.h_index !== undefined) {
    updatedParams.hIndex = Number(body.h_index)
    payload.h_index = updatedParams.hIndex
    overrideCount = true
  }
  if (body.publisher_tier !== undefined) {
    updatedParams.publisherTier = body.publisher_tier
    payload.publisher_tier = updatedParams.publisherTier
    overrideCount = true
  }
  if (body.book_type !== undefined) {
    updatedParams.bookType = body.book_type
    payload.book_type = updatedParams.bookType
    overrideCount = true
  }
  if (body.patent_type !== undefined) {
    updatedParams.patentType = body.patent_type
    payload.patent_type = updatedParams.patentType
    overrideCount = true
  }
  if (body.citation_count !== undefined) {
    updatedParams.citationCount = Number(body.citation_count)
    payload.citation_count = updatedParams.citationCount
    overrideCount = true
  }
  if (body.self_citation_count !== undefined) {
    updatedParams.selfCitationCount = Number(body.self_citation_count)
    payload.self_citation_count = updatedParams.selfCitationCount
    overrideCount = true
  }

  if (overrideCount) {
    const { finalAmount } = calculateIncentive(existing.category, updatedParams)
    payload.calculated_amount = finalAmount
  }

  const { error } = await admin
    .from('incentive_applications')
    .update(payload)
    .eq('id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, amount: payload.calculated_amount || existing.calculated_amount })
}
