/**
 * In-memory fixed-window rate limits, per process (they reset on restart and
 * are not shared between instances). Used by the public data endpoint, the
 * only internet-facing route, to slow down scraping and spam per client.
 */

export type RateVerdict = { allowed: true } | { allowed: false, retryAfter: number }

export interface RateLimiterOptions {
  limit: number
  windowMs: number
  /** The clock; tests inject a fake one. */
  now?: () => number
  /**
   * The most keys held: at the cap, ended windows are dropped, then the
   * oldest windows, so a flood of distinct keys cannot grow the map.
   */
  maxKeys?: number
}

export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: RateLimiterOptions) {
  const windows = new Map<string, { start: number, count: number }>()

  // Map order is insertion order, and a key is re-inserted when its window
  // starts, so the first keys have the oldest windows.
  function makeRoom(time: number): void {
    for (const [key, window] of windows) {
      if (time - window.start >= windowMs) windows.delete(key)
    }
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break
      windows.delete(key)
    }
  }

  return {
    /** Counts one request for `key`; refused requests do not count. */
    hit(key: string): RateVerdict {
      const time = now()
      let window = windows.get(key)
      if (!window || time - window.start >= windowMs) {
        windows.delete(key)
        if (windows.size >= maxKeys) makeRoom(time)
        window = { start: time, count: 0 }
        windows.set(key, window)
      }
      if (window.count >= limit) return { allowed: false, retryAfter: Math.ceil((window.start + windowMs - time) / 1000) }
      window.count += 1
      return { allowed: true }
    },

    size(): number {
      return windows.size
    }
  }
}

export type RateLimiter = ReturnType<typeof createRateLimiter>

/** The longest project slug (see `SlugSchema`); longer ones in a key are cut. */
const SLUG_MAX = 64

/**
 * Limits apply per client address and project, so one busy app does not
 * lock a visitor out of another. Requests for projects that are not
 * published (`undefined`) share one `ip|*` budget, so made-up slugs cannot
 * mint fresh budgets or keys.
 */
export function publicRateKey(ip: string | undefined, projectSlug: string | undefined): string {
  return `${ip ?? 'unknown'}|${projectSlug === undefined ? '*' : projectSlug.slice(0, SLUG_MAX)}`
}

export const PUBLIC_WRITES_PER_MINUTE = 10
export const PUBLIC_READS_PER_MINUTE = 120
