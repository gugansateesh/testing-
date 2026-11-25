import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import ExcelJS from 'exceljs'
import { Submission } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const admin = createAdminClient()

  // extractToken checks Authorization header first, then ?token= query param
  // (the query-param fallback is needed for <a href> download links that
  // cannot set custom headers)
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch all submissions
  const { data, error } = await admin
    .from('submissions')
    .select('*')
    .eq('status', 'approved')
    .order('s_no', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Build Excel workbook
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Research Publication Portal'
  workbook.created = new Date()

  const ws = workbook.addWorksheet('Submissions')

  // Define exact 19-column headers as per requirement
  const headers = [
    'S.No',
    'Authors',
    'Title',
    'Source title',
    'Volume',
    'Issue',
    'Year',
    'DOI',
    'Link to the Scopus Page',
    'Document Type in Scopus',
    'Document Type',
    'Document Type as per Report',
    'Department',
    'Name of the Faculty',
    'ISBN No.',
    'ISSN No',
    'Proof of the Full Paper',
    'Scopus Page of the Paper',
    'Published Proof',
  ]

  ws.addRow(headers)

  // Style header row
  const headerRow = ws.getRow(1)
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD1D5DB' }, // light gray
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    }
  })
  headerRow.height = 30

  // Column widths
  const colWidths = [8, 30, 40, 30, 10, 10, 8, 35, 35, 25, 25, 25, 25, 25, 18, 18, 35, 35, 35]
  colWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  // Data rows
  ;(data as Submission[]).forEach((row, idx) => {
    const dataRow = ws.addRow([
      row.s_no,
      row.authors,
      row.title,
      row.source_title,
      row.volume,
      row.issue,
      row.year,
      row.doi,
      row.scopus_link,
      row.doc_type_scopus,
      row.doc_type,
      row.doc_type_report,
      row.department,
      row.faculty_name,
      row.isbn_no,
      row.issn_no,
      row.proof_full_paper_url,
      row.proof_scopus_url,
      row.proof_published_url,
    ])
    dataRow.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      }
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      }
    })
    dataRow.height = 22
  })

  // Freeze top row
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const uint8 = new Uint8Array(buffer as ArrayBuffer)
  const filename = `submissions_${new Date().toISOString().split('T')[0]}.xlsx`

  return new NextResponse(uint8, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': uint8.byteLength.toString(),
      'Cache-Control': 'no-store',
    },
  })
}
