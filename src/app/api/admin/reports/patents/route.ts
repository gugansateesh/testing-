import { NextResponse } from 'next/server'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'

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
  const status = searchParams.get('status')

  try {
    // Dropdown option lists and the matching rows are independent — fetch concurrently
    const [{ data: allDeptsData }, { data: allYearsData }, allData] = await Promise.all([
      // get unique departments for the dropdown
      admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_patents', p_column_name: 'department' }, { get: true }),
      // get unique years for the dropdown
      admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_patents', p_column_name: 'academic_year' }, { get: true }),
      // Fetch all matching rows with pagination to avoid 1000 row limit
      fetchAllRows(admin, 'legacy_patents', '*', q => {
        if (year && year !== 'all') q = q.eq('academic_year', year)
        if (dept && dept !== 'all') q = q.ilike('department', dept.trim())
        if (status && status !== 'all') q = q.ilike('status', `%${status}%`)
        if (startDate) q = q.gte('filed_date', startDate)
        if (endDate) q = q.lte('filed_date', endDate)
        return q
      }),
    ])
    const departments = allDeptsData ? allDeptsData.map((d: any) => d.val).filter(Boolean).sort() : []
    const years = allYearsData ? allYearsData.map((y: any) => y.val).filter(Boolean).sort().reverse() : []
    
    // Sort descending by academic year then filed_date
    const result = allData.sort((a: any, b: any) => {
      if (a.academic_year !== b.academic_year) return (b.academic_year || '').localeCompare(a.academic_year || '')
      const da = a.filed_date ? new Date(a.filed_date).getTime() : 0
      const db = b.filed_date ? new Date(b.filed_date).getTime() : 0
      return db - da
    })
    
    return NextResponse.json({ data: result, departments, years })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
