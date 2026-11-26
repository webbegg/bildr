import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { generatedRunner } from './run-generated'

/**
 * codegen-architecture T3c2: the composables of a module's queries and actions, run, with the contract of the API ones: a query
 * `{ data, status, error, refresh }`, an action `{ run, pending, error }` whose `run` answers a Result typed by the module's errors.
 * TanStack DB is not a dependency of this package: `@tanstack/vue-db` is a live query the test sets and an optimistic action that runs
 * `onMutate` then `mutationFn` (settling as TanStack's transaction does: with what `mutationFn` threw), the collection one that records.
 */
type ApiError = { type: string, message: string, [key: string]: unknown }
type Result = { ok: true, value: unknown } | { ok: false, error: ApiError }
interface Ref<T> { value: T }
interface Action { run: (input: unknown) => Promise<Result>, pending: Ref<boolean>, error: Ref<ApiError | undefined> }
interface Query { data: Ref<unknown>, status: Ref<string>, error: Ref<ApiError | undefined>, refresh: () => Promise<undefined> }

const STATE = '__bildrModuleComposables'
const VUE_STUB = `
export const shallowRef = value => ({ value })
export const computed = getter => ({ get value() { return getter() } })
export const toValue = source => typeof source === 'function' ? source() : source
`
const VUE_DB_STUB = `
export const useLiveQuery = () => globalThis.${STATE}.live
export const createOptimisticAction = ({ onMutate, mutationFn }) => (input) => {
  onMutate(input)
  const settled = mutationFn(input).then(() => undefined)
  return { when: () => settled }
}
`
const COLLECTION_STUB = `
export const postsCollection = {
  insert: row => globalThis.${STATE}.calls.push(['insert', row]),
  update: (id, change) => {
    const draft = { id, published: false, publishedAt: null }
    change(draft)
    globalThis.${STATE}.calls.push(['update', draft])
  },
  utils: { refetch: async () => { globalThis.${STATE}.calls.push(['refetch']) } }
}
`

describe('generated module composables, run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-module-composables-'))
  let load: <T>(path: string) => Promise<T>
  let state: { calls: unknown[][], live: Record<string, Ref<unknown>> }

  beforeAll(() => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    load = generatedRunner(new Map(generate(loaded.model).map(file => [file.path, file.content])), dir, {
      'vue': VUE_STUB,
      '@tanstack/vue-db': VUE_DB_STUB,
      '../../data/posts.collection': COLLECTION_STUB
    }).load
  })
  beforeEach(() => {
    state = { calls: [], live: {} }
    Object.assign(globalThis, { [STATE]: state })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, STATE)
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** `$fetch` answering `answer` (a function that throws, for an HTTP error), recording its calls. */
  const fetching = (answer: () => unknown) => {
    vi.stubGlobal('$fetch', async (url: string, options: unknown) => {
      state.calls.push(['$fetch', url, options])
      return answer()
    })
  }
  /** What `$fetch` rejects with when the route answers a domain error (`unwrapOrThrow`: the error is the body's `data`). */
  const routeError = (error: ApiError, status: number) => Object.assign(new Error(`[POST] ${status}`), { data: { status, message: error.message, data: error } })

  describe('an action', () => {
    const useCreatePost = async () => (await load<{ useCreatePost: () => Action }>('layers/blog/app/composables/blog/useCreatePost.ts')).useCreatePost()
    const usePublishPost = async () => (await load<{ usePublishPost: () => Action }>('layers/blog/app/composables/blog/usePublishPost.ts')).usePublishPost()

    it('shows its change ahead, calls the route, refetches what it invalidates and answers ok', async () => {
      fetching(() => ({ id: 'p1' }))
      const action = await useCreatePost()
      await expect(action.run({ title: 'Hi', slug: 'hi', body: '', published: false })).resolves.toEqual({ ok: true, value: undefined })
      const [insert, call, refetch] = state.calls as [[string, Record<string, unknown>], [string, string, { method: string, body: { id: string, slug: string } }], [string]]
      expect(insert[0]).toBe('insert')
      expect(call[1]).toBe('/api/blog/posts')
      expect(call[2]).toMatchObject({ method: 'POST', body: { slug: 'hi' } })
      // The row shown ahead and the one sent are the same row: one id.
      expect(call[2].body.id).toBe(insert[1].id)
      expect(refetch).toEqual(['refetch'])
      expect([action.pending.value, action.error.value]).toEqual([false, undefined])
    })

    it('answers the module\'s error the route sent, as it is and typed: in `error` too, nothing refetched', async () => {
      const taken = { type: 'slug_taken', message: 'The slug "hi" is already used by another post.', slug: 'hi' }
      fetching(() => {
        throw routeError(taken, 409)
      })
      const action = await useCreatePost()
      await expect(action.run({ title: 'Hi', slug: 'hi', body: '', published: false })).resolves.toEqual({ ok: false, error: taken })
      expect(action.error.value).toEqual(taken)
      expect(state.calls.map(call => call[0])).toEqual(['insert', '$fetch'])
    })

    it('a route that fails without a domain error is `unexpected`; it never throws', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      fetching(() => {
        throw Object.assign(new Error('[POST] 500'), { data: { status: 500, message: 'Server Error' } })
      })
      const action = await usePublishPost()
      await expect(action.run('p1')).resolves.toEqual({ ok: false, error: { type: 'unexpected', message: 'Something went wrong. Please try again.' } })
    })

    it('an update calls its route with the parameter', async () => {
      fetching(() => ({ id: 'p1' }))
      const action = await usePublishPost()
      await expect(action.run('p1')).resolves.toEqual({ ok: true, value: undefined })
      expect(state.calls[1]).toEqual(['$fetch', '/api/blog/posts/p1/publish', { method: 'POST' }])
    })
  })

  describe('a direct action (no optimistic change: it calls its route itself)', () => {
    const PUBLISH = '.bildr/modules/blog/actions/publish-post.json'
    const directDir = mkdtempSync(join(tmpdir(), 'bildr-module-direct-'))
    let usePublishPost: () => Promise<Action>
    beforeAll(() => {
      const files = fixtureModelFiles()
      const publish = JSON.parse(files[PUBLISH]!) as { client: Record<string, unknown> }
      delete publish.client.optimistic
      const loaded = loadModel({ ...files, [PUBLISH]: JSON.stringify(publish) })
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
      const run = generatedRunner(new Map(generate(loaded.model).map(file => [file.path, file.content])), directDir, {
        'vue': VUE_STUB,
        '../../data/posts.collection': COLLECTION_STUB
      })
      usePublishPost = async () => (await run.load<{ usePublishPost: () => Action }>('layers/blog/app/composables/blog/usePublishPost.ts')).usePublishPost()
    })
    afterAll(() => {
      rmSync(directDir, { recursive: true, force: true })
    })

    it('calls the route, then refetches what it invalidates, and answers ok', async () => {
      fetching(() => undefined)
      const action = await usePublishPost()
      await expect(action.run('p1')).resolves.toEqual({ ok: true, value: undefined })
      expect(state.calls).toEqual([['$fetch', '/api/blog/posts/p1/publish', { method: 'POST' }], ['refetch']])
    })

    it('answers the module\'s error as it is, and refetches nothing', async () => {
      const missing = { type: 'post_not_found', message: 'There is no post p1.', id: 'p1' }
      fetching(() => {
        throw routeError(missing, 404)
      })
      const action = await usePublishPost()
      await expect(action.run('p1')).resolves.toEqual({ ok: false, error: missing })
      expect([action.error.value, state.calls.map(call => call[0])]).toEqual([missing, ['$fetch']])
    })

    it('is pending while a run is, and a route that fails without a domain error is `unexpected`', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      let fail!: (reason: unknown) => void
      vi.stubGlobal('$fetch', () => new Promise((_resolve, reject) => {
        fail = reject
      }))
      const action = await usePublishPost()
      const running = action.run('p1')
      expect(action.pending.value).toBe(true)
      fail(Object.assign(new Error('[POST] 500'), { data: { status: 500, message: 'Server Error' } }))
      await expect(running).resolves.toEqual({ ok: false, error: { type: 'unexpected', message: 'Something went wrong. Please try again.' } })
      expect(action.pending.value).toBe(false)
    })
  })

  describe('a query', () => {
    const useAllPosts = async () => (await load<{ useAllPosts: () => Query }>('layers/blog/app/composables/blog/useAllPosts.ts')).useAllPosts()
    const live = (flags: { isReady?: boolean, isLoadingError?: boolean }) => ({
      data: { value: [] }, isReady: { value: flags.isReady ?? false }, isLoadingError: { value: flags.isLoadingError ?? false }, isCrashed: { value: false }, isSyncError: { value: false }
    })

    it('answers the live query\'s data with its status, and refresh() refetches its collection', async () => {
      state.live = live({})
      const query = await useAllPosts()
      expect(query.status.value).toBe('pending')
      state.live.isReady!.value = true
      expect([query.data.value, query.status.value, query.error.value]).toEqual([[], 'success', undefined])
      await query.refresh()
      expect(state.calls).toEqual([['refetch']])
    })

    it('a first load that failed is an error', async () => {
      state.live = live({ isLoadingError: true })
      const query = await useAllPosts()
      expect([query.status.value, query.error.value?.type]).toEqual(['error', 'unexpected'])
    })
  })
})
