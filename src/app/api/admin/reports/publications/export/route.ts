import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken } from '@/lib/verifyAuth'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Same mapper used in the main GET route — keep in sync. */
function submissionToPubShape(sub: any) {
  const pubDate: string | null = sub.publication_date || null
  const pubMonth: string | null = pubDate
    ? new Date(pubDate + 'T00:00:00').toLocaleString('en-US', { month: 'long' })
    : null
  return {
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
    link: sub.scopus_link,
    document_type_scopus: sub.doc_type_scopus,
    document_type_report: sub.doc_type_report,
    department: sub.department,
    faculty_name: sub.faculty_name,
    emp_id: sub.emp_id || null,
    is_duplicate: false,
    proof_full_paper_url: sub.proof_full_paper_url || null,
    proof_scopus_url: sub.proof_scopus_url || null,
    proof_published_url: sub.proof_published_url || null,
  }
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
  const month = searchParams.get('month')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const duplicate = searchParams.get('duplicate')

  try {
    // ── 1. Legacy publications (paginated) ────────────────────────────────────
    let legacyRaw: any[] = []
    let hasMore = true
    let page = 0
    const pageSize = 1000

    while (hasMore) {
      let query = admin.from('legacy_publications').select('*').range(page * pageSize, (page + 1) * pageSize - 1)
      if (year && year !== 'all') query = query.eq('year', parseInt(year))
      if (dept && dept !== 'all') query = query.ilike('department', dept.trim())
      if (month && month !== 'all') query = query.eq('publication_month', month)
      if (startDate) query = query.gte('publication_date', startDate)
      if (endDate) query = query.lte('publication_date', endDate)
      if (duplicate && duplicate !== 'all') query = query.eq('is_duplicate', duplicate === 'yes')

      const { data: pageData, error } = await query
      if (error) throw error

      if (pageData && pageData.length > 0) {
        legacyRaw = [...legacyRaw, ...pageData]
        if (pageData.length < pageSize) hasMore = false
        else page++
      } else {
        hasMore = false
      }
    }

    // ── 2. Approved submissions ───────────────────────────────────────────────
    let subsQuery = admin.from('submissions').select('*').eq('status', 'approved')
    if (year && year !== 'all') subsQuery = subsQuery.eq('year', parseInt(year))
    if (dept && dept !== 'all') subsQuery = subsQuery.ilike('department', dept.trim())

    const { data: subsData } = await subsQuery
    const mappedSubs = (subsData || []).map(submissionToPubShape)

    const filteredSubs = mappedSubs.filter(s => {
      if (startDate && s.publication_date && s.publication_date < startDate) return false
      if (endDate && s.publication_date && s.publication_date > endDate) return false
      if (duplicate === 'yes') return false // live subs are never duplicates
      return true
    })

    // ── 3. Safe DOI dedup (non-empty DOIs only; blank/null always kept) ───────
    const legacyDoiSet = new Set<string>()
    for (const row of legacyRaw) {
      const doi = (row.doi || '').trim()
      if (doi) legacyDoiSet.add(doi.toLowerCase())
    }
    const deduplicatedSubs = filteredSubs.filter(s => {
      const doi = (s.doi || '').trim()
      if (!doi) return true
      return !legacyDoiSet.has(doi.toLowerCase())
    })

    // ── 4. Merge & sort ───────────────────────────────────────────────────────
    // Legacy rows: ensure the three proof fields are null (historical imports have none)
    const legacyNormalized = legacyRaw.map(r => ({
      ...r,
      proof_full_paper_url: null,
      proof_scopus_url: null,
      proof_published_url: null,
    }))

    const combined = [...legacyNormalized, ...deduplicatedSubs].sort((a, b) => {
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0)
      if (a.publication_date && b.publication_date) {
        return new Date(b.publication_date).getTime() - new Date(a.publication_date).getTime()
      }
      if (a.publication_date) return -1
      if (b.publication_date) return 1
      if (a.s_no !== null && b.s_no !== null) return (a.s_no || 0) - (b.s_no || 0)
      return (a.faculty_name || '').localeCompare(b.faculty_name || '')
    })

    // ── 5. Build Excel workbook ───────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Publications')

    const headers = [
      'S.No', 'Authors', 'Title', 'Source Title', 'Volume', 'Issue',
      'Year', 'Month', 'Date', 'DOI', 'Duplicates', 'Link',
      'Full Paper Link', 'Scopus Proof Link', 'Published Proof Link',
      'Document Type Scopus', 'Document Type Report', 'Department', 'Faculty Name', 'Emp ID'
    ]

    const headerRow = ws.addRow(headers)
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
    })
    headerRow.height = 30

    const colWidths = [10, 30, 40, 30, 15, 15, 15, 15, 15, 30, 15, 40, 40, 40, 40, 25, 25, 20, 20, 20]
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

    combined.forEach((row, idx) => {
      const dataRow = ws.addRow([
        idx + 1,
        row.authors || '',
        row.title || '',
        row.source_title || '',
        row.volume || '',
        row.issue || '',
        row.year || '',
        row.publication_month || '',
        row.publication_date || '',
        row.doi || '',
        row.is_duplicate ? 'Yes' : 'No',
        row.link || '',
        row.proof_full_paper_url || '',
        row.proof_scopus_url || '',
        row.proof_published_url || '',
        row.document_type_scopus || '',
        row.document_type_report || '',
        row.department || '',
        row.faculty_name || '',
        row.emp_id || '',
      ])

      // Make proof URL cells clickable hyperlinks when present
      ;[13, 14, 15].forEach(colIdx => {
        const cell = dataRow.getCell(colIdx)
        const urlVal = cell.value as string
        if (urlVal) {
          cell.value = { text: 'View', hyperlink: urlVal } as any
          cell.font = { color: { argb: 'FF0000FF' }, underline: true }
        }
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Publications_Export_${new Date().toISOString().split('T')[0]}.xlsx"`
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
