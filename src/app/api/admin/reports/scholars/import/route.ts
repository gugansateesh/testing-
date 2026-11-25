import { NextResponse } from 'next/server'
import { adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'
import { parseSpreadsheetRows } from '@/lib/importSpreadsheet'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SCHOLARS_COLUMN_MAP = {
  academic_year: 'academic year',
  research_centre: 'research centre',
  supervisor_name: 'supervisor',
  scholar_name: 'scholar name',
  au_registration_number: 'au reg',
  year_of_registration: 'year of reg',
  scholar_type: 'type'
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

    console.log(`[Scholar Import] Starting import. Mode: ${mode}, File: ${file.name}, Size: ${file.size}`)

    for (const sheet of workbook.worksheets) {
      const lName = sheet.name.toLowerCase();
      const isScholarSheet = lName.includes('scholar') && !lName.includes('supervisor');
      
      console.log(`[Scholar Import] Checking sheet "${sheet.name}": isScholarSheet=${isScholarSheet}`);

      if (!isScholarSheet) {
        console.log(`[Scholar Import] Skipping sheet: ${sheet.name} (does not match scholar sheet criteria)`)
        sheetStats.push({ name: sheet.name, skipped: true, error: null })
        continue
      }
      
      console.log(`[Scholar Import] Parsing sheet: ${sheet.name}...`)
      try {
        const { rows, skipped } = await parseSpreadsheetRows(buffer, SCHOLARS_COLUMN_MAP, sheet.name)
        
        // Extract year from sheet name e.g. "Research Scholars 25-26" -> "2025-2026"
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
        console.log(`[Scholar Import] Sheet ${sheet.name}: Found/Parsed ${rows.length} rows, Skipped ${skipped} empty/invalid rows.`)
        sheetStats.push({ name: sheet.name, rowsFound: rows.length + skipped, rowsParsed: rows.length, rowsSkipped: skipped, skipped: false, error: null })
      } catch (sheetErr: any) {
        console.error(`[Scholar Import] Error parsing sheet ${sheet.name}:`, sheetErr)
        errors.push({ sheet: sheet.name, error: sheetErr.message || String(sheetErr) })
        sheetStats.push({ name: sheet.name, skipped: false, error: sheetErr.message || String(sheetErr) })
      }
    }

    if (allRows.length === 0) {
      return NextResponse.json({ error: 'No valid data found in the spreadsheet (no matching sheets)' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (mode === 'replace') {
      console.log(`[Scholar Import] Mode is REPLACE. Initiating deletion of existing legacy_research_scholars...`)
      const { data: delData, error: delError, count: delCount } = await admin.from('legacy_research_scholars').delete().not('id', 'is', null).select()
      if (delError) {
        console.error(`[Scholar Import] Delete failed! Exact error:`, delError)
        return NextResponse.json({ 
          error: 'Failed to delete existing data before replacement.', 
          details: delError 
        }, { status: 500 })
      }
      totalDeleted = delData?.length || 0
      console.log(`[Scholar Import] Deletion successful. Removed ${totalDeleted} records.`)
    }

    // Dedup check: fetch existing au_registration_number if appending
    const appNosInFile = allRows.map(r => r.au_registration_number).filter(Boolean)
    let existingAppNos = new Set()
    
    if (mode !== 'replace' && appNosInFile.length > 0) {
      const { data: existing } = await admin
        .from('legacy_research_scholars')
        .select('au_registration_number')
        .in('au_registration_number', appNosInFile)
      if (existing) {
        existingAppNos = new Set(existing.map(e => e.au_registration_number))
      }
    }

    const newRows = []
    let deduppedCount = 0
    let fileAppNos = new Set()

    for (const row of allRows) {
      if (row.au_registration_number) {
        if (existingAppNos.has(row.au_registration_number) || fileAppNos.has(row.au_registration_number)) {
          deduppedCount++
          continue
        }
        fileAppNos.add(row.au_registration_number)
      }
      newRows.push(row)
    }

    console.log(`[Scholar Import] Total accumulated rows: ${allRows.length}. After cross-sheet deduping: ${newRows.length} (Deduped: ${deduppedCount})`)

    if (newRows.length > 0) {
      console.log(`[Scholar Import] Initiating insert of ${newRows.length} records into legacy_research_scholars...`)
      const { error: insError } = await admin.from('legacy_research_scholars').insert(newRows)
      if (insError) {
        console.error(`[Scholar Import] Insert failed! Exact error:`, insError)
        return NextResponse.json({ 
          error: 'Database insert failed', 
          details: insError 
        }, { status: 500 })
      }
      console.log(`[Scholar Import] Insert successful.`)
    } else {
      console.log(`[Scholar Import] No new records to insert.`)
    }

    console.log(`[Scholar Import] Finished completely. Imported: ${newRows.length}, Skipped: ${totalSkipped + deduppedCount}, Deleted: ${totalDeleted}`)
    
    return NextResponse.json({ 
      imported: newRows.length, 
      skipped: totalSkipped + deduppedCount,
      deleted: totalDeleted,
      mode: mode,
      sheets: sheetStats,
      errors: errors 
    })

  } catch (error: any) {
    console.error('[Scholar Import] Top-level import error:', error)
    return NextResponse.json({ 
      error: error.message || 'Import failed',
      details: error 
    }, { status: 500 })
  }
}
