import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const empId = searchParams.get('emp_id')

  if (!empId) return NextResponse.json({ error: 'emp_id required' }, { status: 400 })

  const admin = createAdminClient()

  // Fetch Publications (from legacy_publications by emp_id)
  const { data: publications } = await admin
    .from('legacy_publications')
    .select('id, title, source_title, year, document_type_report, doi, department, authors, link, is_duplicate')
    .eq('emp_id', empId)
    .order('year', { ascending: false })
    .limit(100)

  // Fetch live approved submissions too
  const { data: livePublications } = await admin
    .from('submissions')
    .select('id, title, source_title, year, doc_type_report, doi, department')
    .eq('submitted_by', auth.id)
    .eq('status', 'approved')
    .order('year', { ascending: false })

  // Fetch Patents (from legacy_patents by emp_id — will be empty until patents are mapped)
  const { data: patents } = await admin
    .from('legacy_patents')
    .select('id, title, inventors, status, filed_date, publication_or_grant_number, department')
    .eq('emp_id', empId)
    .order('filed_date', { ascending: false })
    .limit(100)

  // Fetch Incentive Applications (by user id)
  const { data: incentives } = await admin
    .from('incentive_applications')
    .select('id, category, status, calculated_amount, created_at, submissions(id, title, doi)')
    .eq('applicant_id', auth.id)
    .order('created_at', { ascending: false })
    .limit(500)

  // Also fetch the cutoff year setting
  const { data: cutoffSetting } = await admin.from('app_settings').select('value').eq('key', 'incentive_eligible_from_year').single()
  const cutoff = cutoffSetting?.value ? Number(cutoffSetting.value) : undefined

  // Fetch Seed Fund Applications (by user id)
  const { data: seedFunds } = await admin
    .from('seed_fund_applications')
    .select('id, project_title, status, created_at, phase')
    .eq('applicant_id', auth.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Fetch Consultancy (by user id — table may not have emp_id yet)
  const { data: consultancy } = await admin
    .from('consultancy_projects')
    .select('id, title, client_name, amount, status, created_at')
    .eq('submitted_by', auth.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Fetch Project Grants (by user id)
  const { data: projectGrants } = await admin
    .from('project_grants')
    .select('id, title, funding_agency, amount, status, created_at')
    .eq('submitted_by', auth.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const legacyMapped = (publications || []).map(p => ({ ...p, _source: 'legacy' }))
  
  const liveMapped = (livePublications || [])
    .filter(livePub => {
      // Don't show live publication if it's already in legacy publications (prevents duplication)
      return !legacyMapped.some(legPub => 
        (livePub.doi && legPub.doi === livePub.doi) || 
        (livePub.title && legPub.title === livePub.title)
      )
    })
    .map(p => ({
      ...p,
      document_type_report: p.doc_type_report,
      _source: 'live'
    }))

  const allPublications = [...legacyMapped, ...liveMapped].sort((a, b) => (b.year || 0) - (a.year || 0))

  return NextResponse.json({
    publications: allPublications,
    patents: patents || [],
    incentives: incentives || [],
    seed_funds: seedFunds || [],
    consultancy: consultancy || [],
    project_grants: projectGrants || [],
    cutoff_year: cutoff,
  })
}
