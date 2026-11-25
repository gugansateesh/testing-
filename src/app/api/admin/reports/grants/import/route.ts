import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { parseSpreadsheetRows } from '@/lib/importSpreadsheet'

import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const GRANTS_COLUMN_MAP = {
  s_no: 'S.No',
  academic_year: 'Academic Year',
  department: 'Dept',
  pi_co_investigator: 'Name of Principal Investigator and Co-Investigator',
  project_title: 'Title of the Project',
  project_type: 'Type of Project',
  funding_agency: 'Name of the Funding Agency',
  period: 'Period',
  grant_amount: 'Total Grant Sanctioned'
};

export async function POST(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json({ error: 'Only Excel files are allowed' }, { status: 400 })
    }
    
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 10MB' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // PRE-PROCESS: Fix blank header for "Academic Year" in column B and target the right sheet
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as any)
    const sheet = workbook.getWorksheet('GRANTS RECEIVED') || workbook.worksheets[0]
    
    if (sheet) {
      const headerRow = sheet.getRow(2)
      if (headerRow) {
        const cell = headerRow.getCell(2) // Column B (blank header that holds academic year data)
        if (!cell.value || String(cell.value).trim() === '' || String(cell.value).trim() === ' ') {
          cell.value = 'Academic Year'
        }
      }
    }
    
    const modifiedBuffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer
    const { rows, skipped } = await parseSpreadsheetRows(modifiedBuffer, GRANTS_COLUMN_MAP, 'GRANTS RECEIVED')

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid data found in the spreadsheet' }, { status: 400 })
    }

    const admin = createAdminClient()

    const newRows = []
    let filteredCount = 0

    for (const row of rows) {
      // Skip subtotal rows: s_no is empty AND period contains "Total"
      // Example: (None, '2020-2021', None, None, None, None, None, 'Total', '=SUM(I3:I7)', None)
      const periodVal = String(row.period || '').trim()
      const sNoVal = String(row.s_no || '').trim()
      if (!sNoVal && periodVal.toLowerCase().includes('total')) {
        filteredCount++
        continue
      }

      // Skip rows where grant_amount is a formula string (e.g. "=SUM(I3:I7)")
      const amountRaw = String(row.grant_amount || '').trim()
      if (amountRaw.startsWith('=')) {
        filteredCount++
        continue
      }

      // Clean up s_no (research_grants table does not have an s_no column)
      delete row.s_no

      // Numeric coercion for grant_amount
      if (row.grant_amount) {
        const cleanedAmount = String(row.grant_amount).replace(/[^0-9.]/g, '')
        row.grant_amount = parseFloat(cleanedAmount) || 0
      } else {
        row.grant_amount = 0
      }
      
      // Require project_title and academic_year at minimum
      if (!row.project_title || !row.academic_year) {
        filteredCount++
        continue
      }
      
      newRows.push(row)
    }

    if (newRows.length > 0) {
      const { data: existingData } = await admin.from('research_grants').select('academic_year, department, project_title, grant_amount')
      
      const existingKeys = new Set(
        (existingData || []).map(r => `${r.academic_year}|${r.department}|${r.project_title}|${r.grant_amount}`)
      )

      const deduplicatedRows = newRows.filter(row => {
        const key = `${row.academic_year}|${row.department}|${row.project_title}|${row.grant_amount}`
        if (existingKeys.has(key)) return false
        existingKeys.add(key) // Prevent duplicates within the upload itself
        return true
      })

      if (deduplicatedRows.length > 0) {
        const { error } = await admin.from('research_grants').insert(deduplicatedRows)
        if (error) throw error
      }
      
      return NextResponse.json({ 
        imported: deduplicatedRows.length, 
        skipped: skipped + filteredCount + (newRows.length - deduplicatedRows.length),
        errors: [] 
      })
    }

    return NextResponse.json({ 
      imported: 0, 
      skipped: skipped + filteredCount,
      errors: [] 
    })

  } catch (error: any) {
    console.error('Import error:', error)
    return NextResponse.json({ error: error.message || 'Import failed' }, { status: 500 })
  }
}
