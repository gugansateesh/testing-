import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const params = await props.params;
  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { remark: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.remark || body.remark.trim() === '') {
    return NextResponse.json({ error: 'Remark is required to reject an application' }, { status: 400 })
  }

  const { error } = await admin
    .from('incentive_applications')
    .update({
      status: 'rejected',
      rejection_remark: body.remark.trim(),
      reviewed_at: new Date().toISOString()
    })
    .eq('id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
