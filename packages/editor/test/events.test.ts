// P3b: the editor follows the module's event stream, falling back to polling the version.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { sessionEnded, subscribeEvents } from '../src/api.ts'
import type { BildrEvent } from '../src/api.ts'
import { POLL_MS } from '../src/status.ts'
import { healthReport } from './fixtures.ts'
import { mockActions, mountWithApp, settle } from './helpers.ts'

/** A stand-in for the browser's EventSource: tests open, message and fail it by hand. */
class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  open() {
    this.readyState = FakeEventSource.OPEN
    this.onopen?.()
  }

  send(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }

  /** The server refused or the stream ended for good: the browser gives up on this one. */
  fail() {
    this.readyState = FakeEventSource.CLOSED
    this.onerror?.()
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
  }
}

const latest = () => FakeEventSource.instances.at(-1)!

beforeEach(() => {
  FakeEventSource.instances = []
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  sessionEnded.value = false
})

const versionServer = (versions: number[] | (() => Response)) => {
  const fetchMock = vi.fn(async (url: string) => {
    expect(url).toBe('/__bildr/api/version')
    if (typeof versions === 'function') return versions()
    return new Response(JSON.stringify({ version: versions.length > 1 ? versions.shift() : versions[0] }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('subscribeEvents', () => {
  it('opens /__bildr/api/events and hands each message over, until unsubscribed', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const seen: BildrEvent[] = []
    const stop = subscribeEvents(event => seen.push(event))
    expect(latest().url).toBe('/__bildr/api/events')
    latest().open()
    latest().send({ type: 'ready', version: 3 })
    latest().send({ type: 'model', version: 4, files: ['.bildr/a.json'], source: 'disk' })
    stop()
    expect(latest().readyState).toBe(FakeEventSource.CLOSED)
    latest().send({ type: 'model', version: 5, files: [], source: 'disk' })
    expect(seen).toEqual([{ type: 'ready', version: 3 }, { type: 'model', version: 4, files: ['.bildr/a.json'], source: 'disk' }])
  })

  it('polls /__bildr/api/version while the stream is down, and reconnects', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', FakeEventSource)
    const fetchMock = versionServer([3, 3, 5])
    const seen: BildrEvent[] = []
    const stop = subscribeEvents(event => seen.push(event), { pollMs: 100, retryMs: 1000 })
    latest().open()
    latest().send({ type: 'ready', version: 3 })
    latest().fail()

    await vi.advanceTimersByTimeAsync(350)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // Only a version that moved is news.
    expect(seen.slice(1)).toEqual([{ type: 'version', version: 5 }])

    await vi.advanceTimersByTimeAsync(700)
    expect(FakeEventSource.instances).toHaveLength(2)
    latest().open()
    const polled = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock.mock.calls.length).toBe(polled)
    stop()
  })

  it('polls when the browser has no EventSource, and stops on a 401', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', undefined)
    const fetchMock = versionServer(() => new Response(JSON.stringify({ ok: false }), { status: 401 }))
    subscribeEvents(() => {}, { pollMs: 100 })
    await vi.advanceTimersByTimeAsync(350)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sessionEnded.value).toBe(true)
  })

  it('without polling, does nothing when the stream is unavailable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', undefined)
    const fetchMock = versionServer([1])
    subscribeEvents(() => {}, { poll: false, pollMs: 100 })
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Screens', () => {
  it('re-read the status when the model regenerates, without waiting for the next poll', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const actions = mockActions({ health_get: () => healthReport, migration_pending_get: () => ({ pending: null }) })
    await mountWithApp(App, '/health')
    const before = actions.named('health_get').length
    latest().open()
    latest().send({ type: 'regenerated', version: 1, ok: true })
    await settle()
    expect(actions.named('health_get').length).toBeGreaterThan(before)
    expect(POLL_MS).toBeGreaterThan(1000)
  })
})
