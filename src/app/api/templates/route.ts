import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { extractToken, verifyToken } from '@/lib/verifyAuth'

export async function GET(req: NextRequest) {
  const token = extractToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { searchParams } = new URL(req.url)
  const moduleName = searchParams.get('module')

  if (!moduleName) {
    return NextResponse.json({ error: 'Missing module parameter' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('document_templates')
    .select('doc_key, doc_label, version_label, file_url')
    .eq('module', moduleName)
    .eq('is_current', true)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
