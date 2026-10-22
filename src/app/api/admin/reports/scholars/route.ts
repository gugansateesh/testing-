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

  try {
    const applyFilters = (baseQuery: any) => {
      let q = baseQuery
      if (year && year !== 'all') {
        const yTrim = year.trim()
        if (/^\d{4}$/.test(yTrim)) {
          // Calendar year matches registration year
          q = q.gte('year_of_registration', `${yTrim}-01-01`).lte('year_of_registration', `${yTrim}-12-31`)
        } else {
          // Academic year format (e.g. 2025-2026)
          q = q.eq('academic_year', yTrim)
        }
      }
      if (dept && dept !== 'all') {
        const dTrim = dept.trim()
        if (dTrim.toUpperCase() === 'MECH' || dTrim.toUpperCase() === 'MECHANICAL') {
          q = q.or('research_centre.ilike.MECH,research_centre.ilike.MECHANICAL')
        } else {
          q = q.ilike('research_centre', dTrim)
        }
      }
      if (startDate) q = q.gte('year_of_registration', startDate)
      if (endDate) q = q.lte('year_of_registration', endDate)
      return q
    }

    // Get unique research centres, academic years, and registration years for dropdowns
    const { data: allScholarsMeta } = await admin
      .from('legacy_research_scholars')
      .select('research_centre, academic_year, year_of_registration')
      .limit(5000)

    const deptSet = new Set<string>()
    const yearSet = new Set<string>()

    ;(allScholarsMeta || []).forEach((r: any) => {
      if (r.research_centre) {
        const d = String(r.research_centre).trim()
        if (d && d !== 'null' && d !== '\\N' && d !== 'undefined') deptSet.add(d)
      }
      if (r.academic_year) {
        const y = String(r.academic_year).trim()
        if (y && y !== 'null' && y !== '\\N' && y !== 'undefined') yearSet.add(y)
      }
      if (r.year_of_registration) {
        const m = String(r.year_of_registration).match(/^(\d{4})/)
        if (m) yearSet.add(m[1])
      }
    })

    const departments = Array.from(deptSet).sort((a, b) => a.localeCompare(b))
    // Sort years descending by year number
    const years = Array.from(yearSet).sort((a, b) => {
      const numA = parseInt(a.slice(0, 4), 10) || 0
      const numB = parseInt(b.slice(0, 4), 10) || 0
      if (numB !== numA) return numB - numA
      return b.localeCompare(a)
    })

    // Pagination for legacy_research_scholars
    let allData: any[] = []
    let from = 0
    const step = 1000
    while (true) {
      let queryPage = applyFilters(
        admin.from('legacy_research_scholars').select('*').range(from, from + step - 1)
      )
      
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
    
    // Sort descending by academic year then year_of_registration
    const result = allData.sort((a: any, b: any) => {
      if (a.academic_year !== b.academic_year) return (b.academic_year || '').localeCompare(a.academic_year || '')
      const da = a.year_of_registration ? new Date(a.year_of_registration).getTime() : 0
      const db = b.year_of_registration ? new Date(b.year_of_registration).getTime() : 0
      return db - da
    })
    
    return NextResponse.json({ data: result, departments, years })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
