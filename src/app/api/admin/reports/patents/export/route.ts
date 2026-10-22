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
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const status = searchParams.get('status')

  try {
    let query = admin.from('legacy_patents').select('*')
    if (year && year !== 'all') query = query.eq('academic_year', year)
    if (dept && dept !== 'all') query = query.ilike('department', dept.trim())
    if (status && status !== 'all') query = query.ilike('status', `%${status}%`)
    if (startDate) query = query.gte('filed_date', startDate)
    if (endDate) query = query.lte('filed_date', endDate)

    const { data, error } = await query
    if (error) throw error

    const result = (data || []).sort((a: any, b: any) => {
      if (a.academic_year !== b.academic_year) return (b.academic_year || '').localeCompare(a.academic_year || '')
      const da = a.filed_date ? new Date(a.filed_date).getTime() : 0
      const db = b.filed_date ? new Date(b.filed_date).getTime() : 0
      return db - da
    })

    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Patents')

    const headers = [
      'S.No', 'Department', 'Application Number', 'Status', 'Inventors', 'Title', 'Applicants', 'Filed Date', 'Published/Granted Date', 'Publication/Grant Number', 'Assignee', 'Academic Year', 'Proof Link'
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

    const colWidths = [10, 20, 25, 15, 30, 40, 30, 15, 20, 30, 30, 15, 40]
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-IN') : ''

    ;(result || []).forEach((row, idx) => {
      ws.addRow([
        idx + 1, row.department || '', row.application_number || '', row.status || '', row.inventors || '',
        row.title || '', row.applicants || '', fmtDate(row.filed_date), fmtDate(row.published_or_granted_date),
        row.publication_or_grant_number || '', row.assignee || '', row.academic_year || '', row.proof_link || ''
      ])
    })

    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Patents_Export_${new Date().toISOString().split('T')[0]}.xlsx"`
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
