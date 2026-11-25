import { NextResponse } from 'next/server'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const params = await props.params;
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('project_grant_applications')
      .update({
        status: 'approved',
        rejection_remark: null,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', params.id)
      .select('id')
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, id: data.id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
