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
type Client = (options: { baseUrl: string, headers: Record<string, string> }) => (path: string, request: { method: 'GET' }) => Promise<unknown>

describe('generated fetch client: dot segments in a path parameter', () => {
  const seen: string[] = []
  const server = createServer((request, response) => {
    seen.push(request.url!)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })
  let baseUrl = ''
  let createFetchClient: Client
  const dir = mkdtempSync(join(tmpdir(), 'bildr-fetch-client-'))
  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const source = generate(loaded.model).find(file => file.path === 'layers/apis/server/lib/fetch-client.ts')!.content
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, 'fetch-client.mjs'), js)
    createFetchClient = ((await import(pathToFileURL(join(dir, 'fetch-client.mjs')).href)) as { createFetchClient: Client }).createFetchClient
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it.each(['..', '.'])('never calls another path for a path parameter %j', async (id) => {
    seen.length = 0
    const call = createFetchClient({ baseUrl, headers: { authorization: 'Bearer secret' } })
    // What http<S>Repository builds for `/products/:id/reviews` with a text path parameter.
    await call(`/products/${encodeURIComponent(id)}/reviews`, { method: 'GET' }).catch(() => undefined)
    // Either refused, or sent to /v1/products/<one segment>/reviews.
    for (const url of seen) expect(url, url).toMatch(/^\/v1\/products\/[^/]+\/reviews$/)
  })
})
