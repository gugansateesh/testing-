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
  const category = searchParams.get('category')
  const status = searchParams.get('status')   // 'active' | 'archived'
  const search = searchParams.get('search')   // title search
  const year = searchParams.get('year')        // created_at year
  const month = searchParams.get('month')      // created_at month (1-12)

  try {
    let query = admin
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })

    if (category) query = query.eq('category', category)
    if (status === 'active') query = query.eq('is_active', true)
    if (status === 'archived') query = query.eq('is_active', false)
    if (search) query = query.ilike('title', `%${search}%`)
    if (year) {
      query = query.gte('created_at', `${year}-01-01T00:00:00`)
               .lt('created_at', `${parseInt(year) + 1}-01-01T00:00:00`)
    }
    if (month && year) {
      const m = parseInt(month)
      const y = parseInt(year)
      const start = `${y}-${String(m).padStart(2, '0')}-01T00:00:00`
      const nextM = m === 12 ? 1 : m + 1
      const nextY = m === 12 ? y + 1 : y
      const end = `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00`
      query = query.gte('created_at', start).lt('created_at', end)
    } else if (month && !year) {
      // JS post-filter for month-only
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()

    // Validate funding_agency conditionally
    if (body.category === 'funding_opportunities' && (!body.funding_agency || body.funding_agency.trim() === '')) {
      return NextResponse.json({ error: 'Funding Agency is required for Funding Opportunities' }, { status: 400 })
    }

    const insertPayload: any = {
      category: body.category,
      title: body.title,
      body: body.body,
      is_active: true,
      created_by: auth.userId,
    }

    if (body.event_date) insertPayload.event_date = body.event_date
    if (body.start_date) insertPayload.start_date = body.start_date
    if (body.registration_end_date) insertPayload.registration_end_date = body.registration_end_date
    if (body.registration_link) insertPayload.registration_link = body.registration_link
    if (body.poster_url) insertPayload.poster_url = body.poster_url
    if (body.category === 'funding_opportunities' && body.funding_agency) {
      insertPayload.funding_agency = body.funding_agency
    }

    const { data, error } = await admin
      .from('announcements')
      .insert(insertPayload)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
