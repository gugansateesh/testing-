import { NextResponse } from 'next/server'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const params = await props.params;
  try {
    const token = extractToken(request)
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    
    const auth = await verifyToken(token)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { remark } = await request.json()
    if (!remark) return NextResponse.json({ error: 'Remark is required' }, { status: 400 })

    const admin = createAdminClient()

    const { error } = await admin
      .from('profile_edit_requests')
      .update({ 
        status: 'rejected',
        rejection_remark: remark,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', params.id)
      .eq('status', 'pending')

    if (error) {
      console.error('Failed to reject request:', error)
      return NextResponse.json({ error: 'Failed to update request' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Reject error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
