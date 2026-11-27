import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'
import { generatedRunner } from './run-generated'

/**
 * codegen-architecture T3c: the generated query helpers (app/data/api-query.ts), run. Vue and TanStack Query are not dependencies of this
 * package: `vue` is the few functions the helpers call, the query observer one the test drives (what it answers, when), the query client
 * one that records what it invalidates. What is tested is the helpers' own: the contract `{ data, status, error, refresh }`, the typed
 * error carried through the observer, what is retried, and the action's Result. They run over the core's results (`useAction`, `Answered`),
 * which core-results.test.ts tests with `fromRoute`.
 */
type ApiError = { type: string, message: string, status?: number }
type Result = { ok: true, value: unknown } | { ok: false, error: ApiError }
interface Ref<T> { value: T }
interface ObserverResult { data?: unknown, error: unknown, isFetching: boolean, status: 'pending' | 'success' | 'error' }
interface Observer {
  options: { queryKey: unknown[], queryFn: (context: { signal: AbortSignal }) => Promise<unknown>, retry: (count: number, cause: Error) => boolean }
  emit: (result: ObserverResult) => void
  refetched: number
  unsubscribed: boolean
}
interface Helpers {
  useApiQuery: (options: { key: unknown[], input: unknown, fetch: (input: unknown, signal: AbortSignal) => Promise<Result> }) => {
    data: Ref<unknown>
    status: Ref<string>
    error: Ref<ApiError | undefined>
    refresh: () => Promise<undefined>
  }
  useApiAction: (call: (input: unknown) => Promise<Result>, invalidates: unknown[]) => {
    run: (input?: unknown) => Promise<Result>
    pending: Ref<boolean>
    error: Ref<ApiError | undefined>
  }
}

const STATE = '__bildrQueryHelpers'
/** Vue's few functions the helpers call: a watcher and a scope the test drives (`state.watchers`, `state.scope`, `state.disposers`). */
const VUE_STUB = `
export const shallowRef = value => ({ value })
export const computed = getter => ({ get value() { return getter() } })
export const toValue = source => typeof source === 'function' ? source() : source
export const watch = (source, callback) => { globalThis.${STATE}.watchers.push({ source, callback }) }
export const getCurrentScope = () => globalThis.${STATE}.scope
export const onScopeDispose = callback => { globalThis.${STATE}.disposers.push(callback) }
`
const QUERY_CORE_STUB = `
export class QueryObserver {
  constructor(_client, options) {
    this.options = options
    this.listeners = []
    this.refetched = 0
    this.unsubscribed = false
    this.current = { data: undefined, error: null, isFetching: false, status: 'pending' }
    globalThis.${STATE}.observers.push(this)
  }
  getCurrentResult() { return this.current }
  subscribe(listener) { this.listeners.push(listener); return () => { this.unsubscribed = true } }
  setOptions(options) { this.options = options }
  refetch() { this.refetched += 1; return Promise.resolve(this.current) }
  emit(result) { this.current = result; this.listeners.forEach(listener => listener(result)) }
}
`
const QUERY_CLIENT_STUB = `export const queryClient = { invalidateQueries: async ({ queryKey }) => { globalThis.${STATE}.invalidated.push(queryKey) } }`

describe('generated query helpers, run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-query-helpers-'))
  let helpers: Helpers
  let state: {
    observers: Observer[]
    invalidated: unknown[][]
    watchers: Array<{ source: () => unknown, callback: () => void }>
    scope?: object
    disposers: Array<() => void>
  }

  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const { load } = generatedRunner(new Map(generate(loaded.model).map(file => [file.path, file.content])), dir, {
      'vue': VUE_STUB,
      '@tanstack/query-core': QUERY_CORE_STUB,
      '#layers/core/app/data/query-client': QUERY_CLIENT_STUB
    })
    helpers = await load<Helpers>('layers/apis/app/data/api-query.ts')
  })
  beforeEach(() => {
    state = { observers: [], invalidated: [], watchers: [], disposers: [] }
    Object.assign(globalThis, { [STATE]: state })
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, STATE)
  })

  const NOT_FOUND: ApiError = { type: 'not_found', status: 404, message: 'The "shop" API answered 404.' } as ApiError
  const INVALID: ApiError = { type: 'invalid_input', message: 'The call to the "shop" API is not valid: id' }
  const signal = new AbortController().signal
  /** A query over `fetch`, and the observer behind it. */
  const query = (fetch: (input: unknown) => Promise<Result>, input: unknown = { id: 1 }) => {
    const answer = helpers.useApiQuery({ key: ['apis', 'shop', 'item'], input, fetch })
    return { ...answer, observer: state.observers.at(-1)! }
  }
  /** What the query's function threw for an error Result: the observer gets it, as TanStack does. */
  const thrown = async (observer: Observer) => observer.options.queryFn({ signal }).then(() => undefined, (cause: Error) => cause)

  describe('useApiQuery', () => {
    it('keys the cache by the input and answers the value of an ok Result', async () => {
      const { observer } = query(async input => ({ ok: true, value: input }), () => ({ id: 2 }))
      expect(observer.options.queryKey).toEqual(['apis', 'shop', 'item', { id: 2 }])
      await expect(observer.options.queryFn({ signal })).resolves.toEqual({ id: 2 })
    })

    it('fetches again with the new input as its key when the input changes', () => {
      let id = 1
      const { observer } = query(async () => ({ ok: true, value: 1 }), () => ({ id }))
      const [watcher] = state.watchers
      id = 2
      expect(watcher!.source()).toEqual({ id: 2 })
      watcher!.callback()
      expect(observer.options.queryKey).toEqual(['apis', 'shop', 'item', { id: 2 }])
    })

    it('stops listening to the observer when its scope ends', () => {
      state.scope = {}
      const { observer } = query(async () => ({ ok: true, value: 1 }))
      expect(observer.unsubscribed).toBe(false)
      state.disposers.forEach(dispose => dispose())
      expect(observer.unsubscribed).toBe(true)
    })

    it('is pending until it answers, then success with the data; fetching again keeps the answer shown (R3-002)', () => {
      const { data, status, error, observer } = query(async () => ({ ok: true, value: 1 }))
      expect(status.value).toBe('pending')
      observer.emit({ data: { id: 1 }, error: null, isFetching: false, status: 'success' })
      expect([data.value, status.value, error.value]).toEqual([{ id: 1 }, 'success', undefined])
      // A refresh, or the window taking the focus again: the page keeps what it shows instead of flashing its loading text.
      observer.emit({ data: { id: 1 }, error: null, isFetching: true, status: 'success' })
      expect([data.value, status.value]).toEqual([{ id: 1 }, 'success'])
      // A new input has no answer yet: pending.
      observer.emit({ data: undefined, error: null, isFetching: true, status: 'pending' })
      expect([data.value, status.value]).toEqual([undefined, 'pending'])
    })

    it('fetching again after an error is pending without the old error; failing after an answer is an error, the answer kept', async () => {
      const { data, status, error, observer } = query(async () => ({ ok: false, error: NOT_FOUND }))
      const cause = await thrown(observer)
      // TanStack keeps the error of the last attempt while it fetches again.
      observer.emit({ error: cause, isFetching: true, status: 'error' })
      expect([status.value, error.value]).toEqual(['pending', undefined])
      observer.emit({ data: { id: 1 }, error: cause, isFetching: false, status: 'error' })
      expect([data.value, status.value, error.value]).toEqual([{ id: 1 }, 'error', NOT_FOUND])
    })

    it('an error Result becomes the query\'s error as it is, typed: the source\'s own, never a message', async () => {
      const { status, error, observer } = query(async () => ({ ok: false, error: NOT_FOUND }))
      const cause = await thrown(observer)
      expect(cause).toBeInstanceOf(Error)
      observer.emit({ error: cause, isFetching: false, status: 'error' })
      expect(status.value).toBe('error')
      expect(error.value).toBe(NOT_FOUND)
      observer.emit({ data: 1, error: null, isFetching: false, status: 'success' })
      expect(error.value).toBeUndefined()
    })

    it('a call that throws (a bug) is `unexpected`: a generic message, the detail on the console once, however often it is reported', () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { error, observer } = query(async () => ({ ok: true, value: 1 }))
      const bug = new TypeError('x is undefined')
      observer.emit({ error: bug, isFetching: false, status: 'error' })
      const first = error.value
      expect(first).toEqual({ type: 'unexpected', message: 'Something went wrong. Please try again.' })
      observer.emit({ data: 1, error: bug, isFetching: false, status: 'error' })
      expect(error.value).toBe(first)
      expect(log).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith(bug)
    })

    it('tries again only what may pass a second time: a wait, a timeout, an outage or something unexpected, three times at most (R3-001, R3\')', async () => {
      /** What the query's function throws for `error`, and the query's own retry rule. */
      const failing = async (error: ApiError) => thrown(query(async () => ({ ok: false, error })).observer) as Promise<Error>
      const { retry } = query(async () => ({ ok: true, value: 1 })).observer.options
      const remote = (type: string) => failing({ type, status: 0, message: type } as ApiError)
      for (const type of ['rate_limited', 'timeout', 'unavailable']) expect(retry(0, await remote(type)), type).toBe(true)
      expect(retry(2, await remote('unavailable'))).toBe(true)
      expect(retry(3, await remote('unavailable'))).toBe(false)
      // What the API answered on purpose is its answer: a 404 shows at once, not after three tries.
      for (const type of ['not_found', 'unauthorized', 'remote_failed']) expect(retry(0, await remote(type)), type).toBe(false)
      expect(retry(0, new TypeError('offline'))).toBe(true)
      for (const type of ['invalid_input', 'invalid_answer', 'not_configured']) expect(retry(0, await failing({ type, message: type }))).toBe(false)
    })

    it('waits at least as long as the source asked (Retry-After), and does not try again a wait over 10 s; else backs off (R3\'b)', async () => {
      const failing = async (error: ApiError) => thrown(query(async () => ({ ok: false, error })).observer) as Promise<Error>
      const { retry, retryDelay } = query(async () => ({ ok: true, value: 1 })).observer.options as unknown as {
        retry: (count: number, cause: Error) => boolean
        retryDelay: (count: number, cause: Error) => number
      }
      const waiting = (retryAfter?: number) => failing({ type: 'rate_limited', status: 429, message: 'wait', ...(retryAfter === undefined ? {} : { retryAfter }) } as ApiError)
      expect(retryDelay(0, await waiting(5))).toBe(5000)
      // A wait of 0 (or a date that has passed) is no reason to hammer it: the backoff still applies.
      expect(retryDelay(1, await waiting(0))).toBe(2000)
      expect(retryDelay(2, await waiting(1))).toBe(4000)
      // Three waits of 10 s at most: a rate-limited query shows its error within about half a minute.
      expect(retry(0, await waiting(10))).toBe(true)
      expect(retry(0, await waiting(11))).toBe(false)
      expect(retryDelay(0, await waiting())).toBe(1000)
      expect(retryDelay(2, await waiting())).toBe(4000)
      expect(retryDelay(9, new TypeError('offline'))).toBe(30_000)
    })

    it('refresh() fetches again and answers nothing', async () => {
      const { refresh, observer } = query(async () => ({ ok: true, value: 1 }))
      await expect(refresh()).resolves.toBeUndefined()
      expect(observer.refetched).toBe(1)
    })
  })

  describe('useApiAction', () => {
    it('an ok Result: answered as it is, the queries of the source refetched, no error, not pending', async () => {
      const action = helpers.useApiAction(async input => ({ ok: true, value: input }), ['apis', 'shop'])
      await expect(action.run({ id: 1 })).resolves.toEqual({ ok: true, value: { id: 1 } })
      expect(state.invalidated).toEqual([['apis', 'shop']])
      expect([action.pending.value, action.error.value]).toEqual([false, undefined])
    })

    it('is pending while any of its runs is (R3-006)', async () => {
      const finish: Array<(result: Result) => void> = []
      const action = helpers.useApiAction(() => new Promise<Result>((resolve) => {
        finish.push(resolve)
      }), ['apis', 'shop'])
      const first = action.run()
      const second = action.run()
      expect(action.pending.value).toBe(true)
      finish[0]!({ ok: true, value: undefined })
      await first
      expect(action.pending.value).toBe(true)
      finish[1]!({ ok: true, value: undefined })
      await second
      expect(action.pending.value).toBe(false)
    })

    it('an error Result: its error, typed, in `error` and in the answer; nothing refetched', async () => {
      const action = helpers.useApiAction(async () => ({ ok: false, error: INVALID }), ['apis', 'shop'])
      await expect(action.run()).resolves.toEqual({ ok: false, error: INVALID })
      expect(action.error.value).toBe(INVALID)
      expect(state.invalidated).toEqual([])
    })

    it('never throws: a call that does is `unexpected`; the next run clears the error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      let fails = true
      const action = helpers.useApiAction(async () => {
        if (fails) throw new TypeError('bug')
        return { ok: true, value: 1 }
      }, ['apis', 'shop'])
      await expect(action.run()).resolves.toEqual({ ok: false, error: { type: 'unexpected', message: 'Something went wrong. Please try again.' } })
      fails = false
      await action.run()
      expect(action.error.value).toBeUndefined()
    })
  })
})

// R3'b RELIABILITY-004: the retry rule above, over the golden blog's pinned TanStack Query, on a clock the test moves: what the page
// does when a source asks it to wait, not only what the helpers would tell TanStack.
const pnpmStore = join(fixtureRoot, 'node_modules/.pnpm')
const queryCoreDirectory = existsSync(pnpmStore) ? readdirSync(pnpmStore).find(name => /^@tanstack\+query-core@/.test(name)) : undefined
const NEEDS_FIXTURE = queryCoreDirectory || process.env.CI ? '' : ' (skipped: run `pnpm --dir fixtures/codegen/blog install` first)'

describe.skipIf(!!NEEDS_FIXTURE)(`generated query helpers over TanStack Query, on a fake clock${NEEDS_FIXTURE}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-query-clock-'))
  let helpers: Helpers

  beforeAll(async () => {
    const core = pathToFileURL(join(pnpmStore, queryCoreDirectory!, 'node_modules/@tanstack/query-core/build/modern/index.js')).href
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const { load } = generatedRunner(new Map(generate(loaded.model).map(file => [file.path, file.content])), dir, {
      'vue': VUE_STUB,
      '@tanstack/query-core': `export * from ${JSON.stringify(core)}`,
      '#layers/core/app/data/query-client': `import { QueryClient } from ${JSON.stringify(core)}\nexport const queryClient = new QueryClient()`
    })
    helpers = await load<Helpers>('layers/apis/app/data/api-query.ts')
  })
  beforeEach(() => {
    Object.assign(globalThis, { [STATE]: { observers: [], invalidated: [], watchers: [], disposers: [] } })
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(globalThis, STATE)
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** A query whose source fails with `error` first, then answers; how many times it was called. */
  const failingOnce = (key: string, error: ApiError) => {
    let calls = 0
    const answer = helpers.useApiQuery({
      key: ['apis', 'shop', key],
      input: { id: 1 },
      fetch: async () => (calls++ === 0 ? { ok: false, error } : { ok: true, value: { id: 1 } })
    })
    return { ...answer, calls: () => calls }
  }

  it('waits the seconds the source asked (Retry-After) before trying again, then shows the answer', async () => {
    const query = failingOnce('waited', { type: 'unavailable', status: 503, message: 'down', retryAfter: 5 } as ApiError)
    await vi.advanceTimersByTimeAsync(0)
    expect(query.calls()).toBe(1)
    // Longer than the first backoff (1 s): it is the source's wait that holds the second try.
    await vi.advanceTimersByTimeAsync(4_999)
    expect([query.calls(), query.status.value]).toEqual([1, 'pending'])
    await vi.advanceTimersByTimeAsync(1)
    expect([query.calls(), query.status.value, query.data.value]).toEqual([2, 'success', { id: 1 }])
  })

  it('a source that asks to wait longer than 10 s is not tried again: its error shows at once', async () => {
    const query = failingOnce('too-long', { type: 'rate_limited', status: 503, message: 'slow down', retryAfter: 11 } as ApiError)
    await vi.advanceTimersByTimeAsync(0)
    expect([query.calls(), query.status.value, query.error.value?.type]).toEqual([1, 'error', 'rate_limited'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(query.calls()).toBe(1)
  })

  it('with no wait asked, a passing failure backs off a second before its second try', async () => {
    const query = failingOnce('backoff', { type: 'timeout', status: 504, message: 'slow' } as ApiError)
    await vi.advanceTimersByTimeAsync(999)
    expect(query.calls()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect([query.calls(), query.status.value]).toEqual([2, 'success'])
  })
})
