import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
 * codegen-architecture T3a: the generated `useRemote` (core/server/utils/remote.ts), the client of the REST data sources, over the
 * core HTTP client. Run for real against a local server, with `nuxt/server` stubbed: the runtime config it reads, and an h3-like
 * `createError` that keeps the status and message it was given.
 */
type Remote = <T>(path: string, options?: { method?: string, query?: Record<string, string | number | boolean | undefined>, body?: unknown, optional?: boolean }) => Promise<T>
const CONFIG = '__bildrRemoteConfig'
const NUXT_STUB = [
  `export const useRuntimeConfig = () => globalThis.${CONFIG}`,
  'export const createError = ({ status, message }) => Object.assign(new Error(message), { status })'
].join('\n')

describe('generated useRemote (REST data sources)', () => {
  const seen: Array<{ url?: string, headers: Record<string, string | string[] | undefined> }> = []
  const elsewhere: string[] = []
  const other = createServer((request, response) => {
    elsewhere.push(request.url!)
    response.end('{}')
  })
  const server = createServer((request, response) => {
    seen.push({ url: request.url, headers: request.headers })
    const path = decodeURIComponent(new URL(request.url!, 'http://stub').pathname)
    if (path === '/v1/missing') {
      response.writeHead(404)
      return response.end()
    }
    if (path === '/v1/moved') {
      response.writeHead(302, { location: `http://127.0.0.1:${(other.address() as AddressInfo).port}/v1/quotes` })
      return response.end()
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ path }))
  })
  const dir = mkdtempSync(join(tmpdir(), 'bildr-remote-'))
  let useRemote: (name: string) => Remote

  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const files = new Map(generate(loaded.model).map(file => [file.path, file.content]))
    const js = (path: string) => ts.transpileModule(files.get(path)!, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    mkdirSync(join(dir, 'stubs'))
    writeFileSync(join(dir, 'stubs/nuxt-server.mjs'), NUXT_STUB)
    writeFileSync(join(dir, 'client.mjs'), js('layers/core/shared/http/client.ts'))
    writeFileSync(join(dir, 'remote.mjs'), js('layers/core/server/utils/remote.ts')
      .replace('\'nuxt/server\'', `'${pathToFileURL(join(dir, 'stubs/nuxt-server.mjs')).href}'`)
      .replace('\'#core/http/client\'', `'${pathToFileURL(join(dir, 'client.mjs')).href}'`))
    useRemote = ((await import(pathToFileURL(join(dir, 'remote.mjs')).href)) as { useRemote: typeof useRemote }).useRemote
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    ;(globalThis as Record<string, unknown>)[CONFIG] = {
      datasources: { quotes: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: 'secret' } }
    }
  })
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    Reflect.deleteProperty(globalThis, CONFIG)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await new Promise<void>(resolve => other.close(() => resolve()))
  })

  it('calls the path with the query and the source\'s bearer key, and answers the JSON', async () => {
    seen.length = 0
    await expect(useRemote('quotes')('/quotes', { query: { limit: 3, skip: 0, active: true, tag: undefined } })).resolves.toEqual({ path: '/v1/quotes' })
    expect(seen[0]!.url).toBe('/v1/quotes?limit=3&skip=0&active=true')
    expect(seen[0]!.headers).toMatchObject({ accept: 'application/json', authorization: 'Bearer secret' })
  })

  // Verify T3a advisory: a hand-written REST path may hold its own query string, or characters the URL encodes; the old client sent them.
  it.each([
    ['/posts?userId=1', '/v1/posts?userId=1'],
    ['/artículos', '/v1/art%C3%ADculos'],
    ['/a b', '/v1/a%20b']
  ])('calls a path %j as it is written', async (path, url) => {
    seen.length = 0
    await useRemote('quotes')(path)
    expect(seen.map(entry => entry.url)).toEqual([url])
  })

  it('answers undefined for an optional 404, and a 502 naming the source for any other failure', async () => {
    await expect(useRemote('quotes')('/missing', { optional: true })).resolves.toBeUndefined()
    await expect(useRemote('quotes')('/missing')).rejects.toMatchObject({ status: 502, message: 'Data source "quotes" answered 404.' })
  })

  it('does not follow a redirect: the key never reaches another host', async () => {
    elsewhere.length = 0
    await expect(useRemote('quotes')('/moved', { optional: true })).rejects.toMatchObject({ status: 502, message: 'Data source "quotes" answered 302: a redirect is not followed.' })
    expect(elsewhere).toEqual([])
  })

  it('still refuses a path that leaves the base URL', async () => {
    seen.length = 0
    await expect(useRemote('quotes')('/a/../../other')).rejects.toMatchObject({ status: 502 })
    await expect(useRemote('quotes')('/a\\..\\..\\other')).rejects.toMatchObject({ status: 502 })
    expect(seen).toEqual([])
  })
})
