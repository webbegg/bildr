import { describe, expect, it } from 'vitest'
import { createRateLimiter, publicRateKey } from '../../server/utils/rateLimit'

function fakeClock(start = 1_000_000) {
  let time = start
  return { now: () => time, advance: (ms: number) => (time += ms) }
}

describe('createRateLimiter', () => {
  it('allows `limit` hits per key and window, then refuses with the seconds left', () => {
    const clock = fakeClock()
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: clock.now })
    expect([1, 2, 3].map(() => limiter.hit('a').allowed)).toEqual([true, true, true])
    clock.advance(15_500)
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfter: 45 })
  })

  it('counts each key on its own', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: fakeClock().now })
    expect(limiter.hit('a').allowed).toBe(true)
    expect(limiter.hit('b').allowed).toBe(true)
    expect(limiter.hit('a').allowed).toBe(false)
  })

  it('starts a fresh window once the old one ends', () => {
    const clock = fakeClock()
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now })
    limiter.hit('a')
    clock.advance(59_999)
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfter: 1 })
    clock.advance(1)
    expect(limiter.hit('a')).toEqual({ allowed: true })
  })

  it('forgets ended windows when it holds too many keys', () => {
    const clock = fakeClock()
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now, maxKeys: 2 })
    limiter.hit('a')
    limiter.hit('b')
    clock.advance(1000)
    limiter.hit('c')
    expect(limiter.size()).toBe(1)
  })
})

describe('publicRateKey', () => {
  it('scopes a client address to one project', () => {
    expect(publicRateKey('203.0.113.7', 'cafe')).toBe('203.0.113.7|cafe')
    expect(publicRateKey(undefined, 'cafe')).toBe('unknown|cafe')
  })
})
