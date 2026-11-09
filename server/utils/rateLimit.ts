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
  /** Above this many keys, ended windows are dropped on the next hit. */
  maxKeys?: number
}

export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: RateLimiterOptions) {
  const windows = new Map<string, { start: number, count: number }>()

  function prune(time: number): void {
    for (const [key, window] of windows) {
      if (time - window.start >= windowMs) windows.delete(key)
    }
  }

  return {
    /** Counts one request for `key`; refused requests do not count. */
    hit(key: string): RateVerdict {
      const time = now()
      let window = windows.get(key)
      if (!window || time - window.start >= windowMs) {
        if (!window && windows.size >= maxKeys) prune(time)
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

/** Limits apply per client address and project, so one busy app does not lock a visitor out of another. */
export function publicRateKey(ip: string | undefined, projectSlug: string): string {
  return `${ip ?? 'unknown'}|${projectSlug}`
}

export const PUBLIC_WRITES_PER_MINUTE = 10
export const PUBLIC_READS_PER_MINUTE = 120
