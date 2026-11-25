import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getReportsOverviewStats } from '@/lib/reportStats'
import { cached } from '@/lib/ttlCache'

// Cache stats for 5 minutes — login page stats don't need to be real-time.
// Only the first request after expiry hits the DB; all others get the cached
// response. (Route-segment `revalidate` was cancelled by `force-dynamic`, so
// the cache is kept in server memory instead.)
const STATS_TTL_MS = 5 * 60 * 1000

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const stats = await cached('public-stats', STATS_TTL_MS, () => getReportsOverviewStats(createAdminClient()))
    return NextResponse.json(stats)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
