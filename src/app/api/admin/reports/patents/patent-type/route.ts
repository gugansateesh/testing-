import { NextResponse } from 'next/server'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const VALID_TYPES = ['Utility', 'Design', 'Copyright']

export async function PATCH(request: Request) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const admin = createAdminClient()
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id, patent_type } = await request.json()
    if (!id || !patent_type || !VALID_TYPES.includes(patent_type)) {
      return NextResponse.json({ error: 'Invalid payload. patent_type must be Utility, Design, or Copyright.' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('legacy_patents')
      .update({ patent_type })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
