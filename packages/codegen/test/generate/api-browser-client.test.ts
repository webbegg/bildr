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
 * Simple data S8 / P3: the browser client of the API sources keeps the guards of the server one (the path is the one the model built,
 * under the base URL, no dot segments, no redirect followed, a size cap) and sends no credentials. The generated file is run for real
 * (Node's fetch), against a local server and a second one a redirect would lead to.
 */
interface Request { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', query?: Record<string, string | number | boolean | undefined>, body?: unknown }
interface Module {
  createBrowserClient: (options: { baseUrl: string }) => (path: string, request: Request) => Promise<unknown>
  valueOrThrow: <T>(result: { ok: true, value: T } | { ok: false, error: { message: string } }) => T
}

describe('generated browser client', () => {
  const seen: Array<{ method?: string, url?: string, headers: Record<string, string | string[] | undefined>, body: string }> = []
  const elsewhere: string[] = []
  const other = createServer((request, response) => {
    elsewhere.push(request.url!)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"leaked":true}')
  })
  let otherUrl = ''
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, body })
      const path = new URL(request.url!, 'http://stub').pathname
      if (path === '/v1/redirect') {
        response.writeHead(302, { location: `${otherUrl}/v1/things` })
        return response.end()
      }
      if (path === '/v1/big') {
        response.writeHead(200, { 'content-type': 'application/json' })
        return response.end(JSON.stringify({ filler: 'x'.repeat(1_100_000) }))
      }
      if (path === '/v1/fail') {
        response.writeHead(500)
        return response.end('{"secret_internal":"upstream"}')
      }
      if (path === '/v1/empty') {
        response.writeHead(204)
        return response.end()
      }
      if (path === '/v1/text') {
        response.writeHead(200)
        return response.end('<html>')
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
  })
  let baseUrl = ''
  let client: Module
  const dir = mkdtempSync(join(tmpdir(), 'bildr-browser-client-'))
  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const source = generate(loaded.model).find(file => file.path === 'layers/apis/app/data/browser-client.ts')!.content
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, 'browser-client.mjs'), js)
    client = (await import(pathToFileURL(join(dir, 'browser-client.mjs')).href)) as Module
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    await new Promise<void>(resolve => server.close(() => resolve()))
    await new Promise<void>(resolve => other.close(() => resolve()))
  })

  it('calls the path under the base URL with the query (an undefined value is not sent) and sends no credentials', async () => {
    seen.length = 0
    const call = client.createBrowserClient({ baseUrl })
    await expect(call('/things', { method: 'GET', query: { q: 'a b', page: 2, skip: undefined } })).resolves.toEqual({ ok: true })
    expect(seen.map(entry => entry.url)).toEqual(['/v1/things?q=a+b&page=2'])
    expect(seen[0]!.headers.accept).toBe('application/json')
    expect(Object.keys(seen[0]!.headers).filter(name => /^(?:authorization|cookie|proxy-authorization|x-.*)$/.test(name))).toEqual([])
  })

  it('sends a body as JSON', async () => {
    seen.length = 0
    await client.createBrowserClient({ baseUrl })('/reports', { method: 'POST', body: { city: 'Lisbon' } })
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/reports', body: '{"city":"Lisbon"}' })
    expect(seen[0]!.headers['content-type']).toBe('application/json')
  })

  it.each(['..', '.', '%2e%2e', '%2E.', '.%2e', '%2e'])('refuses a path with the dot segment %j, and the server sees no request', async (segment) => {
    seen.length = 0
    await expect(client.createBrowserClient({ baseUrl })(`/things/${segment}/parts`, { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', status: 0, message: 'was asked for a path with a "." or ".." segment' })
    expect(seen).toEqual([])
  })

  it('refuses a path that is not under the base URL (a second slash would be another host)', async () => {
    seen.length = 0
    elsewhere.length = 0
    const call = client.createBrowserClient({ baseUrl })
    await expect(call(`//${otherUrl.slice('http://'.length)}/things`, { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'was asked for a path outside its base URL' })
    await expect(call('/../other', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure' })
    expect(seen).toEqual([])
    expect(elsewhere).toEqual([])
  })

  it('does not follow a redirect: the other host is never asked', async () => {
    seen.length = 0
    elsewhere.length = 0
    await expect(client.createBrowserClient({ baseUrl })('/redirect', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'answered 302: a redirect is not followed' })
    expect(seen.map(entry => entry.url)).toEqual(['/v1/redirect'])
    expect(elsewhere).toEqual([])
  })

  it('fails with the status, and never carries the body of the answer', async () => {
    const failure = await client.createBrowserClient({ baseUrl })('/fail', { method: 'GET' }).catch((error: Error) => error)
    expect(failure).toMatchObject({ name: 'BrowserFailure', status: 500, message: 'answered 500' })
    expect(JSON.stringify(failure)).not.toContain('upstream')
  })

  it('refuses an answer over 1 MB, answers undefined for an empty one and fails for one without JSON', async () => {
    const call = client.createBrowserClient({ baseUrl })
    await expect(call('/big', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'answered more than 1 MB' })
    await expect(call('/empty', { method: 'GET' })).resolves.toBeUndefined()
    await expect(call('/text', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'answered without JSON' })
  })

  it('does not throw when it is made with a base URL that is not one: the call fails, nothing is sent', async () => {
    seen.length = 0
    for (const bad of ['', 'not a url', undefined as unknown as string]) {
      const call = client.createBrowserClient({ baseUrl: bad })
      await expect(call('/things', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', status: 0, message: 'has no valid base URL' })
    }
    expect(seen).toEqual([])
  })

  it('valueOrThrow gives the value of an ok answer and throws the message of an error', () => {
    expect(client.valueOrThrow({ ok: true, value: 3 })).toBe(3)
    expect(() => client.valueOrThrow({ ok: false, error: { message: 'The "weather" API answered 503.' } })).toThrow('The "weather" API answered 503.')
  })
})
