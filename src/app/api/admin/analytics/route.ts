import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, requireAdmin } from '@/lib/verifyAuth'
import { fetchAllRows } from '@/lib/fetchAllRows'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await requireAdmin(auth))) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })

  const url = new URL(request.url)
  const yearFilter = url.searchParams.get('year') || ''
  const deptFilter = url.searchParams.get('department') || ''

  try {
    // All source tables are independent, so they are fetched concurrently.
    // fetchAllRows pages past the PostgREST 1000-row cap in parallel.
    // A failed source counts as empty (the previous implementation ignored
    // query errors the same way), so one bad table never blanks the dashboard.
    const all = (table: string, columns: string, filters?: (q: any) => any) =>
      fetchAllRows(admin, table, columns, filters).catch((err: any) => {
        console.warn(`[analytics] ${table} query failed:`, err?.message)
        return [] as any[]
      })

    const [
      submissions,
      incentives,
      rawSeedFunds,
      rawConsultancies,
      rawProjectGrants,
      facultyData,
      legacyPatentsData,
      legacyPubs,
      legacySeedFunds,
      legacyResearchGrants,
      legacyIncentives,
      legacyConsultancy,
      phds,
      supervisors,
      scholars,
      { data: manualStats },
    ] = await Promise.all([
      // 1. Submissions (Scopus)
      all('submissions', 'department, year', q => {
        q = q.eq('status', 'approved')
        if (yearFilter) q = q.eq('year', parseInt(yearFilter))
        if (deptFilter) q = q.eq('department', deptFilter)
        return q
      }),
      // 2. Incentives and Patents
      all('incentive_applications', 'category, department, year, calculated_amount', q => {
        q = q.eq('status', 'approved')
        if (yearFilter) q = q.eq('year', parseInt(yearFilter))
        if (deptFilter) q = q.eq('department', deptFilter)
        return q
      }),
      // 3. Seed Funds
      all('seed_fund_applications', 'applicant_id, created_at, amount_requested', q => q.eq('status', 'approved')),
      // 4. Consultancy
      all('consultancy_applications', 'applicant_id, created_at, consultancy_fee', q => q.eq('status', 'approved')),
      // 5. Project Grants (Live)
      all('project_grant_applications', 'applicant_id, created_at, total_proposed_budget', q => q.eq('status', 'approved')),
      // Applicant → department lookup (only rows with a user_id can match an applicant)
      all('master_faculty', 'user_id, dept', q => q.not('user_id', 'is', null)),
      // 8. Legacy data for completeness
      all('legacy_patents', 'department, academic_year'),
      all('legacy_publications', 'department, year, is_duplicate, document_type_report', q => {
        if (yearFilter) q = q.eq('year', parseInt(yearFilter))
        if (deptFilter) q = q.ilike('department', deptFilter)
        return q
      }),
      all('legacy_seed_fund_grants', 'dept, academic_year, amount_sanctioned', q => deptFilter ? q.eq('dept', deptFilter) : q),
      all('research_grants', 'department, academic_year, grant_amount', q => deptFilter ? q.eq('department', deptFilter) : q),
      // NOTE: single unpaged query (capped at 1000 rows by PostgREST), as before
      (async () => {
        let q = admin.from('legacy_incentives').select('department, received_amount, amount_credited_date, submitted_date, date_of_publication, incentive_year')
        if (deptFilter) q = q.eq('department', deptFilter)
        const { data } = await q
        return data || []
      })(),
      all('legacy_consultancy', 'department, academic_year, project_date, amount', q => deptFilter ? q.eq('department', deptFilter) : q),
      // 6. PhD Holders
      all('master_faculty', 'dept', q => {
        q = q.eq('type', 'Doctorate')
        if (deptFilter) q = q.eq('dept', deptFilter)
        return q
      }),
      // Supervisors and Scholars
      all('legacy_research_supervisors', 'department, academic_year', q => deptFilter ? q.eq('department', deptFilter) : q),
      all('legacy_research_scholars', 'research_centre, academic_year', q => deptFilter ? q.eq('research_centre', deptFilter) : q),
      // 7. Manual Stats (static)
      admin.from('report_manual_stats').select('*').eq('id', 1).maybeSingle(),
    ])

    const facultyMap: Record<string, string> = {}
    for (const f of facultyData) facultyMap[f.user_id] = f.dept || ''

    const getYearFromDate = (dateStr: string | null) => {
      if (!dateStr) return null
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return null
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      return m >= 6 ? y : y - 1
    }

    const seedFunds = (rawSeedFunds || []).map(item => ({
      department: facultyMap[item.applicant_id] || '',
      year: getYearFromDate(item.created_at),
      amount_requested: item.amount_requested
    })).filter(item => {
      if (yearFilter && item.year !== parseInt(yearFilter)) return false
      if (deptFilter && item.department !== deptFilter) return false
      return true
    })

    const consultancies = (rawConsultancies || []).map(item => ({
      department: facultyMap[item.applicant_id] || '',
      year: getYearFromDate(item.created_at),
      sanctioned_amount: item.consultancy_fee
    })).filter(item => {
      if (yearFilter && item.year !== parseInt(yearFilter)) return false
      if (deptFilter && item.department !== deptFilter) return false
      return true
    })

    const projectGrants = (rawProjectGrants || []).map(item => ({
      department: facultyMap[item.applicant_id] || '',
      year: getYearFromDate(item.created_at),
      total_proposed_budget: item.total_proposed_budget
    })).filter(item => {
      if (yearFilter && item.year !== parseInt(yearFilter)) return false
      if (deptFilter && item.department !== deptFilter) return false
      return true
    })

    let legacyPatents = legacyPatentsData
    if (deptFilter) legacyPatents = legacyPatents.filter(p => p.department === deptFilter)
    if (yearFilter) legacyPatents = legacyPatents.filter(p => {
      const pYear = p.academic_year ? parseInt(p.academic_year.split('-')[0]) : null
      return pYear === parseInt(yearFilter) || p.academic_year?.includes(yearFilter)
    })

    // Aggregate Data
    const STANDARD_DEPTS = ['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CYS', 'AI-DS', 'AI-ML', 'CSBS', 'S&H']
    
    const normalizeDept = (d: string | null | undefined) => {
       if (!d) return 'Others'
       const upper = d.toUpperCase().trim()
       if (upper.includes('S&H') || upper.includes('S & H') || upper.includes('MATHS') || upper.includes('PHYSICS') || upper.includes('CHEMISTRY') || upper.includes('ENGLISH') || upper.includes('SCIENCE')) return 'S&H'
       if (upper === 'MECH' || upper === 'MECHANICAL') return 'MECH'
       if (upper === 'CSE' || upper === 'CS') return 'CSE'
       if (upper === 'ECE') return 'ECE'
       if (upper === 'EEE') return 'EEE'
       if (upper === 'IT') return 'IT'
       if (upper === 'CYS' || upper.includes('CYBER')) return 'CYS'
       if (upper === 'AIDS' || upper === 'AI&DS' || upper === 'AI-DS') return 'AI-DS'
       if (upper === 'AIML' || upper === 'AI&ML' || upper === 'AI-ML') return 'AI-ML'
       if (upper === 'CSBS') return 'CSBS'
       if (upper === 'CCE') return 'CCE'
       if (STANDARD_DEPTS.includes(upper)) return upper
       return 'Others'
    }

    const initDeptRecord = () => {
      const rec: Record<string, number> = {}
      STANDARD_DEPTS.forEach(d => rec[d] = 0)
      rec['CCE'] = 0
      rec['Others'] = 0
      return rec
    }

    const scopusByDept = initDeptRecord()
    const scopusByYear: Record<string, number> = {}
    const sciPublicationsByDept = initDeptRecord()

    submissions?.forEach(s => {
      if (s.department) {
        const d = normalizeDept(s.department)
        scopusByDept[d] = (scopusByDept[d] || 0) + 1
      }
      if (s.year) scopusByYear[s.year] = (scopusByYear[s.year] || 0) + 1
    })
    
    legacyPubs?.forEach((p: any) => {
      const d = normalizeDept(p.department)
      scopusByDept[d] = (scopusByDept[d] || 0) + 1
      
      if (p.document_type_report === 'SCI') {
        sciPublicationsByDept[d] = (sciPublicationsByDept[d] || 0) + 1
      }
      if (p.year) scopusByYear[p.year] = (scopusByYear[p.year] || 0) + 1
    })

    const patentsByDept = initDeptRecord()
    const patentsByYear: Record<string, number> = {}
    const incAmountByDept = initDeptRecord()
    const incAmountByYear: Record<string, number> = {}

    incentives?.forEach(i => {
      if (i.category === 'patent') {
        if (i.department) {
          const d = normalizeDept(i.department)
          patentsByDept[d] = (patentsByDept[d] || 0) + 1
        }
        if (i.year) patentsByYear[i.year] = (patentsByYear[i.year] || 0) + 1
      }
      const amt = Number(i.calculated_amount) || 0
      if (i.department) {
        const d = normalizeDept(i.department)
        incAmountByDept[d] = (incAmountByDept[d] || 0) + amt
      }
      if (i.year) incAmountByYear[i.year] = (incAmountByYear[i.year] || 0) + amt
    })

    legacyIncentives?.forEach(i => {
      const amt = Number(i.received_amount) || 0
      
      let iYear = null
      if (i.amount_credited_date) iYear = getYearFromDate(i.amount_credited_date)
      if (!iYear && i.submitted_date) iYear = getYearFromDate(i.submitted_date)
      if (!iYear && i.date_of_publication) iYear = getYearFromDate(i.date_of_publication)
      if (!iYear && i.incentive_year) iYear = parseInt(i.incentive_year.split('-')[0])

      if (yearFilter && iYear !== parseInt(yearFilter) && !i.incentive_year?.includes(yearFilter)) return
      
      if (i.department) {
        const d = normalizeDept(i.department)
        incAmountByDept[d] = (incAmountByDept[d] || 0) + amt
      }
      if (iYear) incAmountByYear[iYear] = (incAmountByYear[iYear] || 0) + amt
    })

    legacyPatents?.forEach(p => {
      if (p.department) {
        const d = normalizeDept(p.department)
        patentsByDept[d] = (patentsByDept[d] || 0) + 1
      }
      const year = p.academic_year ? parseInt(p.academic_year.split('-')[0]) : null
      if (year) patentsByYear[year] = (patentsByYear[year] || 0) + 1
    })

    const seedAmountByDept = initDeptRecord()
    const seedAmountByYear: Record<string, number> = {}
    seedFunds?.forEach(s => {
      const amt = Number(s.amount_requested) || 0
      if (s.department) {
        const d = normalizeDept(s.department)
        seedAmountByDept[d] = (seedAmountByDept[d] || 0) + amt
      }
      if (s.year) seedAmountByYear[s.year] = (seedAmountByYear[s.year] || 0) + amt
    })

    legacySeedFunds?.forEach(s => {
      const amt = Number(s.amount_sanctioned) || 0
      const sYear = s.academic_year ? parseInt(s.academic_year.split('-')[0]) : null
      if (yearFilter && sYear !== parseInt(yearFilter) && !s.academic_year?.includes(yearFilter)) return
      if (s.dept) {
        const d = normalizeDept(s.dept)
        seedAmountByDept[d] = (seedAmountByDept[d] || 0) + amt
      }
      if (sYear) seedAmountByYear[sYear] = (seedAmountByYear[sYear] || 0) + amt
    })

    const consAmountByDept = initDeptRecord()
    const consAmountByYear: Record<string, number> = {}
    consultancies?.forEach(c => {
      const amt = Number(c.sanctioned_amount) || 0
      if (c.department) {
        const d = normalizeDept(c.department)
        consAmountByDept[d] = (consAmountByDept[d] || 0) + amt
      }
      if (c.year) consAmountByYear[c.year] = (consAmountByYear[c.year] || 0) + amt
    })

    legacyConsultancy?.forEach(c => {
      const amt = Number(c.amount) || 0
      let cYear: number | null = null
      if (c.project_date && c.project_date !== 'null') cYear = getYearFromDate(c.project_date)
      // Fallback: derive year from academic_year string (e.g. '2026-2027' → 2026)
      if (!cYear && c.academic_year) cYear = parseInt(c.academic_year.split('-')[0])

      if (yearFilter) {
        const yf = parseInt(yearFilter)
        // Match if the derived year equals the filter year, OR the academic_year
        // string starts with '<yearFilter>-' (e.g. '2026-2027' matches yearFilter='2026').
        // Using startsWith instead of includes avoids '2025-2026' falsely matching '2026'.
        const yearMatches =
          cYear === yf ||
          c.academic_year?.startsWith(yearFilter + '-')
        if (!yearMatches) return
      }

      if (c.department) {
        const d = normalizeDept(c.department)
        consAmountByDept[d] = (consAmountByDept[d] || 0) + amt
      }
      if (cYear) consAmountByYear[cYear] = (consAmountByYear[cYear] || 0) + amt
    })

    const grantAmountByDept = initDeptRecord()
    const grantAmountByYear: Record<string, number> = {}
    projectGrants?.forEach(g => {
      const amt = Number(g.total_proposed_budget) || 0
      if (g.department) {
        const d = normalizeDept(g.department)
        grantAmountByDept[d] = (grantAmountByDept[d] || 0) + amt
      }
      if (g.year) grantAmountByYear[g.year] = (grantAmountByYear[g.year] || 0) + amt
    })

    legacyResearchGrants?.forEach(g => {
      const amt = Number(g.grant_amount) || 0
      const gYear = g.academic_year ? parseInt(g.academic_year.split('-')[0]) : null
      if (yearFilter && gYear !== parseInt(yearFilter) && !g.academic_year?.includes(yearFilter)) return
      if (g.department) {
        const d = normalizeDept(g.department)
        grantAmountByDept[d] = (grantAmountByDept[d] || 0) + amt
      }
      if (gYear) grantAmountByYear[gYear] = (grantAmountByYear[gYear] || 0) + amt
    })

    const phdByDept = initDeptRecord()
    phds?.forEach(p => {
      if (p.dept) {
        const d = normalizeDept(p.dept)
        phdByDept[d] = (phdByDept[d] || 0) + 1
      }
    })

    const supervisorsByDept = initDeptRecord()
    const supervisorsByYear: Record<string, number> = {}
    let supervisorsCount = 0
    supervisors?.forEach(s => {
      const year = s.academic_year ? parseInt(s.academic_year.split('-')[0]) : null
      if (yearFilter && year !== parseInt(yearFilter) && !s.academic_year?.includes(yearFilter)) return
      supervisorsCount++
      if (s.department) {
        const d = normalizeDept(s.department)
        supervisorsByDept[d] = (supervisorsByDept[d] || 0) + 1
      }
      if (year) supervisorsByYear[year] = (supervisorsByYear[year] || 0) + 1
    })

    const scholarsByDept = initDeptRecord()
    const scholarsByYear: Record<string, number> = {}
    let scholarsCount = 0
    scholars?.forEach(s => {
      const year = s.academic_year ? parseInt(s.academic_year.split('-')[0]) : null
      if (yearFilter && year !== parseInt(yearFilter) && !s.academic_year?.includes(yearFilter)) return
      scholarsCount++
      if (s.research_centre) {
        const d = normalizeDept(s.research_centre)
        scholarsByDept[d] = (scholarsByDept[d] || 0) + 1
      }
      if (year) scholarsByYear[year] = (scholarsByYear[year] || 0) + 1
    })

    // Convert to arrays for recharts
    const formatData = (obj: Record<string, number>, keyName = 'name', valName = 'value') => 
      Object.keys(obj).sort().map(k => ({ [keyName]: k, [valName]: obj[k] }))

    return NextResponse.json({
      success: true,
      data: {
        scopus: {
          byDept: formatData(scopusByDept),
          byYear: formatData(scopusByYear)
        },
        sciPublications: {
          byDept: formatData(sciPublicationsByDept)
        },
        patents: {
          byDept: formatData(patentsByDept),
          byYear: formatData(patentsByYear)
        },
        incentives: {
          byDept: formatData(incAmountByDept),
          byYear: formatData(incAmountByYear)
        },
        seedFunds: {
          byDept: formatData(seedAmountByDept),
          byYear: formatData(seedAmountByYear)
        },
        consultancies: {
          byDept: formatData(consAmountByDept),
          byYear: formatData(consAmountByYear)
        },
        projectGrants: {
          byDept: formatData(grantAmountByDept),
          byYear: formatData(grantAmountByYear)
        },
        phds: {
          byDept: formatData(phdByDept)
        },
        supervisors: {
          byDept: formatData(supervisorsByDept),
          byYear: formatData(supervisorsByYear)
        },
        scholars: {
          byDept: formatData(scholarsByDept),
          byYear: formatData(scholarsByYear)
        },
        manualStats: {
          ...manualStats,
          au_research_supervisors_count: supervisorsCount,
          au_research_scholars_count: scholarsCount,
          research_funds_total: manualStats?.research_funds_total ?? 5400000
        }
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
