import { NextResponse } from 'next/server'
import { verifyToken, extractToken, requireAdmin } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = await requireAdmin(auth)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = params.id
  const admin = createAdminClient()

  try {
    const { error } = await admin
      .from('legacy_patents')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE patents error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = await requireAdmin(auth)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = params.id
  const admin = createAdminClient()

  try {
    const body = await request.json()

    const allowed = [
      'title', 'inventors', 'applicants', 'assignee', 'department',
      'application_number', 'status', 'filed_date', 'published_or_granted_date',
      'publication_or_grant_number', 'academic_year', 'institute_faculty',
      'name_of_faculty', 'faculty_name', 'emp_id', 'type', 'proof_link', 'patent_type', 'jurisdiction'
    ]
    const updates: Record<string, any> = {}
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key]
    }

    const { error } = await admin.from('legacy_patents').update(updates).eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('PATCH patents error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
