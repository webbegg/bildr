import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { generatedRunner } from './run-generated'

/**
 * codegen-architecture T3c2: the core's data results (layers/core/app/data/results.ts), run. Every composable of the app answers through
 * them: a route read as a Result (`fromRoute`), an action's `{ run, pending, error }` (`useAction`) and a live query's
 * `{ data, status, error, refresh }` (`fromLiveQuery`). Vue is not a dependency of this package: `vue` is the few functions they call.
 */
type ApiError = { type: string, message: string }
type Result = { ok: true, value: unknown } | { ok: false, error: ApiError }
interface Ref<T> { value: T }
interface Results {
  fromRoute: (call: Promise<unknown>) => Promise<Result>
  Answered: new (error: ApiError) => Error & { error: ApiError }
  useAction: (call: (...args: unknown[]) => Promise<Result>) => {
    run: (...args: unknown[]) => Promise<Result>
    pending: Ref<boolean>
    error: Ref<ApiError | undefined>
  }
  fromLiveQuery: (query: Record<string, Ref<unknown>>, refresh: () => Promise<unknown>) => {
    data: Ref<unknown>
    status: Ref<string>
    error: Ref<ApiError | undefined>
    refresh: () => Promise<undefined>
  }
}

const VUE_STUB = `
export const shallowRef = value => ({ value })
export const computed = getter => ({ get value() { return getter() } })
`
const UNEXPECTED: ApiError = { type: 'unexpected', message: 'Something went wrong. Please try again.' }

describe('generated core data results, run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-core-results-'))
  let results: Results

  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const { load } = generatedRunner(new Map(generate(loaded.model).map(file => [file.path, file.content])), dir, { vue: VUE_STUB })
    results = await load<Results>('layers/core/app/data/results.ts')
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fromRoute', () => {
    /** What `$fetch` rejects with for an HTTP error: the response body (h3's error: status, message, data) as `data`. */
    const fetchError = (data: unknown) => Object.assign(new Error('[GET] "/api/apis/shop/item": 502'), { data })

    it('answers the value of a call that succeeded', async () => {
      await expect(results.fromRoute(Promise.resolve([1, 2]))).resolves.toEqual({ ok: true, value: [1, 2] })
    })

    it('answers the domain error the route sent as the data of its HTTP error, as it is', async () => {
      const sent = { type: 'not_configured', message: 'The "shop" API is not configured: set NUXT_APIS_SHOP_API_KEY' }
      await expect(results.fromRoute(Promise.reject(fetchError({ status: 503, message: sent.message, data: sent })))).resolves.toEqual({ ok: false, error: sent })
    })

    it('anything else is `unexpected`: no answer, an answer without a domain error, or not an HTTP error', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      for (const cause of [fetchError(undefined), fetchError({ status: 500, message: 'Server Error' }), fetchError({ data: { type: 'x' } }), new TypeError('bug'), null]) {
        await expect(results.fromRoute(Promise.reject(cause))).resolves.toEqual({ ok: false, error: UNEXPECTED })
      }
      expect(log).toHaveBeenCalledTimes(5)
    })
  })

  describe('useAction', () => {
    const SLUG_TAKEN: ApiError = { type: 'slug_taken', message: 'That slug is taken.' }

    it('an ok Result: answered as it is, with its arguments; no error, not pending', async () => {
      const action = results.useAction(async (...args) => ({ ok: true, value: args }))
      await expect(action.run('a', 2)).resolves.toEqual({ ok: true, value: ['a', 2] })
      expect([action.pending.value, action.error.value]).toEqual([false, undefined])
    })

    it('an error Result: its error, typed, in `error` and in the answer', async () => {
      const action = results.useAction(async () => ({ ok: false, error: SLUG_TAKEN }))
      await expect(action.run()).resolves.toEqual({ ok: false, error: SLUG_TAKEN })
      expect(action.error.value).toBe(SLUG_TAKEN)
    })

    it('an error carried as a thrown `Answered` (through a transaction) is answered as it is, not logged', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const action = results.useAction(async () => {
        throw new results.Answered(SLUG_TAKEN)
      })
      await expect(action.run()).resolves.toEqual({ ok: false, error: SLUG_TAKEN })
      expect(action.error.value).toBe(SLUG_TAKEN)
      expect(log).not.toHaveBeenCalled()
    })

    it('never throws: a call that does is `unexpected`, logged; the next run clears the error', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const bug = new TypeError('bug')
      let fails = true
      const action = results.useAction(async () => {
        if (fails) throw bug
        return { ok: true, value: 1 }
      })
      await expect(action.run()).resolves.toEqual({ ok: false, error: UNEXPECTED })
      expect(log).toHaveBeenCalledWith(bug)
      fails = false
      await action.run()
      expect(action.error.value).toBeUndefined()
    })

    it('is pending while any of its runs is', async () => {
      const finish: Array<(result: Result) => void> = []
      const action = results.useAction(() => new Promise<Result>((resolve) => {
        finish.push(resolve)
      }))
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
  })

  describe('fromLiveQuery', () => {
    /** The flags of a TanStack DB live query, as `useLiveQuery` has them. */
    const live = (flags: { isReady?: boolean, isLoadingError?: boolean, isCrashed?: boolean, isSyncError?: boolean } = {}, data: unknown = []) => ({
      data: { value: data },
      isReady: { value: flags.isReady ?? false },
      isLoadingError: { value: flags.isLoadingError ?? false },
      isCrashed: { value: flags.isCrashed ?? false },
      isSyncError: { value: flags.isSyncError ?? false }
    })

    it('is pending until the query is ready, then success with its data', () => {
      const query = live()
      const answer = results.fromLiveQuery(query, async () => undefined)
      expect([answer.status.value, answer.error.value]).toEqual(['pending', undefined])
      query.isReady.value = true
      query.data.value = [{ id: 1 }]
      expect([answer.data.value, answer.status.value, answer.error.value]).toEqual([[{ id: 1 }], 'success', undefined])
    })

    it('a first load that failed, or a crash, is an error: something unexpected, with the generic message', () => {
      for (const flags of [{ isLoadingError: true }, { isCrashed: true }]) {
        const answer = results.fromLiveQuery(live(flags), async () => undefined)
        expect([answer.status.value, answer.error.value]).toEqual(['error', UNEXPECTED])
      }
    })

    it('a sync that fails after data (a refetch) is an error that keeps the data, as useAsyncData does; it is success again once it syncs', () => {
      const query = live({ isReady: true }, [{ id: 1 }])
      const answer = results.fromLiveQuery(query, async () => undefined)
      query.isSyncError.value = true
      expect([answer.data.value, answer.status.value, answer.error.value]).toEqual([[{ id: 1 }], 'error', UNEXPECTED])
      query.isSyncError.value = false
      expect([answer.status.value, answer.error.value]).toEqual(['success', undefined])
    })

    it('refresh() refetches what the query reads and answers nothing', async () => {
      const refetch = vi.fn(async () => [1])
      const answer = results.fromLiveQuery(live({ isReady: true }), refetch)
      await expect(answer.refresh()).resolves.toBeUndefined()
      expect(refetch).toHaveBeenCalledTimes(1)
    })
  })
})
