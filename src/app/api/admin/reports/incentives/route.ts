import { NextResponse } from 'next/server'
import { verifyToken, extractToken } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Map incentive_applications category to a human-readable publication_type
function categoryToPublicationType(category: string, bookType?: string, patentType?: string): string {
  if (!category) return '—'
  const c = category.toLowerCase()
  if (c === 'book' || c === 'book_chapter') {
    if (!bookType) return 'Book/Book Chapter'
    const bt = bookType.toLowerCase()
    if (bt === 'authored') return 'Authored Book'
    if (bt === 'edited') return 'Edited Book'
    if (bt === 'chapter' || bt === 'book_chapter') return 'Book Chapter'
    return bookType  // fallback to raw value if unknown
  }
  if (c === 'patent') return patentType || 'Patent'
  if (c === 'conference') return 'Conference'
  if (c === 'scopus' || c === 'scopus_publication') return 'Scopus Publication'
  if (c === 'sci') return 'SCI Publication'
  if (c === 'springer' || c === 'springer_elsevier_acm') return 'Springer/Elsevier/ACM'
  if (c === 'citations') return 'Citations'
  // Capitalise first letter for any unknown category
  return category.charAt(0).toUpperCase() + category.slice(1)
}

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
    // ── 1. Legacy imported data ──────────────────────────────────────────────
    let allData: any[] = []
    let from = 0
    const step = 1000
    while (true) {
      let query = admin.from('legacy_incentives').select('*')
      if (year && year !== 'all') query = query.eq('incentive_year', year)
      if (dept && dept !== 'all') query = query.ilike('department', dept.trim())
      if (startDate) query = query.gte('amount_credited_date', startDate)
      if (endDate) query = query.lte('amount_credited_date', endDate)

      const { data, error } = await query.range(from, from + step - 1)
      if (error) throw error
      if (data && data.length > 0) {
        allData.push(...data)
        if (data.length < step) break
        from += step
      } else {
        break
      }
    }

    // ── 2. Live portal approved incentive_applications ───────────────────────
    let appQuery = admin
      .from('incentive_applications')
      .select(`
        id, applicant_id, category, calculated_amount, reviewed_at, created_at,
        book_type, patent_type, publisher_tier,
        submissions!inner (title, department, faculty_name, year)
      `)
      .eq('status', 'approved')

    // Apply dept filter via embedded resource
    if (dept && dept !== 'all') {
      appQuery = (appQuery as any).ilike('submissions.department', dept.trim())
    }

    const { data: appData, error: appError } = await appQuery
    if (appError) throw appError

    // Fetch master_faculty to resolve PhD status for each applicant
    const applicantIds = (appData || []).map((a: any) => a.applicant_id).filter(Boolean)
    let facultyMap = new Map<string, string>()
    if (applicantIds.length > 0) {
      const { data: facultyData } = await admin
        .from('master_faculty')
        .select('user_id, type')
        .in('user_id', applicantIds)
      if (facultyData) {
        facultyData.forEach((f: any) => {
          // type is 'Doctorate', 'Non-Doctorate', 'Doing PhD', etc.
          // Map to same labels used in legacy incentives ('Dr.', 'Doing Phd', etc.)
          let label = '—'
          const t = (f.type || '').toLowerCase()
          if (t === 'doctorate') label = 'Dr.'
          else if (t === 'doing phd' || t === 'doing_phd') label = 'Doing PhD'
          else if (t === 'non-doctorate' || t === 'non_doctorate') label = 'Non-Doctorate'
          else if (f.type) label = f.type
          facultyMap.set(f.user_id, label)
        })
      }
    }

    // Normalise portal applications to match legacy_incentives shape
    const portalRows = (appData || [])
      .filter((a: any) => {
        const sub = Array.isArray(a.submissions) ? a.submissions[0] : a.submissions
        if (!sub) return false
        // Year filter: submissions.year must match
        if (year && year !== 'all' && String(sub.year) !== String(year)) return false
        // Date range filter: use reviewed_at (approval date) as proxy for credited date
        const creditDate = a.reviewed_at || a.created_at
        if (startDate && creditDate && creditDate < startDate) return false
        if (endDate && creditDate && creditDate > endDate) return false
        return true
      })
      .map((a: any) => {
        const sub = Array.isArray(a.submissions) ? a.submissions[0] : a.submissions
        return {
          // Use a prefixed id so the delete button on legacy rows doesn't break
          id: `portal_${a.id}`,
          _source: 'portal',   // flag so UI can optionally distinguish
          incentive_year: sub?.year ? String(sub.year) : null,
          department: sub?.department || null,
          faculty_name: sub?.faculty_name || null,
          paper_title: sub?.title || null,
          publication_type: categoryToPublicationType(a.category, a.book_type, a.patent_type),
          received_amount: a.calculated_amount || null,
          amount_credited_date: a.reviewed_at || a.created_at || null,
          phd_status: facultyMap.get(a.applicant_id) || null,
          file_number: null,
        }
      })

    // ── 3. Merge & deduplicate (portal rows first, then legacy) ──────────────
    const combined = [...portalRows, ...allData]

    // ── 4. Departments and Years dropdown from both sources ───────────────────────────
    const deptMap = new Map<string, string>()
    const yearSet = new Set<string>()

    const addDept = (raw: string | null | undefined) => {
      if (!raw) return
      const trimmed = String(raw).trim()
      if (!trimmed || trimmed.toUpperCase() === 'SELECT') return
      const lower = trimmed.toLowerCase()
      const existing = deptMap.get(lower)
      if (!existing) {
        deptMap.set(lower, trimmed)
      } else if (trimmed === trimmed.toUpperCase() && existing !== existing.toUpperCase()) {
        deptMap.set(lower, trimmed)
      }
    }

    const addYear = (raw: string | number | null | undefined) => {
      if (!raw) return
      const trimmed = String(raw).trim()
      if (trimmed) yearSet.add(trimmed)
    }

    // Fetch distinct metadata from legacy_incentives
    const { data: legacyMeta } = await admin
      .from('legacy_incentives')
      .select('department, incentive_year')
      .limit(10000)

    if (legacyMeta && legacyMeta.length > 0) {
      legacyMeta.forEach((r: any) => {
        addDept(r.department)
        addYear(r.incentive_year)
      })
    }

    // Also populate from currently fetched legacy data to ensure nothing is missed
    allData.forEach((r: any) => {
      addDept(r.department)
      addYear(r.incentive_year)
    })

    // Also populate from live portal rows and submissions
    ;(appData || []).forEach((a: any) => {
      const sub = Array.isArray(a.submissions) ? a.submissions[0] : a.submissions
      if (sub?.department) addDept(sub.department)
      if (sub?.year) addYear(sub.year)
    })

    const { data: liveSubs } = await admin
      .from('submissions')
      .select('department, year')
      .limit(5000)

    if (liveSubs) {
      liveSubs.forEach((s: any) => {
        if (s.department) addDept(s.department)
        if (s.year) addYear(s.year)
      })
    }

    const departments = Array.from(deptMap.values()).sort((a, b) => a.localeCompare(b))
    const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a))

    // ── 5. Sort: newest year first, then by credited date desc ───────────────
    const result = combined.sort((a: any, b: any) => {
      if (a.incentive_year !== b.incentive_year)
        return (b.incentive_year || '').localeCompare(a.incentive_year || '')
      const da = a.amount_credited_date ? new Date(a.amount_credited_date).getTime() : 0
      const db = b.amount_credited_date ? new Date(b.amount_credited_date).getTime() : 0
      return db - da
    })

    const totalAmount = result.reduce((acc, c) => acc + (Number(c.received_amount) || 0), 0)

    return NextResponse.json({ data: result, departments, years, totalAmount })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
