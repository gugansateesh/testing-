import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

const CATEGORY_LABELS: Record<string, string> = {
  workshops: 'Workshops',
  seminars: 'Seminars',
  events: 'Events',
  deadlines: 'Deadlines',
  funding_opportunities: 'Funding Opportunities',
  general_notices: 'General Notices',
  cfrd_circular: 'CFRD Circular',
}

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const year = searchParams.get('year')
  const month = searchParams.get('month')

  let query = admin
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })

  if (category) query = query.eq('category', category)
  if (status === 'active') query = query.eq('is_active', true)
  if (status === 'archived') query = query.eq('is_active', false)
  if (search) query = query.ilike('title', `%${search}%`)
  if (year) {
    query = query.gte('created_at', `${year}-01-01T00:00:00`)
                 .lt('created_at', `${parseInt(year) + 1}-01-01T00:00:00`)
  }
  if (month && year) {
    const m = parseInt(month)
    const y = parseInt(year)
    const start = `${y}-${String(m).padStart(2, '0')}-01T00:00:00`
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    const end = `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00`
    query = query.gte('created_at', start).lt('created_at', end)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build Excel workbook — matches existing export styling from submissions
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Research Publication Portal'
  workbook.created = new Date()

  const ws = workbook.addWorksheet('Announcements')

  const headers = [
    'Category',
    'Title',
    'Funding Agency',
    'Body',
    'Start Date',
    'Registration End Date',
    'Event Date',
    'Posted Date',
    'Status',
    'Poster URL',
  ]

  ws.addRow(headers)

  // Style header row — same pattern as submissions export
  const headerRow = ws.getRow(1)
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD1D5DB' },
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

  const colWidths = [22, 40, 30, 60, 16, 22, 16, 16, 12, 50]
  colWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  ;(data ?? []).forEach((row: any, idx: number) => {
    const dataRow = ws.addRow([
      CATEGORY_LABELS[row.category] || row.category,
      row.title,
      row.category === 'funding_opportunities' ? (row.funding_agency || '') : '',
      row.body,
      fmtDate(row.start_date),
      fmtDate(row.registration_end_date),
      fmtDate(row.event_date),
      fmtDate(row.created_at),
      row.is_active ? 'Active' : 'Archived',
      row.poster_url || '',
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

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const uint8 = new Uint8Array(buffer as ArrayBuffer)
  const filename = `announcements_${new Date().toISOString().split('T')[0]}.xlsx`

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
