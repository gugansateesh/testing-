import { NextResponse } from 'next/server'
import { v2 as cloudinary } from 'cloudinary'
import { verifyToken, extractToken } from '@/lib/verifyAuth'

// Configure Cloudinary from env vars (server-only — never sent to browser)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const MAX_BYTES = 1 * 1024 * 1024 // 1 MB

export async function POST(req: Request) {
  try {
    // ── Auth: accept both staff and admin tokens ──────────────────────────
    const token = extractToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Staff and admin tokens are both Supabase JWTs — verify locally
    // (verifyToken falls back to a remote check only if local verify fails)
    const auth = await verifyToken(token)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Parse multipart form ──────────────────────────────────────────────
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
    }

    const file = formData.get('file') as File | null
    const folder = (formData.get('folder') as string | null) || 'uploads'

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'File size exceeds 1MB limit. Please compress or reduce your file and try again.' },
        { status: 413 }
      )
    }

    // ── Convert File → Buffer ─────────────────────────────────────────────
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // ── Upload to Cloudinary ──────────────────────────────────────────────
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `carf/${folder}`,
          resource_type: 'auto', // handles PDFs, DOCX, PPTX, images
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            reject(new Error(error?.message || 'Cloudinary upload failed'))
          } else {
            resolve(result as { secure_url: string })
          }
        }
      )
      uploadStream.end(buffer)
    })

    return NextResponse.json({ url: result.secure_url })
  } catch (err: any) {
    console.error('[/api/upload] error:', err)
    return NextResponse.json(
      { error: err.message || 'Upload failed. Please try again.' },
      { status: 500 }
    )
  }
}
