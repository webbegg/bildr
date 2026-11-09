import type { H3Event } from 'h3'
import { createRateLimiter, PUBLIC_READS_PER_MINUTE, PUBLIC_WRITES_PER_MINUTE, publicRateKey } from './rateLimit'

const limiters = {
  read: createRateLimiter({ limit: PUBLIC_READS_PER_MINUTE, windowMs: 60_000 }),
  write: createRateLimiter({ limit: PUBLIC_WRITES_PER_MINUTE, windowMs: 60_000 })
}

/**
 * Throws 429 (with `retry-after`, in seconds) once this client went over the
 * public read or write budget of `projectSlug`. The client is the socket's
 * address: `X-Forwarded-For` is ignored because any client can send it, so
 * behind a reverse proxy all visitors share the proxy's budget.
 */
export function limitPublicRequest(event: H3Event, kind: keyof typeof limiters, projectSlug: string): void {
  const verdict = limiters[kind].hit(publicRateKey(getRequestIP(event, { xForwardedFor: false }), projectSlug))
  if (verdict.allowed) return
  setResponseHeader(event, 'retry-after', verdict.retryAfter)
  throw createError({ statusCode: 429, statusMessage: 'Too many requests, try again later' })
}
