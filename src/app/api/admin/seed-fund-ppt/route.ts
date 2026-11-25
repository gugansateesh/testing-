import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'

export async function GET(req: Request) {
  const denied = await adminGuard(req)
  if (denied) return denied

  const supabaseAdmin = createAdminClient()
  try {
    const token = extractToken(req)
    if (!token) throw new Error('Unauthorized')
    const authResult = await verifyToken(token)
    if (!authResult) throw new Error('Unauthorized')
    const user = { id: authResult.userId }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending'

    // Need to join seed_fund_ppt_submissions with seed_fund_applications and master_faculty
    // Actually, we can fetch them separately or use supabase joins if configured.
    // Let's use separate queries or joins.
    const { data: ppts, error } = await supabaseAdmin
      .from('seed_fund_ppt_submissions')
      .select(`
        *,
        application:seed_fund_applications(
          title,
          amount_requested
        )
      `)
      .eq('status', status)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Fetch faculty details
    const applicantIds = [...new Set(ppts.map((r: any) => r.applicant_id))]
    let facultyMap = new Map()
    if (applicantIds.length > 0) {
      const { data: facultyRows } = await supabaseAdmin
        .from('master_faculty')
        .select('name, dept, emp_id, user_id')
        .in('user_id', applicantIds)
      if (facultyRows) {
        facultyMap = new Map(facultyRows.map((f: any) => [f.user_id, f]))
      }
    }
    const dataWithFaculty = ppts.map((r: any) => ({
      ...r,
      faculty: facultyMap.get(r.applicant_id) ?? null
    }))

    return NextResponse.json(dataWithFaculty)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}
