import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoalescer, isSampleData, SAMPLE_MAX_WAIT_MS, SAMPLE_SETTLE_MS, SETTLE_MS } from '../src/node/coalesce'

/**
 * D4 (S4): a sample-data edit rewrites the generated seed, which rebuilds Nitro, and a request that reaches the dev server
 * during a rebuild can wait for good (the e2e saw one for 300 s). A burst of cell edits must therefore regenerate once,
 * after the edits stop, not once per cell. Everything else still regenerates 150 ms after its change.
 */

const ROW = 'modules/blog/fixtures/post.json'
const PAGE = 'modules/blog/pages/index.json'

let synced: string[][]
let notified: string[][]
const make = () => createCoalescer({ sync: files => synced.push(files), notify: files => notified.push(files) })

beforeEach(() => {
  vi.useFakeTimers()
  synced = []
  notified = []
})
afterEach(() => vi.useRealTimers())

describe('isSampleData', () => {
  it('is a fixtures file of a module, and nothing else', () => {
    expect(isSampleData('modules/blog/fixtures/post.json')).toBe(true)
    expect(isSampleData('modules/shop/fixtures/order-item.json')).toBe(true)
    expect(isSampleData('modules/blog/entities/post.json')).toBe(false)
    expect(isSampleData('modules/blog/fixtures/nested/post.json')).toBe(false)
    expect(isSampleData('modules/blog/fixtures/post.txt')).toBe(false)
    expect(isSampleData('fixtures/post.json')).toBe(false)
  })
})

describe('regenerating after model changes', () => {
  it('a model change regenerates 150 ms after it, once for the changes close together', () => {
    const coalescer = make()
    coalescer.add(PAGE)
    vi.advanceTimersByTime(SETTLE_MS - 1)
    coalescer.add('modules/blog/entities/post.json')
    vi.advanceTimersByTime(SETTLE_MS - 1)
    expect(synced).toEqual([])
    vi.advanceTimersByTime(1)
    expect(synced).toEqual([[PAGE, 'modules/blog/entities/post.json']])
  })

  it('a burst of sample-row edits regenerates once, after the edits stop, not once per edit', () => {
    const coalescer = make()
    for (let edit = 0; edit < 12; edit++) {
      coalescer.add(ROW)
      vi.advanceTimersByTime(600)
    }
    // 600 ms is more than the 150 ms of other changes, and still inside the quiet time sample edits wait for.
    expect(synced).toEqual([])
    vi.advanceTimersByTime(SAMPLE_SETTLE_MS - 600)
    expect(synced).toEqual([[ROW]])
    vi.advanceTimersByTime(60_000)
    expect(synced).toHaveLength(1)
  })

  it('an edit of other things in the middle of the sample edits brings the regeneration forward, with both', () => {
    const coalescer = make()
    coalescer.add(ROW)
    vi.advanceTimersByTime(700)
    coalescer.add(PAGE)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(synced).toEqual([[ROW, PAGE]])
  })

  it('never waits for sample edits to stop for longer than the cap', () => {
    const coalescer = make()
    let waited = 0
    // An edit every second, for good: the quiet time never comes.
    while (synced.length === 0 && waited < 3 * SAMPLE_MAX_WAIT_MS) {
      coalescer.add(ROW)
      vi.advanceTimersByTime(1000)
      waited += 1000
    }
    expect(synced).toHaveLength(1)
    expect(waited).toBeLessThanOrEqual(SAMPLE_MAX_WAIT_MS + 1000)
    // The next burst starts its own wait.
    coalescer.add(ROW)
    vi.advanceTimersByTime(SAMPLE_SETTLE_MS)
    expect(synced).toHaveLength(2)
  })

  it('a regeneration done leaves nothing pending: a later change is a new burst', () => {
    const coalescer = make()
    coalescer.add(ROW)
    vi.advanceTimersByTime(SAMPLE_SETTLE_MS)
    coalescer.add(PAGE)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(synced).toEqual([[ROW], [PAGE]])
  })

  it('cancel drops what is waiting', () => {
    const coalescer = make()
    coalescer.add(ROW)
    coalescer.add(PAGE)
    coalescer.cancel()
    vi.advanceTimersByTime(60_000)
    expect(synced).toEqual([])
    expect(notified).toEqual([])
  })
})

describe('telling the open editors', () => {
  it('is not held back by the wait of the sample edits: it comes 150 ms after the changes', () => {
    const coalescer = make()
    coalescer.add(ROW)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(notified).toEqual([[ROW]])
    expect(synced).toEqual([])
    coalescer.add(ROW)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(notified).toEqual([[ROW], [ROW]])
  })
})
