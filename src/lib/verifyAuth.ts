/**
 * verifyAuth.ts
 * Shared admin-route authentication helper.
 *
 * Strategy:
 *   If SUPABASE_JWT_SECRET is set in .env.local → LOCAL verification via `jose`
 *   (zero network calls, ~0 ms overhead).
 *
 *   If it is NOT set → falls back to admin.auth.getUser() which makes a
 *   network round-trip to Supabase Auth (~200–600 ms) and is clearly flagged
 *   below. Set the secret to eliminate this latency.
 *
 * How to get your JWT secret:
 *   Supabase Dashboard → Project Settings → API → JWT Secret
 *   Add to .env.local:  SUPABASE_JWT_SECRET=<your-secret>
 */

import { jwtVerify } from 'jose'
import { createAdminClient } from '@/lib/supabase'

export interface AuthResult {
  id: string      // Supabase user UUID
  userId: string  // alias kept for back-compat
  email: string
  role: string
}

export async function verifyToken(token: string): Promise<AuthResult | null> {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET

  if (jwtSecret) {
    // ── Fast path: local JWT verification — no network call ──────────────────
    try {
      const secret = new TextEncoder().encode(jwtSecret)
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
      })

      const userId = payload.sub as string
      const role = payload.role as string | undefined
      const email = (payload.email as string) ?? ''

      if (userId && role === 'authenticated') {
        return { id: userId, userId, email, role }
      }
    } catch (jwtErr: any) {
      console.warn('Local JWT verify note (falling back to remote):', jwtErr?.message || jwtErr)
    }
  }

  // ── Remote fallback: getUser() call ────────────────────────────────────────
  try {
    const admin = createAdminClient()
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) {
      console.warn('Remote getUser verification failed:', error?.message)
      return null
    }
    return { id: user.id, userId: user.id, email: user.email ?? '', role: 'authenticated' }
  } catch (err: any) {
    console.error('Auth verification fatal error:', err)
    return null
  }
}

/**
 * Extract Bearer token from Authorization header.
 * Also accepts ?token= query param (needed for the Excel export download
 * which triggers via <a href> and can't set a custom header).
 */
export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1]
  }
  // Query-param fallback for download links
  const url = new URL(request.url)
  return url.searchParams.get('token')
}

/**
 * Checks if the given auth result corresponds to an admin user based on the ADMIN_EMAILS env variable.
 */
export async function requireAdmin(authResult: AuthResult): Promise<boolean> {
  const allowed = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(authResult.email.toLowerCase())
}
