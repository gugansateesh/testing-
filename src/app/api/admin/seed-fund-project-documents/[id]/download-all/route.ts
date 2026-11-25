import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { PROJECT_DOCUMENT_CHECKLIST } from '@/lib/seedFundProjectDocs'
import { mergeDocumentsToPdf } from '@/lib/mergeDocumentsToPdf'

export const dynamic = 'force-dynamic'
// LibreOffice conversion can take time for many documents — give it room
export const maxDuration = 120

/**
 * Resolve a stored URL to something the server can fetch without auth.
 *
 * Old uploads go to Supabase Storage — the stored URL may be a public bucket
 * URL or a "sign" URL that already has auth, but the raw path URL returns 401
 * when fetched server-side without a token. We handle two cases:
 *
 * 1. URL contains "/storage/v1/object/public/" → already a public URL, use as-is.
 * 2. URL contains "/storage/v1/object/sign/"   → signed URL, use as-is (has token in query).
 * 3. URL contains "/storage/v1/object/"         → private bucket path → create a signed URL.
 * 4. Cloudinary URL (res.cloudinary.com)        → public, use as-is.
 * 5. Anything else                              → pass through, hope for the best.
 */
async function resolveUrl(raw: string): Promise<string> {
  // Cloudinary — always public
  if (raw.includes('res.cloudinary.com') || raw.includes('cloudinary.com')) {
    return raw
  }

  // Already a public Supabase URL — use as-is
  if (raw.includes('/storage/v1/object/public/')) {
    return raw
  }

  // Supabase Storage — extract bucket + path and generate a fresh signed URL
  const supabaseStoragePattern = /\/storage\/v1\/object\/(?:sign\/)?([^?]+)/
  const match = raw.match(supabaseStoragePattern)
  if (match) {
    // match[1] is "bucket-name/path/to/file"
    const [bucketName, ...pathParts] = match[1].split('/')
    const objectPath = pathParts.join('/')

    const admin = createAdminClient()
    const { data, error } = await admin.storage
      .from(bucketName)
      .createSignedUrl(objectPath, 60 * 10) // 10 minute signed URL

    if (!error && data?.signedUrl) {
      console.log(`[download-all] Resolved Supabase Storage URL for ${objectPath}`)
      return data.signedUrl
    }

    // Fallback: try the public URL (works if bucket is public)
    const { data: pubData } = admin.storage.from(bucketName).getPublicUrl(objectPath)
    console.log(`[download-all] Signed URL failed, using public URL for ${objectPath}`)
    return pubData.publicUrl
  }

  return raw
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(req)
  if (denied) return denied

  const params = await props.params;
  // ── Auth (local JWT, no network round-trip) ─────────────────────────────
  const token = extractToken(req)
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const auth = await verifyToken(token)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = params
  const admin = createAdminClient()

  try {
    // ── Fetch the project documents row ────────────────────────────────────
    const { data: docRow, error: docError } = await admin
      .from('seed_fund_project_documents')
      .select('*, application:seed_fund_applications(title, applicant_id)')
      .eq('id', id)
      .single()

    if (docError || !docRow) {
      return NextResponse.json({ error: 'Project documents not found' }, { status: 404 })
    }

    // ── Fetch faculty name for filename ────────────────────────────────────
    const applicantId = docRow.application?.applicant_id || docRow.applicant_id
    const { data: faculty } = await admin
      .from('master_faculty')
      .select('name')
      .eq('user_id', applicantId)
      .maybeSingle()

    const facultyName = faculty?.name || 'Faculty'
    const projectTitle = docRow.application?.title || 'Project'

    // Build filename slug
    const slug = projectTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
    const nameSlug = facultyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
    const filename = `Project-Documents-${nameSlug}-${slug}.pdf`

    // ── Build document list — resolve Supabase Storage URLs first ──────────
    const documents = await Promise.all(
      PROJECT_DOCUMENT_CHECKLIST.map(async (item, i) => {
        const rawUrl = docRow[item.key] as string | null | undefined
        const resolvedUrl = rawUrl ? await resolveUrl(rawUrl) : null
        return {
          label: item.label,
          url: resolvedUrl,
          index: i + 1,
        }
      })
    )

    console.log(`[download-all] Merging ${documents.length} documents for row ${id}`)

    // ── Merge ──────────────────────────────────────────────────────────────
    const pdfBuffer = await mergeDocumentsToPdf(documents, projectTitle)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[download-all] Fatal error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to generate combined PDF' },
      { status: 500 }
    )
  }
}
