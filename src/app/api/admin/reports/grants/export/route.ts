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
        .from('research_grants')
        .select('*')
        .order('academic_year', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (year && year !== 'all') query = query.eq('academic_year', year)
      if (dept && dept !== 'all') query = query.ilike('department', dept.trim())

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

    // Fetch live approved project grants
    let liveQuery = admin
      .from('project_grant_applications')
      .select('id, research_project_title, funding_agency, co_investigators, project_duration_months, total_proposed_budget, created_at, applicant_id')
      .eq('status', 'approved')

    const { data: liveDataRaw, error: liveError } = await liveQuery
    if (liveError) throw liveError

    let liveMapped: any[] = []
    if (liveDataRaw && liveDataRaw.length > 0) {
      const userIds = [...new Set(liveDataRaw.map(a => a.applicant_id))]
      const { data: facultyData } = await admin
        .from('master_faculty')
        .select('user_id, name, dept')
        .in('user_id', userIds)
        
      const facultyMap = (facultyData || []).reduce((acc: any, f: any) => {
        acc[f.user_id] = f
        return acc
      }, {})

      liveMapped = liveDataRaw.map(r => {
        const fac = facultyMap[r.applicant_id] || {}
        const piName = fac.name || 'Unknown'
        const coInv = r.co_investigators ? ` / ${r.co_investigators}` : ''
        const deptStr = fac.dept || ''
        
        // Derive Academic Year from created_at
        const d = new Date(r.created_at)
        const y = d.getFullYear()
        const m = d.getMonth() + 1
        const ay = m >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`

        return {
          id: r.id,
          academic_year: ay,
          department: deptStr,
          pi_co_investigator: `${piName}${coInv}`,
          project_title: r.research_project_title,
          project_type: 'Project Grant',
          funding_agency: r.funding_agency,
          period: r.project_duration_months ? `${r.project_duration_months} months` : null,
          grant_amount: r.total_proposed_budget,
          created_at: r.created_at,
          is_live: true
        }
      })
    }

    let filteredLive = liveMapped
    if (year && year !== 'all') {
      filteredLive = filteredLive.filter(r => r.academic_year === year)
    }
    if (dept && dept !== 'all') {
      filteredLive = filteredLive.filter(r => (r.department || '').trim().toLowerCase() === dept.trim().toLowerCase())
    }

    const combined = [...allData, ...filteredLive]
    combined.sort((a, b) => {
      const ya = a.academic_year || ''
      const yb = b.academic_year || ''
      if (ya > yb) return -1
      if (ya < yb) return 1
      return 0
    })

    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Research Grants')

    const headers = [
      'S.No', 'Academic Year', 'Department', 'PI / Co-Investigator', 'Title of the Project',
      'Type of Project', 'Funding Agency', 'Period', 'Total Grant Sanctioned (₹)'
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

    const colWidths = [10, 15, 20, 40, 45, 20, 30, 20, 20]
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

    ;(combined || []).forEach((row, idx) => {
      ws.addRow([
        idx + 1,
        row.academic_year || '',
        row.department || '',
        row.pi_co_investigator || '',
        row.project_title || '',
        row.project_type || '',
        row.funding_agency || '',
        row.period || '',
        row.grant_amount != null ? Number(row.grant_amount) : 0,
      ])
    })

    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="ResearchGrants_Export_${new Date().toISOString().split('T')[0]}.xlsx"`
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
