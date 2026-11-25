import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side client (anon key) — safe to use in browser components
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Server-side admin client — NEVER import this in client components.
// The client is stateless (no session persistence / refresh), so one instance
// is reused for the lifetime of the server isolate instead of being rebuilt on
// every request.
//
// Read-only RPCs (get_distinct_column_values, get_report_stats_aggregates) are
// called with `{ get: true }`: concurrent POST requests to Supabase were
// observed to be processed one after another, while GETs run in parallel.
let adminClient: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }) }
    })
  }
  return adminClient
}

/**
 * Escapes LIKE/ILIKE wildcards so user input is matched literally
 * (case-insensitive exact match, no pattern injection). PostgREST also treats
 * `*` as a wildcard, so it is escaped too.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_*]/g, ch => '\\' + ch)
}
