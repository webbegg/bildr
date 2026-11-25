import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'

/**
 * Simple data S7 / P3 (verify R3-004): the generated browser composition and composables are run for real, not only read as text: the
 * composables of the "weather" source of the golden fixture, over its composition, use-cases, repository, mappers, schemas and client.
 * Only what the app provides is replaced: `#app` (the runtime config) and the query helpers (TanStack and Vue are not dependencies of this
 * package), and `fetch`.
 */
interface QueryOptions { fetch: (input: unknown, signal: AbortSignal) => Promise<unknown> }
interface Composables {
  useWeatherForecast: (input: unknown) => { options: QueryOptions }
  useWeatherReportForecast: () => { run: (input: unknown) => Promise<{ ok: true, value: unknown } | { ok: false, error: string }> }
}

const CONFIG = '__bildrBrowserCompositionConfig'
/** The helpers of app/data/api-query.ts without TanStack: a query hands its options back, an action's `run` answers a Result as the real one does. */
const QUERY_STUB = `
export const useApiQuery = options => ({ options })
export const useApiAction = call => ({
  run: async (input) => {
    try {
      return { ok: true, value: await call(input) }
    } catch (cause) {
      return { ok: false, error: cause.message }
    }
  }
})
`
const APP_STUB = `export const useRuntimeConfig = () => globalThis.${CONFIG}\n`

describe('generated browser composition and composables, run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-browser-composition-'))
  let composables: Composables

  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const sources = new Map(generate(loaded.model).map(file => [file.path, file.content]))
    // The query helpers are stubbed (TanStack, Vue), but `valueOrThrow` is the generated one: it is what turns a use-case's error into the UI's.
    const helpers = sources.get('layers/apis/app/data/api-query.ts')!
    sources.set('layers/apis/app/data/api-query.ts', `${QUERY_STUB}\n${helpers.slice(helpers.indexOf('export const valueOrThrow'))}`)
    const aliases: Record<string, string> = {
      '#core/kernel/result': 'layers/core/shared/kernel/result.ts',
      '#core/kernel/ids': 'layers/core/shared/kernel/ids.ts',
      '#core/http/client': 'layers/core/shared/http/client.ts'
    }
    mkdirSync(join(dir, 'stubs'), { recursive: true })
    writeFileSync(join(dir, 'stubs/app.mjs'), APP_STUB)
    const zod = import.meta.resolve('zod')
    const emitted = new Set<string>()
    /** What `specifier`, imported by the generated file `from`, is: a stub, the package, or another generated file. */
    const resolve = (specifier: string, from: string): string | undefined => {
      if (specifier === '#app') return pathToFileURL(join(dir, 'stubs/app.mjs')).href
      if (specifier === 'zod') return zod
      if (aliases[specifier]) return emit(aliases[specifier])
      if (specifier.startsWith('.')) return emit(`${posix.normalize(posix.join(posix.dirname(from), specifier))}.ts`)
      return undefined
    }
    /** Transpiles `path` (and, first, what it imports) into the directory, its imports pointing at the transpiled files. */
    const emit = (path: string): string => {
      const out = join(dir, `${path}.mjs`)
      if (emitted.has(path)) return pathToFileURL(out).href
      emitted.add(path)
      const source = sources.get(path)
      if (source === undefined) throw new Error(`The generated project has no ${path}`)
      const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
      const rewritten = js.replace(/(\bfrom\s+|\bimport\s+)(['"])([^'"]+)\2/g, (_, keyword: string, quote: string, specifier: string) => {
        const target = resolve(specifier, path)
        if (!target) throw new Error(`${path} imports ${specifier}, which this test does not provide`)
        return `${keyword}${quote}${target}${quote}`
      })
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, rewritten)
      return pathToFileURL(out).href
    }
    const [forecast, report] = ['useWeatherForecast', 'useWeatherReportForecast'].map(name => emit(`layers/apis/app/composables/apis/${name}.ts`))
    composables = {
      ...(await import(forecast!) as Pick<Composables, 'useWeatherForecast'>),
      ...(await import(report!) as Pick<Composables, 'useWeatherReportForecast'>)
    }
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
  const REMOTE = { city: 'Lisbon', celsius: 21.5, observed_at: '2026-05-01T10:00:00Z' }
  const FORECAST = { city: 'Lisbon', celsius: 21.5, observedAt: '2026-05-01T10:00:00Z' }

  it('a query calls the base URL of the runtime config, with the remote key, and answers the entity', async () => {
    configure('https://weather.example.com/v1')
    const calls = fakeFetch(json(REMOTE))
    const { options } = composables.useWeatherForecast({ city: 'Lisbon' })
    await expect(options.fetch({ city: 'Lisbon' }, new AbortController().signal)).resolves.toEqual(FORECAST)
    expect(calls.map(call => call.url)).toEqual(['https://weather.example.com/v1/forecast?q=Lisbon'])
    expect(calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' })
  })

  it('an answer that is not what the model says: the detail goes to console.warn, the error the UI sees is the generic one', async () => {
    configure('https://weather.example.com/v1')
    fakeFetch(json({ city: 7, observed_at: 'yesterday' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { options } = composables.useWeatherForecast({ city: 'Lisbon' })
    const failure = await options.fetch({ city: 'Lisbon' }, new AbortController().signal).catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('The "weather" API answered something unexpected')
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0] as [string]
    expect(message.startsWith('The "weather" API answered something unexpected: ')).toBe(true)
    // The detail names what was wrong with the answer; the error that reaches the UI doesn't.
    expect(message).toContain('city')
    expect(message).toContain('celsius')
    expect((failure as Error).message).not.toContain('celsius')
  })

  it('an API that answers an error: the status in the message, nothing of its body, nothing on the console', async () => {
    configure('https://weather.example.com/v1')
    fakeFetch(json({ secret_internal: 'upstream' }, 503))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failure = await composables.useWeatherForecast({ city: 'Lisbon' }).options.fetch({ city: 'Lisbon' }, new AbortController().signal).catch((error: Error) => error)
    expect((failure as Error).message).toBe('The "weather" API answered 503.')
    expect(warn).not.toHaveBeenCalled()
  })

  it('aborting the signal of the query cancels the request (verify R3-003)', async () => {
    configure('https://weather.example.com/v1')
    const calls = fakeFetch(init => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })))
    const cancel = new AbortController()
    const pending = composables.useWeatherForecast({ city: 'Lisbon' }).options.fetch({ city: 'Lisbon' }, cancel.signal).catch((error: Error) => error)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.init.signal!.aborted).toBe(false)
    cancel.abort()
    expect(((await pending) as Error).message).toBe('The "weather" API was cancelled.')
    expect(calls[0]!.init.signal!.aborted).toBe(true)
  })

  it('an action sends the entity under its remote keys and answers the entity as a Result; an error is the error of its Result', async () => {
    configure('https://weather.example.com/v1/')
    const calls = fakeFetch(json(REMOTE))
    await expect(composables.useWeatherReportForecast().run({ body: FORECAST })).resolves.toEqual({ ok: true, value: FORECAST })
    expect(calls.map(call => call.url)).toEqual(['https://weather.example.com/v1/reports'])
    expect(calls[0]!.init).toMatchObject({ method: 'POST', body: JSON.stringify(REMOTE), credentials: 'omit' })
    fakeFetch(json({}, 500))
    await expect(composables.useWeatherReportForecast().run({ body: FORECAST })).resolves.toEqual({ ok: false, error: 'The "weather" API answered 500.' })
  })

  it('an input that is not valid never reaches the API', async () => {
    configure('https://weather.example.com/v1')
    const calls = fakeFetch(json(REMOTE))
    const failure = await composables.useWeatherForecast({}).options.fetch({}, new AbortController().signal).catch((error: Error) => error)
    expect((failure as Error).message).toContain('The call to the "weather" API is not valid')
    expect(calls).toEqual([])
  })

  it('a base URL that is not configured fails the call with its message, not the composable', async () => {
    configure(undefined)
    const calls = fakeFetch(json(REMOTE))
    const { options } = composables.useWeatherForecast({ city: 'Lisbon' })
    const failure = await options.fetch({ city: 'Lisbon' }, new AbortController().signal).catch((error: Error) => error)
    expect((failure as Error).message).toBe('The "weather" API has no valid base URL.')
    expect(calls).toEqual([])
  })
})
