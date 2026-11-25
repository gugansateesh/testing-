import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { parseSpreadsheetRows } from '@/lib/importSpreadsheet'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Maps DB fields to keyword substrings found in the Excel column headers.
// LANDMINE 1: We intentionally use 'consultancy project' (matches col G) and
// NOT any keyword that could match "Title of the Project" (col F), so col F
// is never claimed. This ensures project_title is always populated from col G,
// which has a value in all 161 rows.
const CONSULTANCY_COLUMN_MAP: Record<string, string | string[]> = {
  department: 'department',
  project_date: 'date',
  academic_year: 'academic year',
  faculty_name: 'name of the faculty',
  project_title: 'consultancy project',
  funding_agency: 'funding agency',
  amount: 'amount',
}

/**
 * Normalize academic year from "YYYY-YY" (2-digit end year) to "YYYY-YYYY" (4-digit).
 * e.g. "2019-20" → "2019-2020", "2022-23" → "2022-2023"
 * Already-correct "2023-2024" format is returned unchanged.
 */
function normalizeAcademicYear(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  // Match "YYYY-YY" but NOT "YYYY-YYYY"
  const match = trimmed.match(/^(\d{4})-(\d{2})$/)
  if (match) {
    const startYear = parseInt(match[1], 10)
    const endYY = parseInt(match[2], 10)
    // Century is the same as the start year's century
    const century = Math.floor(startYear / 100) * 100
    const endYear = century + endYY
    return `${startYear}-${endYear}`
  }
  return trimmed
}

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

    console.log(`[Consultancy Import] Starting import. Mode: ${mode}, File: ${file.name}, Size: ${file.size}`)

    // This file is a single-sheet workbook. We match loosely on 'consultancy' in the sheet
    // name to be robust against future renames.
    const targetSheet = workbook.worksheets.find(s =>
      s.name.toLowerCase().includes('consultancy')
    ) || workbook.worksheets[0]

    if (!targetSheet) {
      return NextResponse.json({ error: 'No worksheet found in the Excel file' }, { status: 400 })
    }

    console.log(`[Consultancy Import] Parsing sheet: "${targetSheet.name}"...`)

    try {
      const { rows, skipped } = await parseSpreadsheetRows(buffer, CONSULTANCY_COLUMN_MAP, targetSheet.name)

      // Diagnostic: confirm project_date is being captured correctly
      console.log(`[Consultancy Import] Sample first row project_date: "${rows[0]?.project_date}" (should be a date string, not null)`)
      console.log(`[Consultancy Import] Sample first row full data:`, JSON.stringify(rows[0] || {}))

      // LANDMINE 2: Normalize academic_year on every row
      // Also strip commas from amount (Indian number format e.g. "5,90,000" → 590000)
      rows.forEach(r => {
        r.academic_year = normalizeAcademicYear(r.academic_year)
        if (r.amount && typeof r.amount === 'string') {
          r.amount = parseFloat(r.amount.replace(/,/g, '')) || null
        }
        // Also handle numeric amounts that come in as numbers already
        if (typeof r.amount === 'number') {
          r.amount = r.amount // already fine
        }
      })

      allRows.push(...rows)
      totalSkipped += skipped
      console.log(`[Consultancy Import] Sheet "${targetSheet.name}": Parsed ${rows.length} rows, Skipped ${skipped} empty/invalid rows.`)
      sheetStats.push({
        name: targetSheet.name,
        rowsFound: rows.length + skipped,
        rowsParsed: rows.length,
        rowsSkipped: skipped,
        skipped: false,
        error: null,
      })
    } catch (sheetErr: any) {
      console.error(`[Consultancy Import] Error parsing sheet "${targetSheet.name}":`, sheetErr)
      errors.push({ sheet: targetSheet.name, error: sheetErr.message || String(sheetErr) })
      sheetStats.push({ name: targetSheet.name, skipped: false, error: sheetErr.message || String(sheetErr) })
    }

    if (allRows.length === 0) {
      return NextResponse.json({ error: 'No valid data found in the spreadsheet' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (mode === 'replace') {
      console.log(`[Consultancy Import] Mode is REPLACE. Deleting existing legacy_consultancy records...`)
      const { data: delData, error: delError } = await admin
        .from('legacy_consultancy')
        .delete()
        .not('id', 'is', null)
        .select()
      if (delError) {
        console.error(`[Consultancy Import] Delete failed!`, delError)
        return NextResponse.json({
          error: 'Failed to delete existing data before replacement.',
          details: delError,
        }, { status: 500 })
      }
      totalDeleted = delData?.length || 0
      console.log(`[Consultancy Import] Deleted ${totalDeleted} records.`)
    }

    // Dedup check (append mode): faculty_name + project_title + project_date
    let existingSet = new Set<string>()

    if (mode !== 'replace') {
      const { data: existing } = await admin
        .from('legacy_consultancy')
        .select('faculty_name, project_title, project_date, academic_year, amount')
      if (existing) {
        existing.forEach(e => {
          const key = `${e.faculty_name || ''}|${e.project_title || ''}|${e.project_date || ''}|${e.academic_year || ''}|${e.amount || ''}`
          existingSet.add(key)
        })
      }
    }

    const newRows: any[] = []
    let deduppedCount = 0
    const fileKeys = new Set<string>()

    for (const row of allRows) {
      if (mode === 'replace') {
        newRows.push(row)
        continue
      }
      
      const key = `${row.faculty_name || ''}|${row.project_title || ''}|${row.project_date || ''}|${row.academic_year || ''}|${row.amount || ''}`
      if (key !== '||||') {
        if (existingSet.has(key) || fileKeys.has(key)) {
          deduppedCount++
          continue
        }
        fileKeys.add(key)
      }
      newRows.push(row)
    }

    console.log(`[Consultancy Import] After dedup: ${newRows.length} new rows (deduped: ${deduppedCount})`)

    if (newRows.length > 0) {
      console.log(`[Consultancy Import] Inserting ${newRows.length} records...`)
      const { error: insError } = await admin.from('legacy_consultancy').insert(newRows)
      if (insError) {
        console.error(`[Consultancy Import] Insert failed!`, insError)
        return NextResponse.json({
          error: 'Database insert failed',
          details: insError,
        }, { status: 500 })
      }
      console.log(`[Consultancy Import] Insert successful.`)
    } else {
      console.log(`[Consultancy Import] No new records to insert.`)
    }

    console.log(`[Consultancy Import] Done. Imported: ${newRows.length}, Skipped: ${totalSkipped + deduppedCount}, Deleted: ${totalDeleted}`)

    return NextResponse.json({
      imported: newRows.length,
      skipped: totalSkipped + deduppedCount,
      deleted: totalDeleted,
      mode,
      sheets: sheetStats,
      errors,
    })
  } catch (error: any) {
    console.error('[Consultancy Import] Top-level error:', error)
    return NextResponse.json({
      error: error.message || 'Import failed',
      details: error,
    }, { status: 500 })
  }
}
