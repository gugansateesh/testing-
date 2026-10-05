import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, requireAdmin } from '@/lib/verifyAuth'
import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export async function GET(req: NextRequest) {
  const token = extractToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = await requireAdmin(auth)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const moduleName = searchParams.get('module')

  let query = admin.from('document_templates').select('*')
  if (moduleName) {
    query = query.eq('module', moduleName)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const token = extractToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = await requireAdmin(auth)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const moduleName = formData.get('module') as string
    const doc_key = formData.get('doc_key') as string
    const doc_label = formData.get('doc_label') as string
    const version_label = formData.get('version_label') as string

    if (!file || !moduleName || !doc_key || !doc_label || !version_label) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Upload to Cloudinary
    const buffer = await file.arrayBuffer()
    const base64String = Buffer.from(buffer).toString('base64')
    const fileType = file.type || 'application/octet-stream'
    const dataURI = `data:${fileType};base64,${base64String}`

    const uploadResponse = await new Promise<string>((resolve, reject) => {
      cloudinary.uploader.upload(
        dataURI,
        {
          resource_type: 'raw',
          folder: 'carf/templates',
        },
        (error, result) => {
          if (error || !result) reject(error)
          else resolve(result.secure_url)
        }
      )
    })

    // Set old versions to not current
    await admin
      .from('document_templates')
      .update({ is_current: false })
      .eq('module', moduleName)
      .eq('doc_key', doc_key)

    // Insert new version
    const { data: newTemplate, error } = await admin
      .from('document_templates')
      .insert({
        module: moduleName,
        doc_key,
        doc_label,
        version_label,
        file_url: uploadResponse,
        is_current: true,
        uploaded_by: auth.id,
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ data: newTemplate })
  } catch (error: any) {
    console.error('Template upload error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
