import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const getText = (val: any): string | null => {
  if (val === null || val === undefined) return null
  if (typeof val === 'object') {
    if (val.richText) return val.richText.map((rt: any) => rt.text).join('')
    if (val.text) return val.text
    if (val instanceof Date) return val.toISOString().split('T')[0]
    // Formula result objects: { formula: '=SUM(...)', result: 123 }
    if (val.formula !== undefined && val.result !== undefined) {
      return val.result != null ? String(val.result) : null
    }
  }
  return String(val).trim()
}

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
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json({ error: 'Only Excel files are allowed' }, { status: 400 })
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 10MB' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as any)

    const sheet = workbook.getWorksheet('SEED MONEY') || workbook.worksheets[0]
    if (!sheet) {
      return NextResponse.json({ error: 'SEED MONEY sheet not found in workbook' }, { status: 400 })
    }

    // Column map for SEED MONEY sheet (header row 2):
    // Col A: S. No | Col B: Academic Year | Col C: Dept | Col D: Title of the Project proposal
    // Col E: Name of the faculty provided with Seed Money | Col F: Duration of the Project | Col G: Amount of Seed Money Sanctioned
    // Row 1 is a title/grand-total row — skip it
    // Row 2 is the header row — skip it
    // Any row where col A is the literal string "Total" is a subtotal row — skip it

    const parsed: any[] = []
    let skipped = 0

    sheet.eachRow((row, rowNumber) => {
      // Skip title row (row 1) and header row (row 2)
      if (rowNumber <= 2) return

      const vals = row.values as any[] // ExcelJS row.values is 1-indexed

      const colA = getText(vals[1]) // S. No
      const colB = getText(vals[2]) // Academic Year
      const colC = getText(vals[3]) // Dept
      const colD = getText(vals[4]) // Project Title
      const colE = getText(vals[5]) // Faculty Name
      const colF = getText(vals[6]) // Duration
      const colG = getText(vals[7]) // Amount

      // Skip grand-total / title row 1 (col A contains "Seed Money" or similar non-numeric non-"Total" text)
      // Skip subtotal rows: col A is the literal string "Total"
      if (colA && colA.trim().toLowerCase() === 'total') {
        skipped++
        return
      }

      // Skip rows where amount is a formula string (starts with "=")
      if (colG && colG.trim().startsWith('=')) {
        skipped++
        return
      }

      // Skip completely empty rows
      if (!colA && !colB && !colC && !colD && !colE) {
        skipped++
        return
      }

      // If row has no project title and no faculty name, skip
      if (!colD && !colE) {
        skipped++
        return
      }

      // Parse s_no — must be a number, else skip (catches "Total" and title rows that slipped through)
      let s_no: string | null = null
      if (colA) {
        const asNum = parseFloat(colA.replace(/[^0-9.]/g, ''))
        if (!isNaN(asNum)) {
          s_no = String(Math.round(asNum))
        }
        // If colA is text but not "total" (already handled above), still allow the row
        // but don't assign s_no
      }

      // Parse amount
      let amount_sanctioned: number | null = null
      if (colG) {
        const cleaned = String(colG).replace(/[^0-9.]/g, '')
        const parsed_amt = parseFloat(cleaned)
        if (!isNaN(parsed_amt)) {
          amount_sanctioned = parsed_amt
        }
      }

      parsed.push({
        s_no,
        academic_year: colB || null,
        dept: colC || null,
        project_title: colD || null,
        faculty_name: colE || null,
        duration: colF || null,
        amount_sanctioned,
      })
    })

    if (parsed.length === 0) {
      return NextResponse.json({ error: 'No valid data rows found in SEED MONEY sheet' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Dedup-append: composite key = project_title + faculty_name + academic_year
    const { data: existing, error: dedupError } = await admin
      .from('legacy_seed_fund_grants')
      .select('project_title, faculty_name, academic_year')

    if (dedupError) throw dedupError

    const existingKeys = new Set(
      (existing || []).map((r: any) =>
        `${(r.project_title || '').trim().toLowerCase()}||${(r.faculty_name || '').trim().toLowerCase()}||${(r.academic_year || '').trim()}`
      )
    )

    const newRows: any[] = []
    let dupCount = 0

    for (const row of parsed) {
      const key = `${(row.project_title || '').trim().toLowerCase()}||${(row.faculty_name || '').trim().toLowerCase()}||${(row.academic_year || '').trim()}`
      if (existingKeys.has(key)) {
        dupCount++
        continue
      }
      existingKeys.add(key)
      newRows.push(row)
    }

    if (newRows.length > 0) {
      console.log('Inserting newRows:', newRows.length)
      const { error } = await admin.from('legacy_seed_fund_grants').insert(newRows)
      if (error) {
         console.error('Insert error:', error)
         throw error
      }
    } else {
      console.log('No new rows to insert. Parsed:', parsed.length, 'Existing keys:', existingKeys.size)
    }

    return NextResponse.json({

      imported: newRows.length,
      skipped: skipped + dupCount,
      errors: []
    })

  } catch (error: any) {
    console.error('Seed fund import error:', error)
    return NextResponse.json({ error: error.message || 'Import failed' }, { status: 500 })
  }
}
