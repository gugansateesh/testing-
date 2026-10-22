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
    let query = admin.from('legacy_research_scholars').select('*')
    if (year && year !== 'all') {
      const yTrim = year.trim()
      if (/^\d{4}$/.test(yTrim)) {
        query = query.gte('year_of_registration', `${yTrim}-01-01`).lte('year_of_registration', `${yTrim}-12-31`)
      } else {
        query = query.eq('academic_year', yTrim)
      }
    }
    if (dept && dept !== 'all') {
      const dTrim = dept.trim()
      if (dTrim.toUpperCase() === 'MECH' || dTrim.toUpperCase() === 'MECHANICAL') {
        query = query.or('research_centre.ilike.MECH,research_centre.ilike.MECHANICAL')
      } else {
        query = query.ilike('research_centre', dTrim)
      }
    }

    const { data, error } = await query
    if (error) throw error

    const result = (data || []).sort((a: any, b: any) => {
      if (a.academic_year !== b.academic_year) return (b.academic_year || '').localeCompare(a.academic_year || '')
      return (a.scholar_name || '').localeCompare(b.scholar_name || '')
    })

    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Scholars')

    const headers = [
      'S.No', 'Academic Year', 'Research Centre', 'Supervisor Name', 'Scholar Name', 'AU Reg. No.', 'Year of Reg.', 'Type'
    ]
    
    const headerRow = ws.addRow(headers)
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1D5DB' },
      }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
    })
    headerRow.height = 30

    const colWidths = [10, 15, 30, 30, 30, 15, 15, 15]
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-IN') : ''

    ;(result || []).forEach((row, idx) => {
      ws.addRow([
        idx + 1, row.academic_year || '', row.research_centre || '', row.supervisor_name || '', row.scholar_name || '', row.au_registration_number || '', fmtDate(row.year_of_registration) || row.year_of_registration || '', row.scholar_type || ''
      ])
    })

    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Scholars_Export_${new Date().toISOString().split('T')[0]}.xlsx"`
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
