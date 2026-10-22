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
          .select('doi, link, title')
      : { data: [], error: null }
      
    if (dedupError) throw dedupError;
    
    let existingDois = new Set<string>()
    let existingLinks = new Set<string>()
    let existingLinksNoDoi = new Set<string>()
    let existingTitles = new Set<string>()
    let existingTitlesNoLink = new Set<string>()
    let existingTitlesNoDoiNoLink = new Set<string>()

    const addToSets = (d: string, l: string, t: string) => {
      if (d) existingDois.add(d)
      if (l) {
        existingLinks.add(l)
        if (!d) existingLinksNoDoi.add(l)
      }
      if (t) {
        existingTitles.add(t)
        if (!l) existingTitlesNoLink.add(t)
        if (!d && !l) existingTitlesNoDoiNoLink.add(t)
      }
    }
    
    if (existing) {
      existing.forEach(e => {
        const d = (e.doi || '').trim().toLowerCase()
        const l = (e.link || '').trim().toLowerCase()
        const t = (e.title || '').trim().toLowerCase()
        addToSets(d, l, t)
      })
    }

    const newRows = []
    
    let emptyDoiCount = 0
    let emptyLinkCount = 0
    let emptyTitleCount = 0
    
    let doiMatchDrops = 0
    let linkMatchDrops = 0
    let titleMatchDrops = 0

    console.log(`[Import Publications] Total rows parsed from file: ${rows.length}`)

    for (const row of rows) {
      if (row.year) row.year = parseInt(row.year, 10) || null
      if (row.s_no) row.s_no = parseInt(row.s_no, 10) || null
      if (row.department) row.department = row.department.toString().trim().toUpperCase()

      // Convert "Yes"/"No"/"yes"/"no" Duplicates column → boolean is_duplicate
      let isDuplicateFlag = false
      if (row.duplicates_raw !== undefined) {
        isDuplicateFlag = String(row.duplicates_raw).trim().toLowerCase() === 'yes'
      }
      // Legacy fallback: DOI ending in '+1' was the old way to flag duplicates
      if (!isDuplicateFlag && (row.doi || '').trim().endsWith('+1')) {
        isDuplicateFlag = true
      }
      delete row.duplicates_raw // don't insert this helper field to DB
      
      const cleanDoi = (row.doi || '').trim().toLowerCase()
      const cleanLink = (row.link || '').trim().toLowerCase()
      const cleanTitle = (row.title || '').trim().toLowerCase()
      
      if (!cleanDoi) emptyDoiCount++
      if (!cleanLink) emptyLinkCount++
      if (!cleanTitle) emptyTitleCount++
      
      let isDuplicate = false

      if (cleanDoi) {
        if (existingDois.has(cleanDoi)) {
          doiMatchDrops++
          isDuplicate = true
        } else if (cleanLink && existingLinksNoDoi.has(cleanLink)) {
          linkMatchDrops++
          isDuplicate = true
        } else if (cleanTitle && existingTitlesNoDoiNoLink.has(cleanTitle)) {
          titleMatchDrops++
          isDuplicate = true
        }
      } else if (cleanLink) {
        if (existingLinks.has(cleanLink)) {
          linkMatchDrops++
          isDuplicate = true
        } else if (cleanTitle && existingTitlesNoLink.has(cleanTitle)) {
          titleMatchDrops++
          isDuplicate = true
        }
      } else if (cleanTitle) {
        if (existingTitles.has(cleanTitle)) {
          titleMatchDrops++
          isDuplicate = true
        }
      }

      if (isDuplicate) continue
      
      addToSets(cleanDoi, cleanLink, cleanTitle)
      newRows.push({ ...row, is_duplicate: isDuplicateFlag })
    }

    console.log(`[Import Publications] Empty values at parse time: DOI=${emptyDoiCount}, Link=${emptyLinkCount}, Title=${emptyTitleCount}`)
    console.log(`[Import Publications] Dropped due to DOI match: ${doiMatchDrops}`)
    console.log(`[Import Publications] Dropped due to Link match: ${linkMatchDrops}`)
    console.log(`[Import Publications] Dropped due to Title match: ${titleMatchDrops}`)
    console.log(`[Import Publications] Genuine new rows to insert: ${newRows.length}`)

    if (newRows.length > 0) {
      const { error } = await admin.from('legacy_publications').insert(newRows)
      if (error) throw error
    }

    return NextResponse.json({ 
      mode,
      deleted: deletedCount,
      imported: newRows.length, 
      skipped: skipped + doiMatchDrops + linkMatchDrops + titleMatchDrops,
      errors: [] 
    })

  } catch (error: any) {
    console.error('Import error:', error)
    return NextResponse.json({ error: error.message || 'Import failed' }, { status: 500 })
  }
}
