import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken } from '@/lib/verifyAuth'
import ExcelJS from 'exceljs'

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
    let allData: any[] = []
    let hasMore = true
    let page = 0
    const pageSize = 1000

    while (hasMore) {
      let query = admin
        .from('legacy_seed_fund_grants')
        .select('*')
        .order('academic_year', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (year && year !== 'all') query = query.eq('academic_year', year)
      if (dept && dept !== 'all') query = query.ilike('dept', dept.trim())

      const { data: pageData, error } = await query
      if (error) throw error

      if (pageData && pageData.length > 0) {
        allData = [...allData, ...pageData]
        if (pageData.length < pageSize) hasMore = false
        else page++
      } else {
        hasMore = false
      }
    }

    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Seed Fund Grants')

    const headers = [
      'S.No', 'Academic Year', 'Dept', 'Title of the Project',
      'Faculty Name', 'Duration', 'Amount Sanctioned (₹)'
    ]

    const headerRow = ws.addRow(headers)
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      }
    })
    headerRow.height = 30

    const colWidths = [8, 15, 20, 50, 30, 20, 22]
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

    ;(allData || []).forEach((row, idx) => {
      ws.addRow([
        idx + 1,
        row.academic_year || '',
        row.dept || '',
        row.project_title || '',
        row.faculty_name || '',
        row.duration || '',
        row.amount_sanctioned != null ? Number(row.amount_sanctioned) : 0,
      ])
    })

    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="SeedFundGrants_Export_${new Date().toISOString().split('T')[0]}.xlsx"`
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
