import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  
  let query = admin
    .from('seed_fund_applications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ data: [] })
  }

  // Fetch all faculty to map user_id -> master_faculty
  const { data: facultyData } = await admin
    .from('master_faculty')
    .select('user_id, emp_id, name, dept')
    .not('user_id', 'is', null)

  const facultyMap = new Map()
  if (facultyData) {
    facultyData.forEach(f => {
      facultyMap.set(f.user_id, f)
    })
  }

  // Merge faculty data
  const result = data.map((item: any) => {
    const faculty = facultyMap.get(item.applicant_id) || {}
    return {
      ...item,
      faculty_name: faculty.name || 'Unknown',
      department: faculty.dept || '-',
      emp_id: faculty.emp_id || '-'
    }
  })

  return NextResponse.json({ data: result })
}
