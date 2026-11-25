import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const admin = createAdminClient()

  const url = new URL(request.url)
  const year = url.searchParams.get('year')
  const month = url.searchParams.get('month')

  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch approved incentive applications — push year to DB, month in JS
  let query = admin
    .from('incentive_applications')
    .select(`
      *,
      submissions!inner (title, department, faculty_name, doi, issn_no, volume, issue, year, created_at)
    `)
    .eq('status', 'approved')
    .order('created_at', { ascending: true })

  if (year) {
    query = (query as any).eq('submissions.year', parseInt(year))
  }

  let { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (data && month) {
    data = data.filter((item: any) => {
      const date = new Date(item.created_at)
      return (date.getMonth() + 1).toString() === month
    })
  }

  // Fetch all faculty to map user_id -> master_faculty
  const { data: facultyData, error: facultyError } = await admin
    .from('master_faculty')
    .select('user_id, emp_id, name, dept')
    .not('user_id', 'is', null)

  const facultyMap = new Map()
  if (facultyData) {
    facultyData.forEach(f => {
      facultyMap.set(f.user_id, f)
    })
  }

  // Build Excel workbook
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Research Publication Portal'
  workbook.created = new Date()

  const ws = workbook.addWorksheet('Approved Incentives')

  const headers = [
    'S.No',
    'Faculty Name',
    'Emp ID',
    'Department',
    'Particulars',
    'Paper Title',
    'Date of Publication',
    'ISSN/DOI/Vol/Issue/IPR No',
    'No. of Count',
    'Base Amount',
    'Citation Count',
    'Discount Applied',
    'Total Rs.',
    'Approved Date',
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
  const colWidths = [8, 25, 15, 20, 45, 40, 20, 40, 15, 15, 15, 15, 15, 20]
  colWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  const getParticulars = (category: string) => {
    switch (category) {
      case 'sci_journal': return 'Paper Publication – SCI Indexed Journals'
      case 'esci_scopus_journal': return 'Paper Publication – ESCI/Scopus/WoS Indexed Journals'
      case 'conference': return 'Paper Publication – Conference/Book Series Scopus/WoS/EI Indexed'
      case 'book_chapter': return 'Book Publication – Scopus/WoS Indexed Series'
      case 'book': return 'Book Publication'
      case 'patent': return 'Patent Publication'
      case 'citations': return 'Citations in Scopus/WoS Database'
      default: return category
    }
  }

  // Data rows
  ;(data || []).forEach((row, idx) => {
    const facultyInfo = facultyMap.get(row.applicant_id) || {}
    const facultyName = facultyInfo.name || row.submissions?.faculty_name || 'Unknown'
    const empId = facultyInfo.emp_id || '-'
    const dept = facultyInfo.dept || row.submissions?.department || '-'
    
    const countInfo = ['sci_journal', 'esci_scopus_journal', 'conference', 'book_chapter'].includes(row.category)
      ? row.author_count
      : row.category === 'citations' ? row.citation_count : ''

    const isDiscounted = row.self_citation_count < 2

    const meta = row.submissions
    const identifier = meta ? [
      meta.doi,
      meta.issn_no && `ISSN ${meta.issn_no}`,
      [meta.volume && `Vol ${meta.volume}`, meta.issue && `Issue ${meta.issue}`].filter(Boolean).join(', ') || null
    ].filter(Boolean).join(' · ') : '-'

    const pubDate = meta?.year ? String(meta.year) : '-'
    
    // For calculating the base amount before discount, we can reverse the 0.6 if discount was applied
    // Or just recompute it, but if it was saved it might be exact.
    // If it's discounted, base = calculated_amount / 0.6 (approximately, since it was rounded, let's reverse carefully)
    const totalAmount = row.calculated_amount || 0
    let baseAmount = totalAmount
    if (isDiscounted && totalAmount > 0) {
      baseAmount = Math.round(totalAmount / 0.6)
    }

    const dataRow = ws.addRow([
      idx + 1,
      facultyName,
      empId,
      dept,
      getParticulars(row.category),
      meta?.title || '-',
      pubDate,
      identifier || '-',
      countInfo,
      baseAmount,
      row.self_citation_count,
      isDiscounted ? 'Yes' : 'No',
      totalAmount,
      row.reviewed_at ? new Date(row.reviewed_at).toLocaleDateString() : '-'
    ])

    dataRow.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
    })
  })

  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer()
  
  const response = new NextResponse(buffer)
  response.headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  response.headers.set('Content-Disposition', `attachment; filename="Incentive_Applications_${new Date().toISOString().split('T')[0]}.xlsx"`)
  
  return response
}
