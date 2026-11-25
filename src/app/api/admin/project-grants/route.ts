import { NextResponse } from 'next/server'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || 'pending'
  const dept = searchParams.get('dept')
  const faculty = searchParams.get('faculty')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = 20
  const offset = (page - 1) * limit

  try {
    const admin = createAdminClient()

    let query = admin.from('project_grant_applications').select('*', { count: 'exact' })
    if (status && status !== 'all') query = query.eq('status', status)

    const { data: apps, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    if (!apps || apps.length === 0) {
      return NextResponse.json({ data: [], meta: { total: 0, page, limit, totalPages: 0 }, departments: [] })
    }

    const userIds = [...new Set(apps.map(a => a.applicant_id))]
    const { data: facultyData } = await admin
      .from('master_faculty')
      .select('user_id, name, dept')
      .in('user_id', userIds)

    const facultyMap = (facultyData || []).reduce((acc: any, f: any) => {
      acc[f.user_id] = f
      return acc
    }, {})

    let enrichedData = apps.map(app => ({
      ...app,
      faculty_name: facultyMap[app.applicant_id]?.name || 'Unknown',
      department: facultyMap[app.applicant_id]?.dept || 'Unknown'
    }))

    if (dept && dept !== 'all') {
      enrichedData = enrichedData.filter(app => app.department === dept)
    }
    if (faculty && faculty.length > 2) {
      const search = faculty.toLowerCase()
      enrichedData = enrichedData.filter(app => app.faculty_name.toLowerCase().includes(search))
    }

    const { data: allFac } = await admin.from('master_faculty').select('dept')
    const allDepts = [...new Set((allFac || []).map(f => f.dept).filter(Boolean))]

    return NextResponse.json({
      data: enrichedData,
      departments: allDepts,
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages: count ? Math.ceil(count / limit) : 0
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
