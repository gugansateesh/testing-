import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, requireAdmin } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // This route returns raw table data via the service-role client, so it must
  // be restricted to admins.
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await requireAdmin(auth))) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('legacy_consultancy').select('*')
    return NextResponse.json({ success: true, count: data?.length || 0, data, error })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message })
  }
}
