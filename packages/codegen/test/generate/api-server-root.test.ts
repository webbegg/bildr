import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { generatedRunner } from './run-generated'

/**
 * codegen-architecture T3b (R3 RELIABILITY-002): the composition root of a server API source, run for real. The "catalog" source of the
 * golden fixture, over its use-cases, repository, mappers, schemas and the core client, then the route's `unwrapOrThrow` with its status
 * map. Only what Nuxt provides is replaced (`nuxt/server`: the runtime config, an h3-like createError), and `fetch`.
 */
type Result = { ok: true, value: unknown } | { ok: false, error: { type: string, message: string, status?: number } }
interface Root {
  useCatalogApi: () => {
    product: (input: unknown) => Promise<Result>
    deleteProduct: (input: unknown) => Promise<Result>
  }
  catalogErrorStatus: Record<string, number>
}
type Unwrap = (result: Result, statuses: Record<string, number>) => unknown

const CONFIG = '__bildrServerRootConfig'
const NUXT_STUB = [
  `export const useRuntimeConfig = () => globalThis.${CONFIG}`,
  'export const createError = ({ status, message, data }) => Object.assign(new Error(message), { status, data })'
].join('\n')

describe('generated server composition root, run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-server-root-'))
  let root: Root
  let unwrapOrThrow: Unwrap

  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const { load } = generatedRunner(new Map(generate(loaded.model).map(file => [file.path, file.content])), dir, { 'nuxt/server': NUXT_STUB })
    root = await load<Root>('layers/apis/server/utils/catalog.ts')
    unwrapOrThrow = (await load<{ unwrapOrThrow: Unwrap }>('layers/core/server/utils/http-error.ts')).unwrapOrThrow
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, CONFIG)
  })

  const configure = (apiKey: string) => Object.assign(globalThis, { [CONFIG]: { apis: { catalog: { baseUrl: 'https://shop.example.com/v1', apiKey } } } })
  const fakeFetch = (answer: Response) => {
    const calls: Array<{ url: string, init: RequestInit }> = []
    vi.stubGlobal('fetch', (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return Promise.resolve(answer)
    })
    return calls
  }
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
  /** What the route answers for `result`: its value, or the status and message of the HTTP error it throws. */
  const routed = (result: Result) => {
    try {
      return { value: unwrapOrThrow(result, root.catalogErrorStatus) }
    } catch (cause) {
      return { status: (cause as { status: number }).status, message: (cause as Error).message }
    }
  }
  const DTO = { id: 7, name: 'Lamp', price: 12.5, in_stock: true, created_at: '2026-05-01T10:00:00Z', note: null, categories: [{ id: 1, name: 'Home' }] }

  it('answers the entity, calling the base URL with the secret', async () => {
    configure('key-1')
    const calls = fakeFetch(json(DTO))
    const result = await root.useCatalogApi().product({ id: 7 })
    expect(result).toEqual({ ok: true, value: { id: 7, name: 'Lamp', price: 12.5, inStock: true, createdAt: '2026-05-01T10:00:00Z', note: null, categories: [{ id: 1, name: 'Home' }] } })
    expect(calls.map(call => call.url)).toEqual(['https://shop.example.com/v1/products/7'])
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer key-1')
    expect(routed(result)).toEqual({ value: (result as { value: unknown }).value })
  })

  it('without its secret answers not_configured naming the env var, without calling the API: the route answers 503', async () => {
    configure(' ')
    const calls = fakeFetch(json(DTO))
    const result = await root.useCatalogApi().product({ id: 7 })
    expect(result).toEqual({ ok: false, error: { type: 'not_configured', message: 'The "catalog" API is not configured: set NUXT_APIS_CATALOG_API_KEY' } })
    expect(calls).toEqual([])
    expect(routed(result)).toMatchObject({ status: 503 })
  })

  // R3': a gateway's statuses. The API refusing the app's key is the server's to fix (502), never the user's session (401).
  it.each([
    [404, 'not_found', 404], [401, 'unauthorized', 502], [403, 'unauthorized', 502], [429, 'rate_limited', 503],
    [504, 'timeout', 504], [500, 'unavailable', 503], [503, 'unavailable', 503], [409, 'remote_failed', 502]
  ])('a call the API answered %i fails as %s: the route answers %i', async (status, type, answered) => {
    configure('key-1')
    fakeFetch(json({ error: 'down' }, status))
    const result = await root.useCatalogApi().deleteProduct({ id: 7 })
    expect(result).toEqual({ ok: false, error: { type, status, message: `The "catalog" API answered ${status}.` } })
    expect(routed(result)).toEqual({ status: answered, message: `The "catalog" API answered ${status}.` })
  })

  it('answers an unexpected answer as invalid_answer without detail, the detail in the server log: the route answers 502', async () => {
    configure('key-1')
    fakeFetch(json({ id: 'seven' }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await root.useCatalogApi().product({ id: 7 })
    expect(result).toEqual({ ok: false, error: { type: 'invalid_answer', message: 'The "catalog" API answered something unexpected' } })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('The "catalog" API answered something unexpected: '))
    expect(routed(result)).toMatchObject({ status: 502 })
  })

  it('refuses an input that is not valid without calling the API: the route answers 400', async () => {
    configure('key-1')
    const calls = fakeFetch(json(DTO))
    const result = await root.useCatalogApi().product({ id: 'x' })
    expect(result).toMatchObject({ ok: false, error: { type: 'invalid_input' } })
    expect(calls).toEqual([])
    expect(routed(result)).toMatchObject({ status: 400 })
  })

  it('lets through what is not a failure of the call (a bug), as it is', async () => {
    configure('key-1')
    const bug = new TypeError('not an HTTP failure')
    // An answer the client can't read: the error is not one of the call's, so the root does not make it an API error.
    vi.stubGlobal('fetch', () => Promise.resolve({
      get type(): never {
        throw bug
      }
    }))
    await expect(root.useCatalogApi().product({ id: 7 })).rejects.toBe(bug)
  })
})
