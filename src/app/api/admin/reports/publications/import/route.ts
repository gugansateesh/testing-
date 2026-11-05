import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken } from '@/lib/verifyAuth'
import { parseSpreadsheetRows } from '@/lib/importSpreadsheet'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PUBLICATIONS_COLUMN_MAP = {
  s_no: ['S.No', 'S No', 'S. No.'],
  authors: 'Authors',
  title: 'Title',
  source_title: ['Source title', 'Source Title'],
  volume: 'Volume',
  issue: 'Issue',
  year: 'Year',
  doi: 'DOI',
  link: 'Link',
  duplicates_raw: ['Duplicates', 'Duplicate'],
  proof_full_paper_url: ['Full Paper Link', 'Full Paper URL'],
  proof_scopus_url: ['Scopus Proof Link', 'Scopus Proof URL', 'Scopus Link'],
  proof_published_url: ['Published Proof Link', 'Published Proof URL', 'Published Link'],
  document_type_scopus: ['Document Type in Scopus', 'Document Type Scopus', 'Document Type', 'Doc Type (Scopus)'],
  document_type_report: ['Document Type as per Report', 'Document Type Report', 'Doc Type (Report)'],
  department: ['Department', 'Dept'],
  faculty_name: ['Name of the Faculty', 'Faculty Name', 'Faculty'],
  emp_id: ['Emp ID', 'Employee ID', 'EmpID'],
  publication_date: ['Date', 'Publication Date'],
  publication_month: ['Month', 'Publication Month']
};

export async function POST(request: Request) {
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const mode = (formData.get('mode') as string) || 'append'
    
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
    const { rows, skipped } = await parseSpreadsheetRows(buffer, PUBLICATIONS_COLUMN_MAP)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid data found in the spreadsheet' }, { status: 400 })
    }

    const admin = createAdminClient()
    let deletedCount = 0

    if (mode === 'replace') {
      const { count, error: deleteError } = await admin
        .from('legacy_publications')
        .delete({ count: 'exact' })
        .not('id', 'is', null)
      
      if (deleteError) throw deleteError
      deletedCount = count || 0
    }

    // Dedup check: fetch ALL existing DOIs, Links, and Titles (only if append mode)
    const { data: existing, error: dedupError } = mode === 'append' 
      ? await admin
          .from('legacy_publications')
          .select('doi, link, title, faculty_name')
      : { data: [], error: null }
      
    if (dedupError) throw dedupError;
    
    // In append mode, track exact existing records (same DOI/Title + faculty) to avoid re-inserting
    const existingExactSet = new Set<string>()
    if (mode === 'append' && existing) {
      existing.forEach(e => {
        const d = (e.doi || '').trim().toLowerCase()
        const t = (e.title || '').trim().toLowerCase()
        const f = (e.faculty_name || '').trim().toLowerCase()
        if (d && f) existingExactSet.add(`${d}:::${f}`)
        if (t && f) existingExactSet.add(`${t}:::${f}`)
      })
    }

    const seenDois = new Set<string>()
    const seenTitles = new Set<string>()

    const newRows = []
    let duplicateCount = 0
    let skippedEmpty = 0
    let skippedExact = 0

    console.log(`[Import Publications] Total rows parsed from file: ${rows.length}`)

    for (const row of rows) {
      if (row.year) row.year = parseInt(row.year, 10) || null
      if (row.s_no) row.s_no = parseInt(row.s_no, 10) || null
      if (row.department) row.department = row.department.toString().trim().toUpperCase()

      // Convert "Yes"/"No"/"yes"/"no" Duplicates column → boolean is_duplicate
      let isDuplicateFlag = false
      if (row.duplicates_raw !== undefined && row.duplicates_raw !== null) {
        const rawStr = String(row.duplicates_raw).trim().toLowerCase()
        isDuplicateFlag = rawStr === 'yes' || rawStr === 'true' || rawStr === '1'
      }

      // Check legacy +1 marker on DOI
      const rawDoi = (row.doi || '').trim()
      if (rawDoi.endsWith('+1')) {
        isDuplicateFlag = true
        row.doi = rawDoi.slice(0, -2).trim()
      }

      delete row.duplicates_raw // don't insert this helper field to DB
      
      const cleanDoi = (row.doi || '').trim().toLowerCase()
      const cleanTitle = (row.title || '').trim().toLowerCase()
      const cleanFaculty = (row.faculty_name || '').trim().toLowerCase()

      // Skip completely empty rows
      if (!cleanTitle && !cleanDoi && !cleanFaculty && !row.authors) {
        skippedEmpty++
        continue
      }

      // In append mode, skip if the exact record (same DOI/Title AND same faculty) already exists in DB
      if (mode === 'append') {
        const doiKey = cleanDoi && cleanFaculty ? `${cleanDoi}:::${cleanFaculty}` : ''
        const titleKey = cleanTitle && cleanFaculty ? `${cleanTitle}:::${cleanFaculty}` : ''
        if ((doiKey && existingExactSet.has(doiKey)) || (titleKey && existingExactSet.has(titleKey))) {
          skippedExact++
          continue
        }
      }

      // If not already flagged by the spreadsheet, check if this DOI or Title was seen earlier in the file
      if (!isDuplicateFlag) {
        if (cleanDoi && seenDois.has(cleanDoi)) {
          isDuplicateFlag = true
        } else if (cleanTitle && seenTitles.has(cleanTitle)) {
          isDuplicateFlag = true
        }
      }

      if (cleanDoi) seenDois.add(cleanDoi)
      if (cleanTitle) seenTitles.add(cleanTitle)

      if (isDuplicateFlag) {
        duplicateCount++
      }

      newRows.push({ ...row, is_duplicate: isDuplicateFlag })
    }

    console.log(`[Import Publications] Valid rows to insert: ${newRows.length} (duplicates marked: ${duplicateCount})`)
    console.log(`[Import Publications] Skipped: empty=${skippedEmpty}, exact_matches=${skippedExact}`)

    // Batch insert in chunks of 500
    const BATCH_SIZE = 500
    for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
      const batch = newRows.slice(i, i + BATCH_SIZE)
      const { error: insertError } = await admin.from('legacy_publications').insert(batch)
      if (insertError) throw insertError
    }

    return NextResponse.json({ 
      mode,
      deleted: deletedCount,
      imported: newRows.length, 
      duplicates: duplicateCount,
      skipped: skipped + skippedEmpty + skippedExact,
      errors: [] 
    })

  } catch (error: any) {
    console.error('Import error:', error)
    return NextResponse.json({ error: error.message || 'Import failed' }, { status: 500 })
  }
}
