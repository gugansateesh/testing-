import { NextResponse } from 'next/server'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'

export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || 'pending'
  const admin = createAdminClient()

  // Requests and the faculty name/dept lookup are independent — fetch concurrently
  const [{ data, error }, facultyRows] = await Promise.all([
    admin
      .from('profile_edit_requests')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false }),
    fetchAllRows(admin, 'master_faculty', 'emp_id, name, dept').catch(() => [] as any[]),
  ])

  if (error) {
    console.error('[profile-edit-requests GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const facultyMap: Record<string, { name: string; dept: string }> = {}
  for (const f of facultyRows) {
    facultyMap[f.emp_id] = { name: f.name, dept: f.dept }
  }

  const formatted = (data || []).map((d: any) => ({
    ...d,
    faculty_name: facultyMap[d.emp_id]?.name ?? d.previous_name ?? '—',
    department: facultyMap[d.emp_id]?.dept ?? d.previous_dept ?? '—',
  }))

  return NextResponse.json({ data: formatted })
}
