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
    let query = admin
      .from('legacy_seed_fund_grants')
      .select('*')
      .order('academic_year', { ascending: false })
      .order('faculty_name', { ascending: true })

    if (year && year !== 'all') query = query.eq('academic_year', year)
    if (dept && dept !== 'all') query = query.ilike('dept', dept.trim())

    const { data, error } = await query
    if (error) throw error

    // Build complete departments and years list
    const { data: allSeedMeta } = await admin
      .from('legacy_seed_fund_grants')
      .select('dept, academic_year')
      .limit(5000)

    const deptSet = new Set<string>()
    const yearSet = new Set<string>()

    ;(allSeedMeta || []).forEach((r: any) => {
      if (r.dept) {
        const d = String(r.dept).trim()
        if (d && !/^\d+$/.test(d)) deptSet.add(d) // exclude numeric artifact entries if any
      }
      if (r.academic_year) {
        const y = String(r.academic_year).trim()
        if (y && y.includes('-')) yearSet.add(y)
      }
    })

    // Also populate from currently fetched data
    ;(data || []).forEach((r: any) => {
      if (r.dept) {
        const d = String(r.dept).trim()
        if (d && !/^\d+$/.test(d)) deptSet.add(d)
      }
      if (r.academic_year) {
        const y = String(r.academic_year).trim()
        if (y && y.includes('-')) yearSet.add(y)
      }
    })

    const departments = Array.from(deptSet).sort((a, b) => a.localeCompare(b))
    const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a))

    const totalAmount = (data || []).reduce((acc, c) => acc + (Number(c.amount_sanctioned || c.amount) || 0), 0)

    return NextResponse.json({ data: data || [], departments, years, totalAmount })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
