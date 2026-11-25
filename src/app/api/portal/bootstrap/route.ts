import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyToken, extractToken } from '@/lib/verifyAuth'

export const dynamic = 'force-dynamic'

/**
 * Everything the staff portal layout needs on first load, in one request:
 * the signed-in faculty profile and the unread announcement count.
 *
 * Replaces three serial browser round trips (master_faculty, /api/announcements,
 * announcement_reads). Queries run with the caller's own token, so the same
 * RLS rules apply as when the browser queried these tables directly.
 */
export async function GET(request: Request) {
  const token = extractToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auth = await verifyToken(token)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  )

  const [facultyRes, announcementsRes, readRes] = await Promise.all([
    supabase
      .from('master_faculty')
      .select('emp_id, name, dept, designation, type, user_id, is_registered')
      .eq('user_id', auth.id)
      .single(),
    supabase
      .from('announcements')
      .select('created_at')
      .eq('is_active', true),
    supabase
      .from('announcement_reads')
      .select('last_seen_at')
      .eq('user_id', auth.id)
      .single(),
  ])

  if (facultyRes.error || !facultyRes.data) {
    return NextResponse.json({ faculty: null, unreadCount: 0 })
  }

  let unreadCount = 0
  const anns = announcementsRes.error ? [] : announcementsRes.data || []
  if (anns.length > 0) {
    const readRow = readRes.data
    if (!readRow) unreadCount = anns.length
    else {
      const lastSeen = new Date(readRow.last_seen_at)
      unreadCount = anns.filter((a: any) => new Date(a.created_at) > lastSeen).length
    }
  }

  return NextResponse.json({ faculty: facultyRes.data, unreadCount })
}
