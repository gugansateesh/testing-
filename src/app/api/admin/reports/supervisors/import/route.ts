import { NextResponse } from 'next/server'
import { adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'
import { parseSpreadsheetRows } from '@/lib/importSpreadsheet'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SUPERVISORS_COLUMN_MAP = {
  ref_no: 'ref. no',
  supervisor_name: 'supervisor name',
  department: 'department',
  research_area: 'research area',
  current_scholars_count: 'current scholar',
  slots_available: 'slot available'
};

export async function POST(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

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

    console.log(`[Supervisor Import] Starting import. Mode: ${mode}, File: ${file.name}, Size: ${file.size}`)

    for (const sheet of workbook.worksheets) {
      const lName = sheet.name.toLowerCase();
      const isSupervisorSheet = lName.includes('supervisor') && !lName.includes('scholar');
      
      console.log(`[Supervisor Import] Checking sheet "${sheet.name}": isSupervisorSheet=${isSupervisorSheet}`);

      if (!isSupervisorSheet) {
        console.log(`[Supervisor Import] Skipping sheet: ${sheet.name} (does not match supervisor sheet criteria)`)
        sheetStats.push({ name: sheet.name, skipped: true, error: null })
        continue
      }
      
      console.log(`[Supervisor Import] Parsing sheet: ${sheet.name}...`)
      try {
        const { rows, skipped } = await parseSpreadsheetRows(buffer, SUPERVISORS_COLUMN_MAP, sheet.name)
        
        // Extract year from sheet name e.g. "List of Supervisors 2026-2027" -> "2026-2027"
        let deducedYear = '2023-2024'
        const yearMatch = sheet.name.match(/(20\d{2}-\d{2,4}|\d{2}-\d{2})/);
        if (yearMatch) {
            let extracted = yearMatch[1];
            if (extracted.length === 5) { // '25-26'
                const parts = extracted.split('-');
                deducedYear = `20${parts[0]}-20${parts[1]}`;
            } else if (extracted.length === 9 && extracted.startsWith('20')) {
                deducedYear = extracted;
            } else if (extracted.length === 7) {
                const parts = extracted.split('-');
                deducedYear = `${parts[0]}-20${parts[1]}`;
            }
        }
        
        rows.forEach(r => {
          if (!r.academic_year) r.academic_year = deducedYear
        })
        
        allRows.push(...rows)
        totalSkipped += skipped
        console.log(`[Supervisor Import] Sheet ${sheet.name}: Found/Parsed ${rows.length} rows, Skipped ${skipped} empty/invalid rows.`)
        sheetStats.push({ name: sheet.name, rowsFound: rows.length + skipped, rowsParsed: rows.length, rowsSkipped: skipped, skipped: false, error: null })
      } catch (sheetErr: any) {
        console.error(`[Supervisor Import] Error parsing sheet ${sheet.name}:`, sheetErr)
        errors.push({ sheet: sheet.name, error: sheetErr.message || String(sheetErr) })
        sheetStats.push({ name: sheet.name, skipped: false, error: sheetErr.message || String(sheetErr) })
      }
    }

    if (allRows.length === 0) {
      return NextResponse.json({ error: 'No valid data found in the spreadsheet (no matching sheets)' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (mode === 'replace') {
      console.log(`[Supervisor Import] Mode is REPLACE. Initiating deletion of existing legacy_research_supervisors...`)
      const { data: delData, error: delError, count: delCount } = await admin.from('legacy_research_supervisors').delete().not('id', 'is', null).select()
      if (delError) {
        console.error(`[Supervisor Import] Delete failed! Exact error:`, delError)
        return NextResponse.json({ 
          error: 'Failed to delete existing data before replacement.', 
          details: delError 
        }, { status: 500 })
      }
      totalDeleted = delData?.length || 0
      console.log(`[Supervisor Import] Deletion successful. Removed ${totalDeleted} records.`)
    }

    // Dedup check: fetch existing ref_nos if appending
    const refNosInFile = allRows.map(r => r.ref_no).filter(Boolean)
    let existingRefNos = new Set()
    
    if (mode !== 'replace' && refNosInFile.length > 0) {
      const { data: existing } = await admin
        .from('legacy_research_supervisors')
        .select('ref_no')
        .in('ref_no', refNosInFile)
      if (existing) {
        existingRefNos = new Set(existing.map(e => e.ref_no))
      }
    }

    const newRows = []
    let deduppedCount = 0
    let fileRefNos = new Set()

    for (const row of allRows) {
      if (row.ref_no) {
        if (existingRefNos.has(row.ref_no) || fileRefNos.has(row.ref_no)) {
          deduppedCount++
          continue
        }
        fileRefNos.add(row.ref_no)
      }
      // Ensure integers for counts
      if (row.current_scholars_count !== undefined) {
          row.current_scholars_count = parseInt(row.current_scholars_count, 10) || 0;
      }
      if (row.slots_available !== undefined) {
          row.slots_available = parseInt(row.slots_available, 10) || 0;
      }
      newRows.push(row)
    }

    console.log(`[Supervisor Import] Total accumulated rows: ${allRows.length}. After cross-sheet deduping: ${newRows.length} (Deduped: ${deduppedCount})`)

    if (newRows.length > 0) {
      console.log(`[Supervisor Import] Initiating insert of ${newRows.length} records into legacy_research_supervisors...`)
      const { error: insError } = await admin.from('legacy_research_supervisors').insert(newRows)
      if (insError) {
        console.error(`[Supervisor Import] Insert failed! Exact error:`, insError)
        return NextResponse.json({ 
          error: 'Database insert failed', 
          details: insError 
        }, { status: 500 })
      }
      console.log(`[Supervisor Import] Insert successful.`)
    } else {
      console.log(`[Supervisor Import] No new records to insert.`)
    }

    console.log(`[Supervisor Import] Finished completely. Imported: ${newRows.length}, Skipped: ${totalSkipped + deduppedCount}, Deleted: ${totalDeleted}`)
    
    return NextResponse.json({ 
      imported: newRows.length, 
      skipped: totalSkipped + deduppedCount,
      deleted: totalDeleted,
      mode: mode,
      sheets: sheetStats,
      errors: errors 
    })

  } catch (error: any) {
    console.error('[Supervisor Import] Top-level import error:', error)
    return NextResponse.json({ 
      error: error.message || 'Import failed',
      details: error 
    }, { status: 500 })
  }
}
