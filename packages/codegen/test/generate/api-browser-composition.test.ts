import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { generatedRunner } from './run-generated'

/**
 * Simple data S7 / P3 (verify R3-004): the generated browser composition and composables are run for real, not only read as text: the
 * composables of the "weather" source of the golden fixture, over its composition, use-cases, repository, mappers, schemas and client.
 * Only what the app provides is replaced: `#app` (the runtime config) and the query helpers (TanStack and Vue are not dependencies of this
 * package; api-query-helpers.test.ts runs those), and `fetch` (`$fetch` for the server source's composables). Since T3c a composable's call answers the use-case's Result as it is.
 */
type Result = { ok: true, value: unknown } | { ok: false, error: { type: string, message: string, status?: number } }
interface QueryOptions { key: unknown[], input: unknown, fetch: (input: unknown, signal: AbortSignal) => Promise<Result> }
interface Action { run: (input?: unknown) => Promise<Result>, invalidates: unknown[] }
interface Composables {
  useWeatherForecast: (input: unknown) => { options: QueryOptions }
  useWeatherReportForecast: () => Action
  useCatalogProducts: (input?: unknown) => { options: QueryOptions }
  useCatalogDeleteProduct: () => Action
  useCatalogCreateProduct: () => Action
}

const CONFIG = '__bildrBrowserCompositionConfig'
/** The helpers of app/data/api-query.ts without TanStack: a query hands its options back, an action's `run` is its call. */
const QUERY_STUB = `
export const useApiQuery = options => ({ options })
export const useApiAction = (call, invalidates) => ({ run: call, invalidates })
`
/** The core's `fromRoute` (core-results.test.ts runs it), marking what it read. */
const RESULTS_STUB = 'export const fromRoute = async call => ({ ok: true, value: { fromRoute: await call } })\n'
const APP_STUB = `export const useRuntimeConfig = () => globalThis.${CONFIG}\n`

describe('generated browser composition and composables, run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-browser-composition-'))
  let composables: Composables

  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const sources = new Map(generate(loaded.model).map(file => [file.path, file.content]))
    sources.set('layers/apis/app/data/api-query.ts', QUERY_STUB)
    const { load } = generatedRunner(sources, dir, { '#app': APP_STUB, '#layers/core/app/data/results': RESULTS_STUB })
    const names: Array<keyof Composables> = ['useWeatherForecast', 'useWeatherReportForecast', 'useCatalogProducts', 'useCatalogDeleteProduct', 'useCatalogCreateProduct']
    composables = Object.assign({}, ...await Promise.all(names.map(name => load<Partial<Composables>>(`layers/apis/app/composables/apis/${name}.ts`)))) as Composables
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, CONFIG)
  })

  const configure = (baseUrl: string | undefined) => Object.assign(globalThis, { [CONFIG]: { public: { apis: { weather: { baseUrl } } } } })
  /** `fetch` answers `answer` (a hanging call when it is a function that takes the init); what it was asked is kept. */
  const fakeFetch = (answer: Response | ((init: RequestInit) => Promise<Response>)) => {
    const calls: Array<{ url: string, init: RequestInit }> = []
    vi.stubGlobal('fetch', (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return typeof answer === 'function' ? answer(init) : Promise.resolve(answer)
    })
    return calls
  }
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
  const forecast = (input: unknown, signal = new AbortController().signal) => composables.useWeatherForecast(input).options.fetch(input, signal)
  const REMOTE = { city: 'Lisbon', celsius: 21.5, observed_at: '2026-05-01T10:00:00Z' }
  const FORECAST = { city: 'Lisbon', celsius: 21.5, observedAt: '2026-05-01T10:00:00Z' }

  it('a query is cached under its source and name, with its input; an action refetches the queries of its source (R3-005)', () => {
    configure('https://weather.example.com/v1')
    const input = () => ({ city: 'Lisbon' })
    expect(composables.useWeatherForecast(input).options).toMatchObject({ key: ['apis', 'weather', 'forecast'], input })
    expect(composables.useWeatherReportForecast().invalidates).toEqual(['apis', 'weather'])
    expect(composables.useCatalogProducts().options).toMatchObject({ key: ['apis', 'catalog', 'products'], input: {} })
    expect(composables.useCatalogDeleteProduct().invalidates).toEqual(['apis', 'catalog'])
  })

  it('a server source\'s composables call its route with $fetch and read it with fromRoute: the query string, the body, the signal (R3-005)', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    vi.stubGlobal('$fetch', async (url: string, options: Record<string, unknown>) => {
      calls.push([url, options])
      return 'answered'
    })
    const signal = new AbortController().signal
    await expect(composables.useCatalogProducts().options.fetch({ category: 'lamps' }, signal)).resolves.toEqual({ ok: true, value: { fromRoute: 'answered' } })
    // An action that answers nothing gets the route's empty answer as it is.
    await expect(composables.useCatalogDeleteProduct().run({ id: 7 })).resolves.toEqual({ ok: true, value: { fromRoute: 'answered' } })
    await composables.useCatalogCreateProduct().run({ body: { name: 'Lamp' } })
    expect(calls).toEqual([
      ['/api/apis/catalog/products', { query: { category: 'lamps' }, signal }],
      ['/api/apis/catalog/delete-product', { method: 'DELETE', query: { id: 7 } }],
      ['/api/apis/catalog/create-product', { method: 'POST', body: { name: 'Lamp' } }]
    ])
  })

  it('a query calls the base URL of the runtime config, with the remote key, and answers the entity', async () => {
    configure('https://weather.example.com/v1')
    const calls = fakeFetch(json(REMOTE))
    await expect(forecast({ city: 'Lisbon' })).resolves.toEqual({ ok: true, value: FORECAST })
    expect(calls.map(call => call.url)).toEqual(['https://weather.example.com/v1/forecast?q=Lisbon'])
    expect(calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' })
  })

  it('an answer that is not what the model says: the detail goes to console.warn, the error the UI sees is the generic one', async () => {
    configure('https://weather.example.com/v1')
    fakeFetch(json({ city: 7, observed_at: 'yesterday' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await forecast({ city: 'Lisbon' })
    expect(result).toEqual({ ok: false, error: { type: 'invalid_answer', message: 'The "weather" API answered something unexpected' } })
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0] as [string]
    expect(message.startsWith('The "weather" API answered something unexpected: ')).toBe(true)
    // The detail names what was wrong with the answer; the error that reaches the UI doesn't.
    expect(message).toContain('city')
    expect(message).toContain('celsius')
    expect(JSON.stringify(result)).not.toContain('celsius')
  })

  it('an API that answers an error: remote_failed with the status, nothing of its body, nothing on the console', async () => {
    configure('https://weather.example.com/v1')
    fakeFetch(json({ secret_internal: 'upstream' }, 503))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(forecast({ city: 'Lisbon' })).resolves.toEqual({ ok: false, error: { type: 'remote_failed', status: 503, message: 'The "weather" API answered 503.' } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('aborting the signal of the query cancels the request (verify R3-003)', async () => {
    configure('https://weather.example.com/v1')
    const calls = fakeFetch(init => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })))
    const cancel = new AbortController()
    const pending = forecast({ city: 'Lisbon' }, cancel.signal)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.init.signal!.aborted).toBe(false)
    cancel.abort()
    expect(await pending).toMatchObject({ ok: false, error: { type: 'remote_failed', message: 'The "weather" API was cancelled.' } })
    expect(calls[0]!.init.signal!.aborted).toBe(true)
  })

  it('an action sends the entity under its remote keys and answers the entity as a Result; an error is the error of its Result', async () => {
    configure('https://weather.example.com/v1/')
    const calls = fakeFetch(json(REMOTE))
    await expect(composables.useWeatherReportForecast().run({ body: FORECAST })).resolves.toEqual({ ok: true, value: FORECAST })
    expect(calls.map(call => call.url)).toEqual(['https://weather.example.com/v1/reports'])
    expect(calls[0]!.init).toMatchObject({ method: 'POST', body: JSON.stringify(REMOTE), credentials: 'omit' })
    fakeFetch(json({}, 500))
    await expect(composables.useWeatherReportForecast().run({ body: FORECAST })).resolves.toEqual({ ok: false, error: { type: 'remote_failed', status: 500, message: 'The "weather" API answered 500.' } })
  })

  it('an input that is not valid never reaches the API', async () => {
    configure('https://weather.example.com/v1')
    const calls = fakeFetch(json(REMOTE))
    const result = await forecast({})
    expect(result).toMatchObject({ ok: false, error: { type: 'invalid_input' } })
    expect(!result.ok && result.error.message).toContain('The call to the "weather" API is not valid')
    expect(calls).toEqual([])
  })

  it('a base URL that is not configured fails the call with its message, not the composable', async () => {
    configure(undefined)
    const calls = fakeFetch(json(REMOTE))
    await expect(forecast({ city: 'Lisbon' })).resolves.toMatchObject({ ok: false, error: { type: 'remote_failed', message: 'The "weather" API has no valid base URL.' } })
    expect(calls).toEqual([])
  })
})
