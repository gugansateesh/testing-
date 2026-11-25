import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const params = await props.params;
  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()

    // Validate funding_agency conditionally if category is being updated/checked
    // Note: If only updating is_active, we shouldn't block, but if full edit, we check.
    if (body.category === 'funding_opportunities' && ('funding_agency' in body || 'title' in body)) {
      if (!body.funding_agency || body.funding_agency.trim() === '') {
        return NextResponse.json({ error: 'Funding Agency is required for Funding Opportunities' }, { status: 400 })
      }
    }

    const updatePayload: any = {
      category: body.category,
      title: body.title,
      body: body.body,
      is_active: body.is_active
    }
    
    // Only include extended fields if they exist in the body AND aren't null 
    // (to prevent crashes on remote DBs missing the schema update). 
    // NOTE: To allow clearing fields (setting to null), the DB must have the columns.
    if (body.event_date !== undefined) updatePayload.event_date = body.event_date || null
    if (body.start_date !== undefined && body.start_date !== null) updatePayload.start_date = body.start_date
    if (body.registration_end_date !== undefined && body.registration_end_date !== null) updatePayload.registration_end_date = body.registration_end_date
    if (body.registration_link !== undefined && body.registration_link !== null) updatePayload.registration_link = body.registration_link
    if (body.poster_url !== undefined && body.poster_url !== null) updatePayload.poster_url = body.poster_url
    if (body.category === 'funding_opportunities' && body.funding_agency) {
      updatePayload.funding_agency = body.funding_agency
    }

    const { data, error } = await admin
      .from('announcements')
      .update(updatePayload)
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const params = await props.params;
  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { error } = await admin
      .from('announcements')
      .delete()
      .eq('id', params.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
