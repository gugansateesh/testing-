import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')
  const dept = searchParams.get('dept')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  try {
    // Rows and dropdown option lists are independent — fetch concurrently
    const [allData, { data: allDeptsData }, { data: allYearsData }] = await Promise.all([
      // Fetch all rows (paginate past the 1000-row default limit)
      fetchAllRows(admin, 'legacy_consultancy', '*', q => {
        if (year && year !== 'all') q = q.eq('academic_year', year)
        if (dept && dept !== 'all') q = q.ilike('department', dept.trim())
        if (startDate) q = q.gte('project_date', startDate)
        if (endDate) q = q.lte('project_date', endDate)
        return q
      }),
      // Get unique departments for the dropdown using RPC
      admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_consultancy', p_column_name: 'department' }, { get: true }),
      // Get unique years for the dropdown using RPC
      admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_consultancy', p_column_name: 'academic_year' }, { get: true }),
    ])
    const departments = allDeptsData ? allDeptsData.map((d: any) => d.val).sort() : []
    const years = allYearsData ? allYearsData.map((y: any) => y.val).sort().reverse() : []

    // Sort descending by academic year then project_date
    const result = allData.sort((a: any, b: any) => {
      if (a.academic_year !== b.academic_year) return (b.academic_year || '').localeCompare(a.academic_year || '')
      const da = a.project_date ? new Date(a.project_date).getTime() : 0
      const db = b.project_date ? new Date(b.project_date).getTime() : 0
      return db - da
    })

    const totalAmount = result.reduce((acc, c) => acc + (Number(c.amount) || 0), 0)

    return NextResponse.json({ data: result, departments, years, totalAmount })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
