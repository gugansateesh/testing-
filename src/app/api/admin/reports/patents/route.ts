import { NextResponse } from 'next/server'
import { verifyToken, extractToken } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
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
    let query = admin.from('legacy_patents').select('*')
    if (year && year !== 'all') query = query.eq('academic_year', year)
    if (dept && dept !== 'all') query = query.ilike('department', dept.trim())
    if (status && status !== 'all') query = query.ilike('status', `%${status}%`)
    if (startDate) query = query.gte('filed_date', startDate)
    if (endDate) query = query.lte('filed_date', endDate)
    
    // get unique departments for the dropdown
    const { data: allDeptsData } = await admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_patents', p_column_name: 'department' })
    const departments = allDeptsData ? allDeptsData.map((d: any) => d.val).filter(Boolean).sort() : []

    // get unique years for the dropdown
    const { data: allYearsData } = await admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_patents', p_column_name: 'academic_year' })
    const years = allYearsData ? allYearsData.map((y: any) => y.val).filter(Boolean).sort().reverse() : []

    // Fetch all matching rows with pagination to avoid 1000 row limit
    let allData: any[] = []
    let from = 0
    const step = 1000
    while (true) {
      let queryPage = admin.from('legacy_patents').select('*').range(from, from + step - 1)
      if (year && year !== 'all') queryPage = queryPage.eq('academic_year', year)
      if (dept && dept !== 'all') queryPage = queryPage.ilike('department', dept.trim())
      if (status && status !== 'all') queryPage = queryPage.ilike('status', `%${status}%`)
      if (startDate) queryPage = queryPage.gte('filed_date', startDate)
      if (endDate) queryPage = queryPage.lte('filed_date', endDate)

      const { data, error } = await queryPage
      if (error) throw error
      if (data && data.length > 0) {
        allData.push(...data)
        if (data.length < step) break
        from += step
      } else {
        break
      }
    }
    
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
