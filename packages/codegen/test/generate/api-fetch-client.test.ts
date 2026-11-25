import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'

/**
 * Simple data S8 / P2 (verify B5): the server client of the API sources keeps every call on the path the model declares, under the
 * base URL, with the secret. A path parameter is encoded with encodeURIComponent, which leaves "." and "..": as a whole segment the URL
 * parser resolves them, so `/products/:id/reviews` with a text id ".." called `/v1/reviews` with the server's secret.
 */
type Client = (options: { baseUrl: string, headers?: Record<string, string>, unconfigured?: boolean }) => (path: string, request: { method: 'GET' }) => Promise<unknown>

// codegen-architecture T3a: the server sources call through the core HTTP client (layers/core/shared/http/client.ts).
describe('generated HTTP client, as the server calls it: dot segments in a path parameter', () => {
  const seen: string[] = []
  const server = createServer((request, response) => {
    seen.push(request.url!)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })
  let baseUrl = ''
  let createHttpClient: Client
  const dir = mkdtempSync(join(tmpdir(), 'bildr-http-client-'))
  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const source = generate(loaded.model).find(file => file.path === 'layers/core/shared/http/client.ts')!.content
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, 'client.mjs'), js)
    createHttpClient = ((await import(pathToFileURL(join(dir, 'client.mjs')).href)) as { createHttpClient: Client }).createHttpClient
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it.each(['..', '.'])('never calls another path for a path parameter %j', async (id) => {
    seen.length = 0
    const call = createHttpClient({ baseUrl, headers: { authorization: 'Bearer secret' } })
    // What http<S>Repository builds for `/products/:id/reviews` with a text path parameter.
    await call(`/products/${encodeURIComponent(id)}/reviews`, { method: 'GET' }).catch(() => undefined)
    // Either refused, or sent to /v1/products/<one segment>/reviews.
    for (const url of seen) expect(url, url).toMatch(/^\/v1\/products\/[^/]+\/reviews$/)
  })

  // Verify R3-003: the client is the last guard, so it refuses the encoded dot segments too when it is given one straight.
  it.each(['..', '.', '%2e%2e', '%2E.', '.%2e', '%2e', '%2E%2E'])('refuses a path with the dot segment %j, and the server sees no request', async (segment) => {
    seen.length = 0
    const call = createHttpClient({ baseUrl, headers: { authorization: 'Bearer secret' } })
    await expect(call(`/products/${segment}/reviews`, { method: 'GET' })).rejects.toMatchObject({ name: 'HttpFailure', status: 0, message: 'was asked for a path with a "." or ".." segment' })
    expect(seen).toEqual([])
  })

  it('still calls a path whose segment only contains dots or encoded dots', async () => {
    seen.length = 0
    const call = createHttpClient({ baseUrl })
    await call('/products/a.b/%2e%2ex', { method: 'GET' })
    expect(seen).toEqual(['/v1/products/a.b/%2e%2ex'])
  })

  // Verify R3-004: a source with auth whose secret is not set must not call the API without credentials.
  it('refuses a call, before sending it, when the secret is not set (unconfigured)', async () => {
    seen.length = 0
    const call = createHttpClient({ baseUrl, headers: { accept: 'application/json' }, unconfigured: true })
    await expect(call('/products', { method: 'GET' })).rejects.toMatchObject({ name: 'HttpFailure', status: 0, notConfigured: true })
    expect(seen).toEqual([])
  })

  it('calls the API when the secret is set, and a failure of the call is not "not configured"', async () => {
    seen.length = 0
    const call = createHttpClient({ baseUrl, headers: { authorization: 'Bearer secret' }, unconfigured: false })
    await call('/products', { method: 'GET' })
    expect(seen).toEqual(['/v1/products'])
    await expect(call('/products/%2e%2e', { method: 'GET' })).rejects.toMatchObject({ notConfigured: false })
  })
})

/**
 * Verify R3-003: the HTTP repository's `segment()` is what encodes a path parameter. A parameter is one segment of the path: it
 * can't be "", "." or "..", and can't hold a "/" or a "\\" (encoded, they would still reach the API as another path to some servers).
 */
describe('generated http repository: a path parameter is one segment', () => {
  const generated = () => {
    const files = fixtureModelFiles()
    const source = JSON.parse(files['.bildr/datasources/catalog.json']!) as { queries: Array<{ name: string, params: Array<{ type: string }> }> }
    source.queries.find(query => query.name === 'product')!.params[0]!.type = 'text'
    const loaded = loadModel({ ...files, '.bildr/datasources/catalog.json': JSON.stringify(source) })
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    return generate(loaded.model)
  }

  /** The `segment` function of the generated repository, run with a failure that records what it was given. */
  const segmentOf = () => {
    const adapter = generated().find(file => file.path === 'layers/apis/shared/data/catalog/repositories/catalog-repository.http.ts')!.content
    const start = adapter.indexOf('const segment = ')
    const code = adapter.slice(start, adapter.indexOf('\n}\n', start) + 2)
    const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    class Failure extends Error {
      constructor(readonly error: { message: string }) {
        super(error.message)
      }
    }
    return new Function('CatalogFailure', 'invalidInput', `${js}\nreturn segment`)(Failure, (message: string) => ({ message })) as (value: string | number | boolean) => string
  }

  it.each(['', '.', '..'])('refuses %j', (value) => {
    expect(() => segmentOf()(value)).toThrow(/a path parameter can't be/)
  })

  it.each(['a/b', '/', '../x', 'a\\b', '\\', '..\\x'])('refuses %j: a "/" or a "\\" makes it more than one segment', (value) => {
    expect(() => segmentOf()(value)).toThrow(/one segment/)
  })

  it('encodes any other value, and takes numbers and booleans', () => {
    const segment = segmentOf()
    expect(segment('a b?c#d%')).toBe('a%20b%3Fc%23d%25')
    expect(segment('..a')).toBe('..a')
    expect(segment(42)).toBe('42')
    expect(segment(false)).toBe('false')
  })
})
