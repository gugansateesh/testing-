import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken } from '@/lib/verifyAuth'
import staffDirectoryRaw from '@/data/staff_directory.json'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

interface StaffContact {
  email: string | null
  phone: string | null
}

export async function GET(request: Request) {
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(request.url)
    const dept = url.searchParams.get('dept')
    const year = url.searchParams.get('year') || '2026'
    const phdOnly = url.searchParams.get('phdOnly') === 'true'

    const admin = createAdminClient()
    
    let query = admin
      .from('legacy_phd_holders')
      .select('*')
      .eq('academic_year', year)
      .order('s_no', { ascending: true })

    if (dept && dept !== 'all') {
      query = query.ilike('dept', dept.trim())
    }

    if (phdOnly) {
      query = query.eq('is_phd', true)
    }

    const { data, error } = await query

    if (error) throw error

    // Fetch master_faculty to get email and phone
    const { data: facultyData } = await admin
      .from('master_faculty')
      .select('emp_id, name, email, phone')

    const contactByEmpId = new Map<string, StaffContact>()
    const contactByName = new Map<string, StaffContact>()

    // 1. Preload from staff directory json
    if (Array.isArray(staffDirectoryRaw)) {
      for (const s of staffDirectoryRaw as any[]) {
        if (s.emp_id) {
          contactByEmpId.set(s.emp_id.trim().toUpperCase(), {
            email: s.email || null,
            phone: s.phone || null,
          })
        }
        if (s.name) {
          contactByName.set(s.name.trim().toLowerCase(), {
            email: s.email || null,
            phone: s.phone || null,
          })
        }
      }
    }

    // 2. Overlay live DB master_faculty (primary source)
    if (facultyData) {
      for (const f of facultyData) {
        if (f.emp_id) {
          const cleanId = f.emp_id.trim().toUpperCase()
          const existing = contactByEmpId.get(cleanId)
          contactByEmpId.set(cleanId, {
            email: f.email || existing?.email || null,
            phone: f.phone || existing?.phone || null,
          })
        }
        if (f.name) {
          const cleanName = f.name.trim().toLowerCase()
          const existing = contactByName.get(cleanName)
          contactByName.set(cleanName, {
            email: f.email || existing?.email || null,
            phone: f.phone || existing?.phone || null,
          })
        }
      }
    }

    // 3. Attach email and phone to each record
    const enrichedData = (data || []).map(item => {
      const empIdClean = (item.emp_id || '').trim().toUpperCase()
      const nameClean = (item.name || '').trim().toLowerCase()
      const contact = contactByEmpId.get(empIdClean) || contactByName.get(nameClean)

      return {
        ...item,
        email: contact?.email || null,
        phone: contact?.phone || null,
      }
    })

    // Fetch unique departments for filters
    const { data: deptData } = await admin.from('legacy_phd_holders').select('dept')
    const departments = Array.from(new Set(deptData?.map(d => d.dept ? String(d.dept).trim() : '').filter(Boolean))).sort()

    // Fetch unique academic years for the dropdown
    const { data: yearData } = await admin.from('legacy_phd_holders').select('academic_year')
    let years = Array.from(new Set(yearData?.map(d => d.academic_year).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a)))
    
    // Ensure the current year is in the list even if empty
    if (!years.includes(year)) {
      years.push(year)
      years.sort((a, b) => String(b).localeCompare(String(a)))
    }

    return NextResponse.json({ data: enrichedData, departments, years })
  } catch (error: any) {
    console.error('Fetch error:', error)
    return NextResponse.json({ error: error.message || 'Fetch failed' }, { status: 500 })
  }
}
