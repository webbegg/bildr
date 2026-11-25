import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { generatedRunner } from './run-generated'

/**
 * codegen-architecture T3c: the generated query helpers (app/data/api-query.ts), run. Vue and TanStack Query are not dependencies of this
 * package: `vue` is the few functions the helpers call, the query observer one the test drives (what it answers, when), the query client
 * one that records what it invalidates. What is tested is the helpers' own: the contract `{ data, status, error, refresh }`, the typed
 * error carried through the observer, what is retried, the action's Result, and `fromRoute`.
 */
type ApiError = { type: string, message: string, status?: number }
type Result = { ok: true, value: unknown } | { ok: false, error: ApiError }
interface Ref<T> { value: T }
interface ObserverResult { data?: unknown, error: unknown, isFetching: boolean, status: 'pending' | 'success' | 'error' }
interface Observer {
  options: { queryKey: unknown[], queryFn: (context: { signal: AbortSignal }) => Promise<unknown>, retry: (count: number, cause: Error) => boolean }
  emit: (result: ObserverResult) => void
  refetched: number
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
  fromRoute: (call: Promise<unknown>) => Promise<Result>
}

const STATE = '__bildrQueryHelpers'
const VUE_STUB = `
export const shallowRef = value => ({ value })
export const toValue = source => typeof source === 'function' ? source() : source
export const watch = () => {}
export const getCurrentScope = () => undefined
export const onScopeDispose = () => {}
`
const QUERY_CORE_STUB = `
export class QueryObserver {
  constructor(_client, options) {
    this.options = options
    this.listeners = []
    this.refetched = 0
    this.current = { data: undefined, error: null, isFetching: false, status: 'pending' }
    globalThis.${STATE}.observers.push(this)
  }
  getCurrentResult() { return this.current }
  subscribe(listener) { this.listeners.push(listener); return () => {} }
  setOptions(options) { this.options = options }
  refetch() { this.refetched += 1; return Promise.resolve(this.current) }
  emit(result) { this.current = result; this.listeners.forEach(listener => listener(result)) }
}
`
const QUERY_CLIENT_STUB = `export const queryClient = { invalidateQueries: async ({ queryKey }) => { globalThis.${STATE}.invalidated.push(queryKey) } }`

describe('generated query helpers, run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-query-helpers-'))
  let helpers: Helpers
  let state: { observers: Observer[], invalidated: unknown[][] }

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
    state = { observers: [], invalidated: [] }
    Object.assign(globalThis, { [STATE]: state })
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, STATE)
  })

  const NOT_FOUND: ApiError = { type: 'remote_failed', status: 404, message: 'The "shop" API answered 404.' }
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

    it('is pending until it answers, then success with the data, then pending again while it fetches again', () => {
      const { data, status, error, observer } = query(async () => ({ ok: true, value: 1 }))
      expect(status.value).toBe('pending')
      observer.emit({ data: { id: 1 }, error: null, isFetching: false, status: 'success' })
      expect([data.value, status.value, error.value]).toEqual([{ id: 1 }, 'success', undefined])
      observer.emit({ data: { id: 1 }, error: null, isFetching: true, status: 'success' })
      expect(status.value).toBe('pending')
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

    it('a call that throws (a bug) is `unexpected`: a generic message, the detail on the console', () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { error, observer } = query(async () => ({ ok: true, value: 1 }))
      const bug = new TypeError('x is undefined')
      observer.emit({ error: bug, isFetching: false, status: 'error' })
      expect(error.value).toEqual({ type: 'unexpected', message: 'Something went wrong. Please try again.' })
      expect(log).toHaveBeenCalledWith(bug)
    })

    it('tries again only what may pass a second time: a failed API or something unexpected, three times at most', async () => {
      /** What the query's function throws for `error`, and the query's own retry rule. */
      const failing = async (error: ApiError) => thrown(query(async () => ({ ok: false, error })).observer) as Promise<Error>
      const { retry } = query(async () => ({ ok: true, value: 1 })).observer.options
      expect(retry(0, await failing(NOT_FOUND))).toBe(true)
      expect(retry(2, await failing(NOT_FOUND))).toBe(true)
      expect(retry(3, await failing(NOT_FOUND))).toBe(false)
      expect(retry(0, new TypeError('offline'))).toBe(true)
      for (const type of ['invalid_input', 'invalid_answer', 'not_configured']) expect(retry(0, await failing({ type, message: type }))).toBe(false)
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

    it('is pending while it runs', async () => {
      let finish = (_result: Result) => {}
      const action = helpers.useApiAction(() => new Promise<Result>((resolve) => {
        finish = resolve
      }), ['apis', 'shop'])
      const running = action.run()
      expect(action.pending.value).toBe(true)
      finish({ ok: true, value: undefined })
      await running
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

  describe('fromRoute', () => {
    /** What `$fetch` rejects with for an HTTP error: the response body (h3's error: status, message, data) as `data`. */
    const fetchError = (data: unknown) => Object.assign(new Error('[GET] "/api/apis/shop/item": 502'), { data })

    it('answers the value of a call that succeeded', async () => {
      await expect(helpers.fromRoute(Promise.resolve([1, 2]))).resolves.toEqual({ ok: true, value: [1, 2] })
    })

    it('answers the source\'s error the route sent as the data of its HTTP error, as it is', async () => {
      const sent = { type: 'not_configured', message: 'The "shop" API is not configured: set NUXT_APIS_SHOP_API_KEY' }
      await expect(helpers.fromRoute(Promise.reject(fetchError({ status: 503, message: sent.message, data: sent })))).resolves.toEqual({ ok: false, error: sent })
    })

    it('anything else is `unexpected`: no answer, an answer without an error of the source, or not an HTTP error', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const UNEXPECTED = { ok: false, error: { type: 'unexpected', message: 'Something went wrong. Please try again.' } }
      for (const cause of [fetchError(undefined), fetchError({ status: 500, message: 'Server Error' }), fetchError({ data: { type: 'x' } }), new TypeError('bug'), null]) {
        await expect(helpers.fromRoute(Promise.reject(cause))).resolves.toEqual(UNEXPECTED)
      }
      expect(log).toHaveBeenCalledTimes(5)
    })
  })
})
