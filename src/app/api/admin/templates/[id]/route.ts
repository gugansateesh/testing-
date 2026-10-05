import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, requireAdmin } from '@/lib/verifyAuth'
import { deleteCloudinaryFile } from '@/lib/cloudinaryDelete'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = extractToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = await requireAdmin(auth)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { id } = await params
  
  const { searchParams } = new URL(req.url)
  const confirmOnlyVersion = searchParams.get('confirm_only_version') === 'true'

  // Fetch the template to be deleted
  const { data: template, error: fetchError } = await admin
    .from('document_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Server-side safeguard check
  if (template.is_current) {
    const { count, error: countError } = await admin
      .from('document_templates')
      .select('*', { count: 'exact', head: true })
      .eq('module', template.module)
      .eq('doc_key', template.doc_key)

    if (countError) {
      return NextResponse.json({ error: 'Failed to verify versions' }, { status: 500 })
    }

    if (count && count > 1) {
      return NextResponse.json({ 
        error: 'Cannot delete active version while other versions exist. Make another version current first.' 
      }, { status: 409 })
    }

    if (count === 1 && !confirmOnlyVersion) {
      return NextResponse.json({
        error: 'This is the only version. Pass confirm_only_version=true to delete it.'
      }, { status: 409 })
    }
  }

  // Delete from Cloudinary
  const deletedFromCloudinary = await deleteCloudinaryFile(template.file_url)
  if (!deletedFromCloudinary) {
    return NextResponse.json({ error: 'Failed to delete file from storage' }, { status: 500 })
  }

  // Delete from DB
  const { error: deleteError } = await admin
    .from('document_templates')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = extractToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = await requireAdmin(auth)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { id } = await params

  // Fetch target template
  const { data: template, error: fetchError } = await admin
    .from('document_templates')
    .select('doc_key, module')
    .eq('id', id)
    .single()

  if (fetchError || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Set all versions of this doc_key to not current
  await admin
    .from('document_templates')
    .update({ is_current: false })
    .eq('module', template.module)
    .eq('doc_key', template.doc_key)

  // Set target version to current
  const { data: updated, error: updateError } = await admin
    .from('document_templates')
    .update({ is_current: true })
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ data: updated })
}
