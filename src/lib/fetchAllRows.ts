/**
 * fetchAllRows.ts
 *
 * PostgREST caps every response at 1000 rows (Supabase `max_rows`). The old
 * pattern in this codebase fetched pages one after another, paying a full
 * network round trip per 1000 rows, and some queries skipped paging entirely
 * and were silently truncated.
 *
 * This helper asks for the first page together with an exact row count, then
 * fetches every remaining page in parallel.
 *
 * Row order: by default no ORDER BY is added, which keeps the exact row order
 * the old sequential loops returned (each page was already its own query, so
 * nothing changes there). Callers that need a guaranteed order can pass
 * `orderBy` with a unique column.
 */

import { SupabaseClient } from '@supabase/supabase-js'

const PAGE_SIZE = 1000

export async function fetchAllRows<T = any>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  applyFilters: (query: any) => any = q => q,
  orderBy?: string
): Promise<T[]> {
  const page = (from: number, withCount: boolean) => {
    let q = applyFilters(admin.from(table).select(columns, withCount ? { count: 'exact' } : undefined))
    if (orderBy) q = q.order(orderBy, { ascending: true })
    return q.range(from, from + PAGE_SIZE - 1)
  }

  const first = await page(0, true)
  if (first.error) throw first.error
  const rows: T[] = first.data ?? []
  const total: number = first.count ?? rows.length
  if (rows.length < PAGE_SIZE || total <= PAGE_SIZE) return rows

  const offsets: number[] = []
  for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) offsets.push(from)
  const pages = await Promise.all(offsets.map(from => page(from, false)))
  for (const p of pages) {
    if (p.error) throw p.error
    rows.push(...(p.data ?? []))
  }

  // Rows inserted after the count was taken: keep reading until a short page.
  let from = offsets.length ? offsets[offsets.length - 1] + PAGE_SIZE : PAGE_SIZE
  let last = pages.length ? pages[pages.length - 1].data ?? [] : rows
  while (last.length === PAGE_SIZE) {
    const p = await page(from, false)
    if (p.error) throw p.error
    last = p.data ?? []
    rows.push(...last)
    from += PAGE_SIZE
  }
  return rows
}
