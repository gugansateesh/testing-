import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken } from '@/lib/verifyAuth'
import { parseSpreadsheetRows } from '@/lib/importSpreadsheet'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PATENTS_COLUMN_MAP = {
  department: ['Department', 'Dept', 'dep'],
  application_number: ['Patent Application Number', 'Application Number', 'application'],
  status: ['Status of Patent (Published / Granted/Filed)', 'Status of Patent', 'status of patent', 'status'],
  inventors: ['Inventor/s Name', "Inventor's Name", 'Inventors', 'inventor'],
  title: ['Title of the Patent', 'Patent Title', 'Title', 'title'],
  applicants: ['Applicant/s Name', "Applicant's Name", 'Applicants', 'applicant'],
  filed_date: ['Patent Filed Date (DD/MM/YYYY)', 'Patent Filed Date', 'Filed Date', 'patent filed date'],
  published_or_granted_date: ['Published Date / Granted Date (DD/MM/YYYY)', 'Published Date / Granted Date', 'Published Date', 'published date', 'Grant Date'],
  publication_or_grant_number: ['Patent Publication Number / Granted Number', 'Publication Number', 'publication number', 'Grant Number'],
  assignee: ['Assignee/s Name (Institute Affiliation/s at time of Application)', 'Assignee', 'assignee'],
  proof_link: ['Proof Link', 'Proof', 'proof'],
  academic_year: ['Calender Year', 'Calendar Year', 'Academic Year', 'Year', 'academic year'],
  faculty_name: ['Name of the Faculty', 'Faculty Name', 'Name of Faculty', 'Faculty', 'name_of_faculty'],
  emp_id: ['Employee ID', 'Employee Id', 'Emp ID', 'EmpID', 'empid']
};

export async function POST(request: Request) {
  // const token = extractToken(request)
  // if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // const auth = await verifyToken(token)
  // if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await request.formData()
    const mode = formData.get('mode') as string || 'append'
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
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as any)

    let allRows: any[] = []
    let totalSkipped = 0
    let totalDeleted = 0
    const sheetStats: any[] = []
    const errors: any[] = []

    console.log(`[Patent Import] Starting import. Mode: ${mode}, File: ${file.name}, Size: ${file.size}`)

    const hasYearNamedSheets = workbook.worksheets.some(s => /^\d{4}/.test(s.name.trim()))

    for (const sheet of workbook.worksheets) {
      const sheetName = sheet.name.trim()
      if (hasYearNamedSheets && !/^\d{4}/.test(sheetName)) {
        console.log(`[Patent Import] Skipping sheet: ${sheetName} (does not match year pattern in multi-year workbook)`)
        sheetStats.push({ name: sheetName, skipped: true, error: null })
        continue
      }
      
      console.log(`[Patent Import] Parsing sheet: ${sheetName}...`)
      try {
        const { rows, skipped } = await parseSpreadsheetRows(buffer, PATENTS_COLUMN_MAP, sheet.name)
        
        // Fallback academic year if missing but we can deduce from sheet name
        const match = sheetName.match(/(\d{4})/)
        const deducedYear = match ? match[1] : '2026'
        
        rows.forEach(r => {
          if (!r.academic_year) r.academic_year = deducedYear
          if (r.faculty_name) r.faculty_name = String(r.faculty_name).trim()
          if (r.emp_id) r.emp_id = String(r.emp_id).trim().toUpperCase()
        })
        
        allRows.push(...rows)
        totalSkipped += skipped
        console.log(`[Patent Import] Sheet ${sheetName}: Found/Parsed ${rows.length} rows, Skipped ${skipped} empty/invalid rows.`)
        sheetStats.push({ name: sheetName, rowsFound: rows.length + skipped, rowsParsed: rows.length, rowsSkipped: skipped, skipped: false, error: null })
      } catch (sheetErr: any) {
        console.error(`[Patent Import] Error parsing sheet ${sheetName}:`, sheetErr)
        errors.push({ sheet: sheetName, error: sheetErr.message || String(sheetErr) })
        sheetStats.push({ name: sheetName, skipped: false, error: sheetErr.message || String(sheetErr) })
      }
    }

    if (allRows.length === 0) {
      return NextResponse.json({ error: 'No valid data found in the spreadsheet (no matching sheets)' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (mode === 'replace') {
      console.log(`[Patent Import] Mode is REPLACE. Initiating deletion of existing legacy_patents...`)
      const { data: delData, error: delError } = await admin.from('legacy_patents').delete().not('id', 'is', null).select()
      if (delError) {
        console.error(`[Patent Import] Delete failed! Exact error:`, delError)
        return NextResponse.json({ 
          error: 'Failed to delete existing data before replacement.', 
          details: delError 
        }, { status: 500 })
      }
      totalDeleted = delData?.length || 0
      console.log(`[Patent Import] Deletion successful. Removed ${totalDeleted} records.`)
    }

    // Dedup check: fetch existing application numbers if appending
    const appNosInFile = allRows.map(r => r.application_number).filter(Boolean)
    let existingAppNos = new Set()
    
    if (mode !== 'replace' && appNosInFile.length > 0) {
      const { data: existing } = await admin
        .from('legacy_patents')
        .select('application_number, emp_id')
        .in('application_number', appNosInFile)
      if (existing) {
        existingAppNos = new Set(existing.map(e => `${(e.application_number || '').trim()}:::${(e.emp_id || '').trim()}`))
      }
    }

    const newRows = []
    let deduppedCount = 0
    let fileAppNos = new Set()

    for (const row of allRows) {
      if (row.application_number) {
        const appKey = `${(row.application_number || '').trim()}:::${(row.emp_id || '').trim()}`
        if (existingAppNos.has(appKey) || fileAppNos.has(appKey)) {
          deduppedCount++
          continue
        }
        fileAppNos.add(appKey)
      }
      newRows.push(row)
    }

    console.log(`[Patent Import] Total accumulated rows: ${allRows.length}. After cross-sheet deduping: ${newRows.length} (Deduped: ${deduppedCount})`)

    if (newRows.length > 0) {
      console.log(`[Patent Import] Initiating insert of ${newRows.length} records into legacy_patents...`)
      const BATCH_SIZE = 500
      for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
        const batch = newRows.slice(i, i + BATCH_SIZE)
        const { error: insError } = await admin.from('legacy_patents').insert(batch)
        if (insError) {
          console.error(`[Patent Import] Insert failed on batch ${i}:`, insError)
          return NextResponse.json({ 
            error: 'Database insert failed: ' + insError.message, 
            details: insError 
          }, { status: 500 })
        }
      }
      console.log(`[Patent Import] Insert successful.`)
    } else {
      console.log(`[Patent Import] No new records to insert.`)
    }

    console.log(`[Patent Import] Finished completely. Imported: ${newRows.length}, Skipped: ${totalSkipped + deduppedCount}, Deleted: ${totalDeleted}`)
    
    return NextResponse.json({ 
      imported: newRows.length, 
      skipped: totalSkipped + deduppedCount,
      deleted: totalDeleted,
      mode: mode,
      sheets: sheetStats,
      errors: errors 
    })

  } catch (error: any) {
    console.error('[Patent Import] Top-level import error:', error)
    return NextResponse.json({ 
      error: error.message || 'Import failed',
      details: error 
    }, { status: 500 })
  }
}
