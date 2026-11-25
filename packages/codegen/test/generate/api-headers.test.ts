import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { project } from '../edit/helpers'

/**
 * api-calls R2 (S4): the headers of a call reach the API. The HTTP repository sends the fixed ones and the header parameters (a text one
 * checked to be one line), and the server client puts the source's own headers over them: a call can't replace the sign-in.
 */
const shop = () => {
  const p = project()
  p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1', auth: { type: 'bearer' } })
  p.edit('api_model_set', { datasource: 'ds_shop_api', model: { name: 'Product', fields: [{ name: 'id', type: 'integer' }] } })
  p.edit('api_query_set', {
    datasource: 'ds_shop_api',
    query: {
      name: 'products',
      path: '/products',
      headers: [{ name: 'X-Api-Version', value: '2' }],
      params: [{ name: 'locale', in: 'header', type: 'text', key: 'Accept-Language' }, { name: 'page', in: 'header', type: 'integer', key: 'X-Page', required: true }],
      result: { model: 'Product', many: true }
    }
  })
  const loaded = loadModel(p.files)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return generate(loaded.model)
}

describe('the generated code of a call with headers', () => {
  const files = shop()
  const content = (path: string) => files.find(file => file.path === path)?.content ?? ''

  it('sends the fixed headers and the header parameters, a text one through headerValue', () => {
    const repository = content('layers/apis/shared/data/shop-api/repositories/shop-api-repository.http.ts')
    expect(repository).toContain('    const localeHeader = headerValue(input.locale)\n    if (!localeHeader.ok) return localeHeader\n')
    expect(repository).toContain('headers: { \'X-Api-Version\': \'2\', \'Accept-Language\': localeHeader.value, \'X-Page\': input.page }')
    expect(repository).toContain('const headerValue = (value: string | undefined): KernelResult<string | undefined, ShopApiError> =>')
    expect(content('layers/apis/shared/data/shop-api/client.ts')).toContain('  headers?: Record<string, string | number | boolean | undefined>')
  })

  it('takes an optional header parameter as optional input, and a required one as required', () => {
    expect(content('layers/apis/shared/domain/shop-api/use-cases/products.ts')).toContain('  locale: z.string().optional(),\n  page: z.number().int()\n')
  })

  it('tests the request with its headers, and that a line break in a header parameter is refused', () => {
    const test = content('layers/apis/test/shop-api/shop-api-repository.http.test.ts')
    expect(test).toContain('\'X-Api-Version\': \'2\'')
    expect(test).toContain('products: refuses a header parameter with a line break, without calling the API')
  })
})

type Client = (options: { baseUrl: string, headers: Record<string, string> }) => (path: string, request: { method: 'GET' | 'POST', headers?: Record<string, string | number | undefined>, body?: unknown }) => Promise<unknown>

describe('the generated server client sends the call\'s headers under the source\'s', () => {
  const seen: IncomingHttpHeaders[] = []
  const server = createServer((request, response) => {
    seen.push(request.headers)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })
  let baseUrl = ''
  let createHttpClient: Client
  const dir = mkdtempSync(join(tmpdir(), 'bildr-http-headers-'))
  beforeAll(async () => {
    // The core HTTP client every source calls through (codegen-architecture T3a).
    const source = shop().find(file => file.path === 'layers/core/shared/http/client.ts')!.content
    writeFileSync(join(dir, 'client.mjs'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
    createHttpClient = ((await import(pathToFileURL(join(dir, 'client.mjs')).href)) as { createHttpClient: Client }).createHttpClient
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('sends them, leaving out the undefined ones', async () => {
    seen.length = 0
    await createHttpClient({ baseUrl, headers: { accept: 'application/json', authorization: 'Bearer secret' } })('/p', { method: 'GET', headers: { 'X-Api-Version': '2', 'X-Page': 3, 'X-Locale': undefined } })
    expect(seen[0]).toMatchObject({ 'x-api-version': '2', 'x-page': '3', 'accept': 'application/json', 'authorization': 'Bearer secret' })
    expect(seen[0]).not.toHaveProperty('x-locale')
  })

  it('never lets a call replace the sign-in, whatever its case, but lets it ask for another accept', async () => {
    seen.length = 0
    await createHttpClient({ baseUrl, headers: { accept: 'application/json', authorization: 'Bearer secret' } })('/p', { method: 'POST', body: {}, headers: { 'Authorization': 'Bearer mine', 'Accept': 'application/vnd.api+json', 'Content-Type': 'text/plain' } })
    expect(seen[0]).toMatchObject({ 'authorization': 'Bearer secret', 'accept': 'application/vnd.api+json', 'content-type': 'application/json' })
  })

  it('refuses a header value it can\'t send, without calling the API', async () => {
    seen.length = 0
    await expect(createHttpClient({ baseUrl })('/p', { method: 'GET', headers: { 'X-Note': 'a\r\nX-Evil: 1' } })).rejects.toMatchObject({ name: 'HttpFailure', status: 0, message: 'was given a header it can\'t send' })
    expect(seen).toEqual([])
  })
})
