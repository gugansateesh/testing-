import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const admin = createAdminClient()

  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const year = searchParams.get('year')
  const month = searchParams.get('month')
  const dept = searchParams.get('dept')
  const faculty = searchParams.get('faculty')

  // Select only the columns the UI actually renders
  let query = admin
    .from('incentive_applications')
    .select(`
      id, applicant_id, category, status, calculated_amount,
      author_count, author_position, impact_factor, journal_quartile,
      h_index, publisher_tier, book_type, patent_type, patent_forms_confirmed,
      citation_count, self_citation_count, rejection_remark, created_at, reviewed_at,
      submissions!inner (title, department, faculty_name, doi, issn_no, volume, issue, year)
    `)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  // Push year filter to DB via embedded-resource filter (PostgREST syntax).
  // This is cleaner than a denormalized column since submissions.year is
  // already indexed and avoids any JS post-processing.
  if (year) {
    query = (query as any).eq('submissions.year', parseInt(year))
  }
  if (dept) {
    query = (query as any).eq('submissions.department', dept)
  }
  if (faculty) {
    query = (query as any).ilike('submissions.faculty_name', `%${faculty}%`)
  }

  // Month: filter by created_at month at the DB level using a computed filter.
  // No publication_month column exists, so we use JS post-filter here since
  // PostgREST does not expose date_part/extract for arbitrary WHERE clauses
  // without an RPC. For the scale of this application this is acceptable;
  // if it becomes a bottleneck, add a generated column `created_month SMALLINT
  // GENERATED ALWAYS AS (EXTRACT(MONTH FROM created_at)) STORED` + index.
  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let result = data ?? []

  if (month) {
    result = result.filter((item: any) => {
      const d = new Date(item.created_at)
      return (d.getMonth() + 1).toString() === month
    })
  }

  return NextResponse.json({ data: result })
}
