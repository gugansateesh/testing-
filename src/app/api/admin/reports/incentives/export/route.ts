import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import ExcelJS from 'exceljs'
import { verifyToken } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  
  if (!token) return new NextResponse('Unauthorized', { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return new NextResponse('Unauthorized', { status: 401 })

  const year = searchParams.get('year')
  const dept = searchParams.get('dept')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  try {
    const admin = createAdminClient()
    let allData: any[] = []
    let from = 0
    const step = 1000
    while (true) {
      let q = admin.from('legacy_incentives').select('*')
      if (year && year !== 'all') q = q.eq('incentive_year', year)
      if (dept && dept !== 'all') q = q.ilike('department', dept.trim())
      if (startDate) q = q.gte('amount_credited_date', startDate)
      if (endDate) q = q.lte('amount_credited_date', endDate)

      const { data, error } = await q.range(from, from + step - 1)
      if (error) throw error
      if (data && data.length > 0) {
        allData.push(...data)
        if (data.length < step) break
        from += step
      } else {
        break
      }
    }
    const data = allData;

    const sortedData = (data || []).sort((a: any, b: any) => {
      if (a.incentive_year !== b.incentive_year) return (b.incentive_year || '').localeCompare(a.incentive_year || '')
      const da = a.amount_credited_date ? new Date(a.amount_credited_date).getTime() : 0
      const db = b.amount_credited_date ? new Date(b.amount_credited_date).getTime() : 0
      return db - da
    })

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Incentives')

    sheet.columns = [
      { header: 'S.No', key: 'sno', width: 8 },
      { header: 'Submitted Date', key: 'submitted_date', width: 15 },
      { header: 'Dept.', key: 'department', width: 15 },
      { header: 'Faculty Name', key: 'faculty_name', width: 25 },
      { header: 'Paper Title', key: 'paper_title', width: 40 },
      { header: 'Publication', key: 'publication_type', width: 20 },
      { header: 'Received Amount by Faculty', key: 'received_amount', width: 15 },
      { header: 'Amount Credited date', key: 'amount_credited_date', width: 15 },
      { header: 'Dr/Pursuing Phd/Non Phd', key: 'phd_status', width: 20 },
      { header: 'Date of Publication', key: 'date_of_publication', width: 15 },
      { header: 'File Number', key: 'file_number', width: 15 }
    ]

    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    sortedData.forEach((row, index) => {
      sheet.addRow({
        sno: index + 1,
        submitted_date: row.submitted_date || '',
        department: row.department || '',
        faculty_name: row.faculty_name || '',
        paper_title: row.paper_title || '',
        publication_type: row.publication_type || '',
        received_amount: row.received_amount ? Number(row.received_amount) : '',
        amount_credited_date: row.amount_credited_date || '',
        phd_status: row.phd_status || '',
        date_of_publication: row.date_of_publication || '',
        file_number: row.file_number || ''
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Incentives.xlsx"'
      }
    })
  } catch (error: any) {
    return new NextResponse(error.message, { status: 500 })
  }
}
