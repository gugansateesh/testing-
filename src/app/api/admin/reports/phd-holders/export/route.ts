import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken } from '@/lib/verifyAuth'
import ExcelJS from 'exceljs'
import staffDirectoryRaw from '@/data/staff_directory.json'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface StaffContact {
  email: string | null
  phone: string | null
}

export async function GET(request: Request) {
  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const dept = searchParams.get('dept')
  const year = searchParams.get('year') || '2026'
  const phdOnly = searchParams.get('phdOnly') === 'true'

  try {
    let allRawData: any[] = []
    let hasMore = true
    let page = 0
    const pageSize = 1000

    while (hasMore) {
      let query = admin.from('legacy_phd_holders')
        .select('*')
        .eq('academic_year', year)
        .range(page * pageSize, (page + 1) * pageSize - 1)
      
      if (dept && dept !== 'all') {
        query = query.ilike('dept', dept.trim())
      }

      if (phdOnly) {
        query = query.eq('is_phd', true)
      }

      const { data: pageData, error } = await query
      if (error) throw error

      if (pageData && pageData.length > 0) {
        allRawData = [...allRawData, ...pageData]
        if (pageData.length < pageSize) {
          hasMore = false
        } else {
          page++
        }
      } else {
        hasMore = false
      }
    }

    const rawData = allRawData

    // Fetch master_faculty to get email and phone
    const { data: facultyData } = await admin
      .from('master_faculty')
      .select('emp_id, name, email, phone')

    const contactByEmpId = new Map<string, StaffContact>()
    const contactByName = new Map<string, StaffContact>()

    if (Array.isArray(staffDirectoryRaw)) {
      for (const s of staffDirectoryRaw as any[]) {
        if (s.emp_id) {
          contactByEmpId.set(s.emp_id.trim().toUpperCase(), {
            email: s.email || null,
            phone: s.phone || null,
          })
        }
        if (s.name) {
          contactByName.set(s.name.trim().toLowerCase(), {
            email: s.email || null,
            phone: s.phone || null,
          })
        }
      }
    }

    if (facultyData) {
      for (const f of facultyData) {
        if (f.emp_id) {
          const cleanId = f.emp_id.trim().toUpperCase()
          const existing = contactByEmpId.get(cleanId)
          contactByEmpId.set(cleanId, {
            email: f.email || existing?.email || null,
            phone: f.phone || existing?.phone || null,
          })
        }
        if (f.name) {
          const cleanName = f.name.trim().toLowerCase()
          const existing = contactByName.get(cleanName)
          contactByName.set(cleanName, {
            email: f.email || existing?.email || null,
            phone: f.phone || existing?.phone || null,
          })
        }
      }
    }

    let data = [...(rawData || [])].sort((a, b) => {
      return (a.s_no || 0) - (b.s_no || 0)
    }).map(row => {
      const empIdClean = (row.emp_id || '').trim().toUpperCase()
      const nameClean = (row.name || '').trim().toLowerCase()
      const contact = contactByEmpId.get(empIdClean) || contactByName.get(nameClean)
      return {
        ...row,
        email: contact?.email || '',
        phone: contact?.phone || '',
      }
    })

    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('PhD Holders')

    const headers = ['S.No', 'Dept', 'Emp ID', 'Name of the Faculty', 'Email', 'Phone Number']
    
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

    const colWidths = [10, 18, 16, 36, 34, 20]
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

    ;(data || []).forEach((row, idx) => {
      ws.addRow([
        idx + 1, row.dept || '', row.emp_id || '', row.name || '', row.email || '', row.phone || ''
      ])
    })

    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="PhD_Holders_Export_${year}_${new Date().toISOString().split('T')[0]}.xlsx"`
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
