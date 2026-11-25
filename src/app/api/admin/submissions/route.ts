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
  const dept = searchParams.get('dept')
  const year = searchParams.get('year')
  const status = searchParams.get('status')
  const faculty = searchParams.get('faculty')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = 20

  let query = admin
    .from('submissions')
    // 'estimated' uses Postgres planner statistics — much cheaper than COUNT(*)
    // at scale. Slightly approximate right after bulk inserts/deletes, but
    // acceptable for UI pagination. Do NOT use for anything requiring exactness.
    .select('*', { count: 'estimated' })
    .order('s_no', { ascending: true })
    .range((page - 1) * limit, page * limit - 1)

  if (dept) query = query.eq('department', dept)
  if (year) query = query.eq('year', parseInt(year))
  if (status) query = query.eq('status', status)
  if (faculty) query = query.ilike('faculty_name', `%${faculty}%`)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, total: count, page, limit })
}
