/**
 * ttlCache.ts
 *
 * Tiny per-isolate memo cache for read-mostly, non-sensitive data.
 * Concurrent callers for the same key share one in-flight request, and
 * failures are never cached.
 *
 * The cache lives in server memory only, so each worker isolate keeps its own
 * copy. Use it only where serving data up to `ttlMs` old is acceptable.
 */

type Entry<T> = { value?: T; expires: number; pending?: Promise<T> }

const store = new Map<string, Entry<unknown>>()

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key) as Entry<T> | undefined
  if (hit?.pending) return hit.pending
  if (hit && hit.expires > now) return hit.value as T

  const pending = load().then(
    value => {
      store.set(key, { value, expires: Date.now() + ttlMs })
      return value
    },
    err => {
      store.delete(key)
      throw err
    }
  )
  store.set(key, { ...hit, expires: hit?.expires ?? 0, pending })
  return pending
}
