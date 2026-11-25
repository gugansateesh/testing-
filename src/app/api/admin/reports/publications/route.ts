import { NextResponse } from 'next/server'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Map an approved `submissions` row to the same shape as a `legacy_publications` row.
 * Column names differ in 3 places:
 *   submissions.scopus_link       → legacy_publications.link
 *   submissions.doc_type_scopus   → legacy_publications.document_type_scopus
 *   submissions.doc_type_report   → legacy_publications.document_type_report
 */
function submissionToPubShape(sub: any) {
  const pubDate: string | null = sub.publication_date || null
  const pubMonth: string | null = pubDate
    ? new Date(pubDate + 'T00:00:00').toLocaleString('en-US', { month: 'long' })
    : null

  return {
    id: sub.id,
    s_no: null,
    authors: sub.authors,
    title: sub.title,
    source_title: sub.source_title,
    volume: sub.volume,
    issue: sub.issue,
    year: sub.year,
    publication_month: pubMonth,
    publication_date: pubDate,
    doi: sub.doi,
    link: sub.scopus_link,                       // column rename
    document_type_scopus: sub.doc_type_scopus,   // column rename
    document_type_report: sub.doc_type_report,   // column rename
    department: sub.department,
    faculty_name: sub.faculty_name,
    is_duplicate: false,
    proof_full_paper_url: sub.proof_full_paper_url || null,
    proof_scopus_url: sub.proof_scopus_url || null,
    proof_published_url: sub.proof_published_url || null,
    _source: 'live' as const,
  }
}

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')
  const dept = searchParams.get('dept')
  const month = searchParams.get('month')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const duplicate = searchParams.get('duplicate')

  try {
    const admin = createAdminClient()

    // ── 1+2. Fetch legacy_publications, approved submissions and the filter
    // option lists concurrently ────────────────────────────────────────────────
    // Apply the same year/dept/month/date filters that apply to legacy rows.
    // The `duplicate` filter does not apply to live submissions (they're never duplicates).
    // month/startDate/endDate are based on publication_date — handle gracefully if column missing
    // We select publication_date but don't filter on it server-side;
    // it's used only for display and client-side month derivation.
    const [legacyRaw, subsResult, legacyDeptsRes, legacyYearsRes, legacyMonthsRes] = await Promise.all([
      fetchAllRows(admin, 'legacy_publications', '*', q => {
        if (year && year !== 'all') q = q.eq('year', parseInt(year))
        if (dept && dept !== 'all') q = q.ilike('department', dept.trim())
        if (month && month !== 'all') q = q.eq('publication_month', month)
        if (startDate) q = q.gte('publication_date', startDate)
        if (endDate) q = q.lte('publication_date', endDate)
        if (duplicate && duplicate !== 'all') q = q.eq('is_duplicate', duplicate === 'yes')
        return q
      }),
      fetchAllRows(admin, 'submissions', '*', q => {
        q = q.eq('status', 'approved')
        if (year && year !== 'all') q = q.eq('year', parseInt(year))
        if (dept && dept !== 'all') q = q.ilike('department', dept.trim())
        return q
      }).then(data => ({ data, error: null as any }), error => ({ data: null as any[] | null, error })),
      admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_publications', p_column_name: 'department' }, { get: true }),
      admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_publications', p_column_name: 'year' }, { get: true }),
      admin.rpc('get_distinct_column_values', { p_table_name: 'legacy_publications', p_column_name: 'publication_month' }, { get: true }),
    ])

    const { data: subsData, error: subsError } = subsResult
    if (subsError) {
      // If publication_date column doesn't exist yet, still return data without it
      console.warn('Submissions fetch warning:', subsError.message)
    }
    const approvedSubs: any[] = (subsData || []).map(submissionToPubShape)

    // Apply startDate/endDate filter on the mapped live rows (client-side, safe)
    const filteredSubs = approvedSubs.filter(s => {
      if (startDate && s.publication_date && s.publication_date < startDate) return false
      if (endDate && s.publication_date && s.publication_date > endDate) return false
      // If duplicate=yes filter is active, exclude all live submissions (they are never duplicates)
      if (duplicate === 'yes') return false
      return true
    })

    // ── 3. Safe DOI-based deduplication ──────────────────────────────────────
    // RULE: Only deduplicate when BOTH rows have a non-empty, trimmed, matching DOI.
    // Rows with blank/null DOI on EITHER side are NEVER deduplicated — they are
    // always kept as distinct records, regardless of how many blank-DOI rows exist.
    //
    // This prevents silent data loss in legacy_publications where many historical
    // imports have blank DOIs (conference papers, book chapters, etc.).
    const legacyDoiSet = new Set<string>()
    for (const row of legacyRaw) {
      const doi = (row.doi || '').trim()
      if (doi) legacyDoiSet.add(doi.toLowerCase())
    }

    // Exclude live submissions whose DOI already exists in legacy (legacy wins)
    const deduplicatedSubs = filteredSubs.filter(s => {
      const doi = (s.doi || '').trim()
      if (!doi) return true // blank DOI → always keep
      return !legacyDoiSet.has(doi.toLowerCase())
    })

    // ── 4. Merge and sort ─────────────────────────────────────────────────────
    const combined = [...legacyRaw, ...deduplicatedSubs]

    // Sort: year desc, then publication_date desc, then faculty_name asc
    combined.sort((a, b) => {
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0)
      if (a.publication_date && b.publication_date) {
        return new Date(b.publication_date).getTime() - new Date(a.publication_date).getTime()
      }
      if (a.publication_date) return -1
      if (b.publication_date) return 1
      if (a.s_no !== null && b.s_no !== null) return (a.s_no || 0) - (b.s_no || 0)
      return (a.faculty_name || '').localeCompare(b.faculty_name || '')
    })

    // ── 5. Compute filter option lists from combined set ───────────────────────
    const legacyDepts = legacyDeptsRes.data
    const legacyYears = legacyYearsRes.data
    const legacyMonths = legacyMonthsRes.data

    const deptSet = new Set<string>((legacyDepts || []).map((d: any) => (d.val || '').toUpperCase().trim()).filter(Boolean))
    const yearSet = new Set<string>((legacyYears || []).map((y: any) => String(y.val)).filter(Boolean))
    const monthSet = new Set<string>((legacyMonths || []).map((m: any) => m.val).filter(Boolean))

    deduplicatedSubs.forEach(s => {
      if (s.department) deptSet.add(s.department.toUpperCase().trim())
      if (s.year) yearSet.add(String(s.year))
      if (s.publication_month) monthSet.add(s.publication_month)
    })

    const departments = Array.from(deptSet).sort()
    const years = Array.from(yearSet).sort().reverse()
    const months = Array.from(monthSet).sort()

    console.log(
      `Publications API: legacy=${legacyRaw.length}, approved_subs=${approvedSubs.length}, ` +
      `after_dedup=${deduplicatedSubs.length}, combined=${combined.length}`
    )

    return NextResponse.json({ data: combined, departments, years, months })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
