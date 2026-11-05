/**
 * facultyTargetStats.ts
 *
 * Single source of truth for computing a faculty member's ACHIEVED publication
 * counts for a given academic year. Used by:
 *   - /api/admin/reports/publication-targets        (admin drill-down)
 *   - /api/admin/reports/publication-targets/summary (overview card)
 *   - /api/profile/publication-target               (staff profile)
 *
 * DO NOT reimplement this logic elsewhere — duplicated stat logic has caused
 * bugs on multiple other pages in this project.
 *
 * Year format note (verified 2026-09-12):
 *   legacy_publications.year is stored as a plain integer (2010, 2011, …, 2026).
 *   submissions.year is also a plain integer.
 *   academic_year in faculty_publication_targets is a text string like '2026'.
 *   All queries use parseInt(academic_year) when filtering these tables.
 *
 * Matching strategy:
 *   submissions  → join via submitted_by = master_faculty.user_id (reliable)
 *   legacy_publications → match via faculty_name ILIKE master_faculty.name
 *                         (normalized: trimmed, case-insensitive)
 *                         Rows that cannot be matched are logged + counted.
 *
 * Excluded category: 'Student Publication' rows are excluded from all
 *   faculty target calculations (targets cover only faculty-authored pubs).
 */

import { createAdminClient } from '@/lib/supabase'

export interface FacultyAchievement {
  sci_achieved: number
  scopus_journal_achieved: number
  scopus_conference_achieved: number
  total_achieved: number
  /** Number of legacy_publications rows matched to this faculty name */
  legacy_matched: number
  /** Unmatched legacy rows (for diagnostic logging) — only populated in single-faculty mode */
  unmatched_legacy_count?: number
  // Extended achievements (from patents, consultancy, seed fund modules)
  student_publication_achieved: number
  utility_patent_achieved: number
  design_patent_achieved: number
  copyright_achieved: number
  funding_achieved: number
  consultancy_achieved: number
}

export interface FacultyTarget {
  emp_id: string
  name: string
  dept: string
  academic_year: string
  sci_target: number
  scopus_journal_target: number
  scopus_conference_target: number
  total_target: number
  // Extended targets (from publication targets Excel)
  student_publication_target: number
  utility_patent_target: number
  design_patent_target: number
  copyright_target: number
  funding_target: number
  consultancy_target: number
  designation: string | null
  faculty_type: string | null
}

export interface FacultyTargetWithAchievement extends FacultyTarget {
  achievement: FacultyAchievement
  met_target: boolean
  user_id: string | null
  /** Internal flag: true when achieved values came from static Excel seed (not live-computed) */
  _hasStaticAchievement?: boolean
}

/** Normalize a faculty name for matching (trim + lowercase) */
function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Classify a document_type_report string into one of the three target categories.
 * Returns null for 'Student Publication' and other non-faculty categories.
 */
function classifyDocType(docType: string | null): 'sci' | 'journal' | 'conference' | null {
  if (!docType) return null
  const d = docType.trim()
  if (d === 'SCI') return 'sci'
  if (d === 'Scopus/WoS Journals') return 'journal'
  if (d === 'Scopus/WoS Conference/Book Chapter/Others') return 'conference'
  // Explicitly exclude 'Student Publication' and anything else
  return null
}

/**
 * Compute achieved publication counts for a SINGLE faculty member in a given year.
 *
 * @param emp_id     - The faculty's emp_id from master_faculty
 * @param academic_year - Plain year string, e.g. '2026'
 * @returns FacultyAchievement with per-category and total counts
 */
export async function getFacultyAchievement(
  emp_id: string,
  academic_year: string
): Promise<FacultyAchievement> {
  const admin = createAdminClient()
  const yearInt = parseInt(academic_year, 10)

  // 1. Look up master_faculty to get user_id (for live subs) and name (for legacy fallback)
  const { data: mfRow, error: mfError } = await admin
    .from('master_faculty')
    .select('user_id, name')
    .eq('emp_id', emp_id)
    .single()

  if (mfError || !mfRow) {
    console.warn(`[facultyTargetStats] emp_id ${emp_id} not found in master_faculty:`, mfError?.message)
    return { sci_achieved: 0, scopus_journal_achieved: 0, scopus_conference_achieved: 0, total_achieved: 0, legacy_matched: 0, unmatched_legacy_count: 0, student_publication_achieved: 0, utility_patent_achieved: 0, design_patent_achieved: 0, copyright_achieved: 0, funding_achieved: 0, consultancy_achieved: 0 }
  }

  const { user_id, name } = mfRow
  const counts = { sci: 0, journal: 0, conference: 0 }

  // 2. Count from submissions (live, approved) via user_id
  if (user_id) {
    const { data: subs, error: subsError } = await admin
      .from('submissions')
      .select('doc_type_report')
      .eq('submitted_by', user_id)
      .eq('status', 'approved')
      .eq('year', yearInt)

    if (subsError) {
      console.error(`[facultyTargetStats] submissions error for ${emp_id}:`, subsError.message)
    } else {
      for (const sub of subs ?? []) {
        const cat = classifyDocType(sub.doc_type_report)
        if (cat) counts[cat]++
      }
    }
  }

  // 3. Count from legacy_publications via faculty_name match
  let legacyMatched = 0
  let unmatchedLegacyCount = 0
  const normalizedName = normalizeName(name)

  const { data: legacyRows, error: legacyError } = await admin
    .from('legacy_publications')
    .select('document_type_report')
    .eq('emp_id', emp_id)
    .eq('year', yearInt)

  if (legacyError) {
    console.error(`[facultyTargetStats] legacy_publications error for ${emp_id}:`, legacyError.message)
  } else {
    for (const row of legacyRows ?? []) {
      const cat = classifyDocType(row.document_type_report)
      if (cat) {
        counts[cat]++
        legacyMatched++
      }
      // Student Publication and null: silently skip (not counted towards faculty targets)
    }
  }

  const total = counts.sci + counts.journal + counts.conference

  return {
    sci_achieved: counts.sci,
    scopus_journal_achieved: counts.journal,
    scopus_conference_achieved: counts.conference,
    total_achieved: total,
    legacy_matched: legacyMatched,
    unmatched_legacy_count: unmatchedLegacyCount,
    student_publication_achieved: 0,
    utility_patent_achieved: 0,
    design_patent_achieved: 0,
    copyright_achieved: 0,
    funding_achieved: 0,
    consultancy_achieved: 0,
  }
}

/**
 * Batch-load ALL faculty targets for a given academic year, resolving achievement
 * for each in bulk (two aggregate queries — one for submissions, one for legacy)
 * rather than N individual calls.
 *
 * Faculty without a target row are returned with null targets if includeNoTarget=true.
 */
export async function getFacultyTargetsWithAchievement(
  academic_year: string,
  opts: { includeNoTarget?: boolean } = {}
): Promise<FacultyTargetWithAchievement[]> {
  const admin = createAdminClient()
  const yearInt = parseInt(academic_year, 10)

  let targets: any[] = []

  if (opts.includeNoTarget) {
    const { data: allFaculty } = await admin.from('master_faculty').select('emp_id, name, dept, user_id')
    const { data: allTargets } = await admin.from('faculty_publication_targets').select('*').eq('academic_year', academic_year)
    const targetsByEmpId = new Map(allTargets?.map(t => [t.emp_id, t]) || [])
    
    targets = allFaculty?.map(mf => {
      const t = targetsByEmpId.get(mf.emp_id)
      return {
        emp_id: mf.emp_id,
        academic_year,
        sci_target: t?.sci_target ?? 0,
        scopus_journal_target: t?.scopus_journal_target ?? 0,
        scopus_conference_target: t?.scopus_conference_target ?? 0,
        sci_achieved_static: t?.sci_achieved_static ?? null,
        scopus_journal_achieved_static: t?.scopus_journal_achieved_static ?? null,
        scopus_conference_achieved_static: t?.scopus_conference_achieved_static ?? null,
        student_publication_target: t?.student_publication_target ?? 0,
        utility_patent_target: t?.utility_patent_target ?? 0,
        design_patent_target: t?.design_patent_target ?? 0,
        copyright_target: t?.copyright_target ?? 0,
        funding_target: t?.funding_target ?? 0,
        consultancy_target: t?.consultancy_target ?? 0,
        designation: t?.designation ?? null,
        faculty_type: t?.faculty_type ?? null,
        master_faculty: mf
      }
    }) || []
  } else {
    // Load only those with targets
    const { data: dbTargets, error: targetsError } = await admin
      .from('faculty_publication_targets')
      .select(`
        emp_id,
        academic_year,
        sci_target,
        scopus_journal_target,
        scopus_conference_target,
        sci_achieved_static,
        scopus_journal_achieved_static,
        scopus_conference_achieved_static,
        student_publication_target,
        utility_patent_target,
        design_patent_target,
        copyright_target,
        funding_target,
        consultancy_target,
        designation,
        faculty_type,
        master_faculty!inner(name, dept, user_id)
      `)
      .eq('academic_year', academic_year)

    if (targetsError) {
      console.error('[facultyTargetStats] Error loading targets:', targetsError.message)
      return []
    }
    targets = dbTargets || []
  }

  if (targets.length === 0) return []

  // Build lookup maps: user_id -> emp_id, name -> emp_id
  const userIdToEmpId = new Map<string, string>()
  const nameToEmpId = new Map<string, string>()
  const targetMap = new Map<string, FacultyTargetWithAchievement>()

  for (const t of targets) {
    const mf = t.master_faculty as any
    const total = t.sci_target + t.scopus_journal_target + t.scopus_conference_target
    // Check if static achieved values are available (seeded from official Excel report)
    const hasStatic = t.sci_achieved_static !== null && t.sci_achieved_static !== undefined
    const entry: FacultyTargetWithAchievement = {
      emp_id: t.emp_id,
      name: mf.name,
      dept: mf.dept,
      academic_year,
      sci_target: t.sci_target,
      scopus_journal_target: t.scopus_journal_target,
      scopus_conference_target: t.scopus_conference_target,
      total_target: total,
      user_id: mf.user_id,
      student_publication_target: t.student_publication_target ?? 0,
      utility_patent_target: t.utility_patent_target ?? 0,
      design_patent_target: t.design_patent_target ?? 0,
      copyright_target: t.copyright_target ?? 0,
      funding_target: t.funding_target ?? 0,
      consultancy_target: t.consultancy_target ?? 0,
      designation: t.designation ?? null,
      faculty_type: t.faculty_type ?? null,
      achievement: {
        sci_achieved: hasStatic ? (t.sci_achieved_static ?? 0) : 0,
        scopus_journal_achieved: hasStatic ? (t.scopus_journal_achieved_static ?? 0) : 0,
        scopus_conference_achieved: hasStatic ? (t.scopus_conference_achieved_static ?? 0) : 0,
        total_achieved: hasStatic
          ? ((t.sci_achieved_static ?? 0) + (t.scopus_journal_achieved_static ?? 0) + (t.scopus_conference_achieved_static ?? 0))
          : 0,
        legacy_matched: 0,
          student_publication_achieved: 0,
          utility_patent_achieved: 0,
          design_patent_achieved: 0,
          copyright_achieved: 0,
          funding_achieved: 0,
          consultancy_achieved: 0,
        },
      met_target: false,
      _hasStaticAchievement: hasStatic,
    }
    targetMap.set(t.emp_id, entry)
    if (!hasStatic && mf.user_id) userIdToEmpId.set(mf.user_id, t.emp_id)
    if (!hasStatic) nameToEmpId.set(normalizeName(mf.name), t.emp_id)
  }

  const userIds = [...userIdToEmpId.keys()].filter(Boolean)

  // 2a. Bulk-fetch all approved submissions for these user_ids in this year
  if (userIds.length > 0) {
    const { data: subs, error: subsError } = await admin
      .from('submissions')
      .select('submitted_by, doc_type_report')
      .in('submitted_by', userIds)
      .eq('status', 'approved')
      .eq('year', yearInt)

    if (subsError) {
      console.error('[facultyTargetStats] Batch submissions error:', subsError.message)
    } else {
      for (const sub of subs ?? []) {
        const empId = userIdToEmpId.get(sub.submitted_by)
        if (!empId) continue
        const cat = classifyDocType(sub.doc_type_report)
        if (!cat) continue
        const entry = targetMap.get(empId)
        if (entry) entry.achievement[`${cat}_achieved` as keyof FacultyAchievement]  = (entry.achievement[`${cat}_achieved` as keyof FacultyAchievement] as number) + 1
      }
    }
  }

  // 2b. Bulk-fetch all legacy_publications for this year
  // We fetch all rows and match by normalized name against our map
  // (Fetched in pages of 1000 to handle large datasets)
  let legacyPage = 0
  const legacyPageSize = 1000
  let hasMoreLegacy = true

  while (hasMoreLegacy) {
    const { data: legacyRows, error: legacyError } = await admin
      .from('legacy_publications')
      .select('emp_id, document_type_report')
      .eq('year', yearInt)
      .not('emp_id', 'is', null)
      .range(legacyPage * legacyPageSize, (legacyPage + 1) * legacyPageSize - 1)

    if (legacyError) {
      console.error('[facultyTargetStats] Batch legacy error:', legacyError.message)
      break
    }
    if (!legacyRows || legacyRows.length === 0) { hasMoreLegacy = false; break }

    for (const row of legacyRows) {
      const empId = row.emp_id
      if (!empId) continue // Not in our target set

      const cat = classifyDocType(row.document_type_report)
      if (!cat) continue // Student Publication etc.

      const entry = targetMap.get(empId)
      if (entry) {
        entry.achievement[`${cat}_achieved` as keyof FacultyAchievement] = (entry.achievement[`${cat}_achieved` as keyof FacultyAchievement] as number) + 1
        entry.achievement.legacy_matched++
      }
    }

    if (legacyRows.length < legacyPageSize) hasMoreLegacy = false
    else legacyPage++
  }

  // 3. Compute totals and met_target flags
  for (const entry of targetMap.values()) {
    const a = entry.achievement
    if (!(entry as any)._hasStaticAchievement) {
      a.total_achieved = a.sci_achieved + a.scopus_journal_achieved + a.scopus_conference_achieved
    }
    entry.met_target = a.total_achieved >= entry.total_target && entry.total_target > 0
  }

  // 4. Fetch extended achievements (patents, consultancy, seed fund, student pubs)
  const legacyAcYear = `${parseInt(academic_year) - 1}-${academic_year}` // e.g. '2025-2026'
  const allEntries = [...targetMap.values()]
  const allNames = allEntries.map(e => e.name)

  // 4a. Patents (Utility & Design) — split by patent_type, match by emp_id / faculty_name or inventors field
  const { data: patentRows } = await admin
    .from('legacy_patents')
    .select('inventors, patent_type, emp_id, faculty_name')
    .eq('academic_year', legacyAcYear)

  if (patentRows) {
    for (const pat of patentRows) {
      const pType = (pat.patent_type || 'Utility') as string

      // 1. Match by emp_id if present
      if (pat.emp_id && targetMap.has(pat.emp_id)) {
        const entry = targetMap.get(pat.emp_id)!
        if (pType === 'Utility') entry.achievement.utility_patent_achieved++
        else if (pType === 'Design') entry.achievement.design_patent_achieved++
        else if (pType === 'Copyright') entry.achievement.copyright_achieved++
        continue
      }

      // 2. Match by faculty_name if present
      if (pat.faculty_name) {
        const normFac = normalizeName(pat.faculty_name)
        const entry = targetMap.get([...nameToEmpId.entries()].find(([k]) => k === normFac)?.[1] ?? '') ??
          allEntries.find(e => normalizeName(e.name) === normFac)
        if (entry) {
          if (pType === 'Utility') entry.achievement.utility_patent_achieved++
          else if (pType === 'Design') entry.achievement.design_patent_achieved++
          else if (pType === 'Copyright') entry.achievement.copyright_achieved++
          continue
        }
      }

      // 3. Fallback: match by inventors field lines
      if (!pat.inventors) continue
      const inventorLines = pat.inventors.split('\n').map((s: string) => normalizeName(s))
      for (const entry of allEntries) {
        const norm = normalizeName(entry.name)
        // Check if any inventor line exactly matches the faculty name
        const matched = inventorLines.some((inv: string) => inv === norm ||
          inv.replace(/^(dr\.|mr\.|ms\.|prof\.)\s*/i, '') === norm.replace(/^(dr\.|mr\.|ms\.|prof\.)\s*/i, ''))
        if (!matched) continue
        if (pType === 'Utility') entry.achievement.utility_patent_achieved++
        else if (pType === 'Design') entry.achievement.design_patent_achieved++
        else if (pType === 'Copyright') entry.achievement.copyright_achieved++
      }
    }
  }

  // 4b. Consultancy — match by faculty_name
  const { data: consultRows } = await admin
    .from('legacy_consultancy')
    .select('faculty_name, amount')
    .eq('academic_year', legacyAcYear)

  if (consultRows) {
    for (const row of consultRows) {
      const norm = normalizeName(row.faculty_name ?? '')
      const entry = targetMap.get([...nameToEmpId.entries()].find(([k]) => k === norm)?.[1] ?? '') ??
        allEntries.find(e => normalizeName(e.name) === norm)
      if (entry) entry.achievement.consultancy_achieved += (row.amount ?? 0)
    }
  }

  // 4c. Seed Fund Grants — match by faculty_name
  const { data: seedRows } = await admin
    .from('legacy_seed_fund_grants')
    .select('faculty_name, amount_sanctioned')
    .eq('academic_year', legacyAcYear)

  if (seedRows) {
    for (const row of seedRows) {
      const norm = normalizeName(row.faculty_name ?? '')
      const entry = allEntries.find(e => normalizeName(e.name) === norm)
      if (entry) entry.achievement.funding_achieved += (row.amount_sanctioned ?? 0)
    }
  }

  // 4d. Student Publications — from legacy_publications, category = 'Student Publication'
  const { data: studentPubRows } = await admin
    .from('legacy_publications')
    .select('emp_id')
    .eq('year', parseInt(academic_year))
    .eq('document_type_report', 'Student Publication')
    .not('emp_id', 'is', null)

  if (studentPubRows) {
    for (const row of studentPubRows) {
      const entry = targetMap.get(row.emp_id)
      if (entry) entry.achievement.student_publication_achieved++
    }
  }

  return allEntries.sort((a, b) => {
    if (a.dept < b.dept) return -1
    if (a.dept > b.dept) return 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Get a quick summary for the overview card:
 *   { percent_met, count_met, total_with_target, count_no_target }
 *
 * count_no_target = faculty in master_faculty with no target row for this year.
 */
export async function getTargetCompletionSummary(academic_year: string): Promise<{
  percent_met: number
  count_met: number
  total_with_target: number
  count_no_target: number
}> {
  const admin = createAdminClient()

  // Total faculty count
  const { count: totalFaculty } = await admin
    .from('master_faculty')
    .select('*', { count: 'exact', head: true })

  // Faculty with targets this year
  const { count: withTarget } = await admin
    .from('faculty_publication_targets')
    .select('*', { count: 'exact', head: true })
    .eq('academic_year', academic_year)

  const noTarget = (totalFaculty ?? 0) - (withTarget ?? 0)

  // Get all achievements to count met
  const all = await getFacultyTargetsWithAchievement(academic_year)
  const met = all.filter(f => f.met_target).length
  const total = all.length
  const pct = total > 0 ? Math.round((met / total) * 100) : 0

  return {
    percent_met: pct,
    count_met: met,
    total_with_target: total,
    count_no_target: noTarget < 0 ? 0 : noTarget,
  }
}
