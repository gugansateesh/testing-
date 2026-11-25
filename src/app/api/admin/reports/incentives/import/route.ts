import { NextResponse } from 'next/server'
import { adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'
import { parseSpreadsheetRows } from '@/lib/importSpreadsheet'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const INCENTIVES_COLUMN_MAP: Record<string, string | string[]> = {
  department: ['dept', 'department'],
  faculty_name: ['faculty name', 'name of faculty'],
  paper_title: ['paper title', 'title of paper'],
  publication_type: ['publication', 'type of publication'],
  received_amount: ['received amount', 'amount received'],
  amount_credited_date: ['amount credited', 'credited date'],
  phd_status: ['phd/non phd', 'ph.d/non ph.d', 'phd status', 'ph.d status', 'pursuing'],
  submitted_date: ['submitted date', 'date of submission'],
  date_of_publication: ['date of publication', 'publication date'],
  file_number: ['file', 'file number', 'file no']
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

    console.log(`[Incentives Import] Starting import. Mode: ${mode}, File: ${file.name}, Size: ${file.size}`)

    for (const sheet of workbook.worksheets) {
      console.log(`[Incentives Import] Parsing sheet: ${sheet.name}...`)
      try {
        const { rows, skipped } = await parseSpreadsheetRows(buffer, INCENTIVES_COLUMN_MAP, sheet.name)
        
        // Filter out subtotals and grand totals which typically lack a faculty name
        let validRows = rows.filter(r => !!r.faculty_name)
        let newlySkipped = rows.length - validRows.length
        
        validRows.forEach(r => {
          r.incentive_year = sheet.name
        })
        
        allRows.push(...validRows)
        totalSkipped += skipped + newlySkipped
        console.log(`[Incentives Import] Sheet ${sheet.name}: Found/Parsed ${validRows.length} rows, Skipped ${skipped + newlySkipped} empty/invalid rows.`)
        sheetStats.push({ name: sheet.name, rowsFound: rows.length + skipped, rowsParsed: validRows.length, rowsSkipped: skipped + newlySkipped, skipped: false, error: null })
      } catch (sheetErr: any) {
        console.error(`[Incentives Import] Error parsing sheet ${sheet.name}:`, sheetErr)
        errors.push({ sheet: sheet.name, error: sheetErr.message || String(sheetErr) })
        sheetStats.push({ name: sheet.name, skipped: false, error: sheetErr.message || String(sheetErr) })
      }
    }

    if (allRows.length === 0) {
      return NextResponse.json({ error: 'No valid data found in the spreadsheet (no matching sheets or rows)' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (mode === 'replace') {
      console.log(`[Incentives Import] Mode is REPLACE. Initiating deletion of existing legacy_incentives...`)
      const { data: delData, error: delError } = await admin.from('legacy_incentives').delete().not('id', 'is', null).select()
      if (delError) {
        console.error(`[Incentives Import] Delete failed! Exact error:`, delError)
        return NextResponse.json({ 
          error: 'Failed to delete existing data before replacement.', 
          details: delError 
        }, { status: 500 })
      }
      totalDeleted = delData?.length || 0
      console.log(`[Incentives Import] Deletion successful. Removed ${totalDeleted} records.`)
    }

    // Dedup check: fetch existing combinations if appending
    let existingSet = new Set<string>()
    
    if (mode !== 'replace') {
      const { data: existing } = await admin
        .from('legacy_incentives')
        .select('faculty_name, paper_title, amount_credited_date, received_amount')
      if (existing) {
        existing.forEach(e => {
          // Incorporate received_amount to prevent aggressive deduping of distinct payments
          const key = `${e.faculty_name || ''}|${e.paper_title || ''}|${e.amount_credited_date || ''}|${e.received_amount || ''}`
          existingSet.add(key)
        })
      }
    }

    // Cross-sheet smart backfill for missing department or phd_status.
    const globalFacultyCache = new Map<string, { dept?: string, phd?: string }>();
    
    for (const row of allRows) {
      if (!row.faculty_name) continue;
      const key = row.faculty_name.toLowerCase().replace(/\s+/g, '').trim();
      if (!globalFacultyCache.has(key)) globalFacultyCache.set(key, {});
      
      const cache = globalFacultyCache.get(key)!;
      if (row.department && !cache.dept) cache.dept = row.department;
      if (row.phd_status && !cache.phd) cache.phd = row.phd_status;
    }
    
    for (const row of allRows) {
      if (!row.faculty_name) continue;
      const key = row.faculty_name.toLowerCase().replace(/\s+/g, '').trim();
      const cache = globalFacultyCache.get(key);
      if (cache) {
        if (!row.department && cache.dept) row.department = cache.dept;
        if (!row.phd_status && cache.phd) row.phd_status = cache.phd;
      }
      // Fallback: If still no phd_status, check if the name literally starts with Dr.
      if (!row.phd_status && row.faculty_name) {
        const lowerName = row.faculty_name.toLowerCase().trim();
        if (lowerName.startsWith('dr.') || lowerName.startsWith('dr ')) {
          row.phd_status = 'Dr';
        }
      }
    }

    const newRows = []
    let deduppedCount = 0
    let fileKeys = new Set<string>()

    for (const row of allRows) {
      // In replace mode we do not dedup internal rows aggressively to preserve identical duplicate payments if they exist
      if (mode === 'replace') {
        newRows.push(row)
        continue
      }
      
      const key = `${row.faculty_name || ''}|${row.paper_title || ''}|${row.amount_credited_date || ''}|${row.received_amount || ''}`
      if (key !== '|||') {
        if (existingSet.has(key) || fileKeys.has(key)) {
          deduppedCount++
          continue
        }
        fileKeys.add(key)
      }
      newRows.push(row)
    }

    console.log(`[Incentives Import] Total accumulated rows: ${allRows.length}. After cross-sheet deduping: ${newRows.length} (Deduped: ${deduppedCount})`)

    if (newRows.length > 0) {
      console.log(`[Incentives Import] Initiating insert of ${newRows.length} records into legacy_incentives...`)
      const { error: insError } = await admin.from('legacy_incentives').insert(newRows)
      if (insError) {
        console.error(`[Incentives Import] Insert failed! Exact error:`, insError)
        return NextResponse.json({ 
          error: 'Database insert failed', 
          details: insError 
        }, { status: 500 })
      }
      console.log(`[Incentives Import] Insert successful.`)
    } else {
      console.log(`[Incentives Import] No new records to insert.`)
    }

    console.log(`[Incentives Import] Finished completely. Imported: ${newRows.length}, Skipped: ${totalSkipped + deduppedCount}, Deleted: ${totalDeleted}`)
    
    return NextResponse.json({ 
      imported: newRows.length, 
      skipped: totalSkipped + deduppedCount,
      deleted: totalDeleted,
      mode: mode,
      sheets: sheetStats,
      errors: errors 
    })

  } catch (error: any) {
    console.error('[Incentives Import] Top-level import error:', error)
    return NextResponse.json({ 
      error: error.message || 'Import failed',
      details: error 
    }, { status: 500 })
  }
}
