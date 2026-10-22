import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken } from '@/lib/verifyAuth'

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

  try {
    // 1. Fetch legacy grants
    let legacyQuery = admin.from('research_grants').select('*')
    if (year && year !== 'all') legacyQuery = legacyQuery.eq('academic_year', year)
    if (dept && dept !== 'all') legacyQuery = legacyQuery.ilike('department', dept.trim())
    
    const { data: legacyData, error: legacyError } = await legacyQuery
    if (legacyError) throw legacyError

    // 2. Fetch live approved project grants
    let liveQuery = admin
      .from('project_grant_applications')
      .select('id, research_project_title, funding_agency, co_investigators, project_duration_months, total_proposed_budget, created_at, applicant_id')
      .eq('status', 'approved')

    let liveDataRaw: any[] = []
    try {
      const { data, error: liveError } = await liveQuery
      if (liveError) throw liveError
      liveDataRaw = data || []
    } catch (e: any) {
      console.warn("Could not fetch live grants (table might not exist):", e.message)
    }

    // Manually fetch and join master_faculty
    let liveMapped: any[] = []
    if (liveDataRaw && liveDataRaw.length > 0) {
      const userIds = [...new Set(liveDataRaw.map(a => a.applicant_id))]
      const { data: facultyData } = await admin
        .from('master_faculty')
        .select('user_id, name, dept')
        .in('user_id', userIds)
        
      const facultyMap = (facultyData || []).reduce((acc: any, f: any) => {
        acc[f.user_id] = f
        return acc
      }, {})

      liveMapped = liveDataRaw.map(r => {
        const fac = facultyMap[r.applicant_id] || {}
        const piName = fac.name || 'Unknown'
        const coInv = r.co_investigators ? ` / ${r.co_investigators}` : ''
        const deptStr = fac.dept || ''
        
        // Derive Academic Year from created_at
        const d = new Date(r.created_at)
        const y = d.getFullYear()
        const m = d.getMonth() + 1
        const ay = m >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`

        return {
          id: r.id,
          academic_year: ay,
          department: deptStr,
          pi_co_investigator: `${piName}${coInv}`,
          project_title: r.research_project_title,
          project_type: 'Project Grant',
          funding_agency: r.funding_agency,
          period: r.project_duration_months ? `${r.project_duration_months} months` : null,
          grant_amount: r.total_proposed_budget,
          created_at: r.created_at,
          is_live: true
        }
      })
    }

    // Apply filters to live mapped data
    let filteredLive = liveMapped
    if (year && year !== 'all') {
      filteredLive = filteredLive.filter(r => r.academic_year === year)
    }
    if (dept && dept !== 'all') {
      filteredLive = filteredLive.filter(r => (r.department || '').trim().toLowerCase() === dept.trim().toLowerCase())
    }

    const combined = [...(legacyData || []), ...filteredLive]
    combined.sort((a, b) => {
      const ya = a.academic_year || ''
      const yb = b.academic_year || ''
      if (ya > yb) return -1
      if (ya < yb) return 1
      return 0
    })

    // Fetch distinct values via RPC
    const { data: legacyDepts } = await admin.rpc('get_distinct_column_values', { p_table_name: 'research_grants', p_column_name: 'department' })
    const { data: legacyYears } = await admin.rpc('get_distinct_column_values', { p_table_name: 'research_grants', p_column_name: 'academic_year' })
    
    const deptSet = new Set((legacyDepts || []).map((d: any) => d.val).filter(Boolean))
    const yearSet = new Set((legacyYears || []).map((y: any) => y.val).filter(Boolean))
    
    // Add live derived values
    liveMapped.forEach(r => {
      if (r.department) deptSet.add(r.department)
      if (r.academic_year) yearSet.add(r.academic_year)
    })

    const departments = Array.from(deptSet).sort()
    const years = Array.from(yearSet).sort().reverse()
    const totalAmount = combined.reduce((acc, c) => acc + (Number(c.grant_amount) || 0), 0)

    return NextResponse.json({ data: combined, departments, years, totalAmount })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const { data, error } = await admin
      .from('research_grants')
      .insert(body)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
