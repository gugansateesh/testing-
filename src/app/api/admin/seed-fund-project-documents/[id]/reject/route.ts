import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(req)
  if (denied) return denied

  const params = await props.params;
  const supabaseAdmin = createAdminClient()
  try {
    const token = extractToken(req)
    if (!token) throw new Error('Unauthorized')
    const authResult = await verifyToken(token)
    if (!authResult) throw new Error('Unauthorized')

    const { remark } = await req.json()
    if (!remark) {
      return NextResponse.json({ error: 'Rejection remark is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('seed_fund_project_documents')
      .update({
        status: 'rejected',
        rejection_remark: remark,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}
