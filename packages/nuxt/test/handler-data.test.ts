// P3c (V2, V5, V6, V7): the data actions over HTTP: entities and data sources write .bildr/ files (undoable),
// datasource_preview and repository_endpoint_test fetch only under a data source's base URL, env_status never shows values.
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { fetchJson } from '../src/node/remote'
import { regenerate } from '../src/node/regenerate'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const SECRET = 'sk-test-secret-1234'
let root: string
let dir: string
let handle: ReturnType<typeof createBildrHandler>
let server: Server
let base: string
let lastAuthorization: string | undefined

beforeAll(async () => {
  server = createServer((request, response) => {
    lastAuthorization = request.headers.authorization
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    const url = new URL(request.url!, 'http://stub')
    if (url.pathname === '/v1/tasks') return json(200, { items: [{ id: 't1', title: 'Write docs', done: false, owner_name: 'Ada' }], total: 1, query: Object.fromEntries(url.searchParams), echo: request.headers.authorization })
    if (url.pathname === '/v1/tasks/t1') return json(200, { id: 't1', title: 'Write docs', done: false, owner_name: 'Ada' })
    if (url.pathname === '/v1/away') {
      response.writeHead(302, { location: 'http://example.invalid/steal' })
      return response.end()
    }
    if (url.pathname === '/v1/around') {
      response.writeHead(302, { location: '/v1/tasks' })
      return response.end()
    }
    if (url.pathname === '/v1/big') return json(200, { items: [{ blob: 'x'.repeat(1_100_000) }] })
    if (url.pathname === '/v1/slow') return undefined
    if (url.pathname === '/v1/text') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      return response.end('hello')
    }
    return json(404, { error: 'not found' })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-data-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App', database: 'none' })
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const act = (name: string, body: unknown = {}) => handle(new Request(`http://localhost:3000/__bildr/api/actions/${name}`, {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000', 'x-bildr-token': TOKEN, 'content-type': 'application/json' }
}), { remoteAddress: '127.0.0.1' })
const ok = async (name: string, body: unknown = {}): Promise<Json> => {
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, result?: Json }
  expect(json.ok, `${name}: ${JSON.stringify(json)}`).toBe(true)
  return json.result!
}
const failure = async (name: string, body: unknown, status: number, code: string) => {
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, code: string, message: string }
  expect(response.status, JSON.stringify(json)).toBe(status)
  expect(json.code).toBe(code)
  return json
}
const json = (path: string) => JSON.parse(readFileSync(join(dir, path), 'utf8')) as Json

const stubSource = async () => {
  await ok('datasource_create', { name: 'stub', kind: 'rest', defaults: { baseUrl: base }, auth: { type: 'bearer' } })
  writeFileSync(join(dir, '.env'), `# local\nNUXT_DATASOURCES_STUB_API_KEY="${SECRET}"\n`)
}

describe('entity and data source actions', () => {
  it('write the model files, as one undoable step each, and the app regenerates with a memory entity', async () => {
    await ok('datasource_create', { name: 'local', kind: 'memory' })
    const made = await ok('entity_create', { name: 'note', source: 'ds_local', fields: [{ name: 'text', type: 'text', required: true }] })
    expect(made.changed).toContain('.bildr/modules/main/fixtures/note.json')
    expect(json('.bildr/modules/main/repositories/note.json').datasource).toBe('ds_local')
    const history = await ok('history_get')
    expect(history.undo.map((step: Json) => step.action)).toEqual(['entity_create', 'datasource_create'])
    const result = await regenerate(dir)
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(readFileSync(join(dir, 'layers/main/server/utils/main.ts'), 'utf8')).toContain('const notes = memoryNoteRepository(noteSeed)')
    await ok('history_undo')
    expect(existsSync(join(dir, '.bildr/modules/main/entities/note.json'))).toBe(false)
    expect(existsSync(join(dir, '.bildr/datasources/local.json'))).toBe(true)
  })
})

describe('datasource_preview', () => {
  it('GETs a path under the base URL with the env\'s auth and proposes fields, never echoing the secret', async () => {
    await stubSource()
    const preview = await ok('datasource_preview', { datasource: 'ds_stub', path: '/tasks' })
    expect(lastAuthorization).toBe(`Bearer ${SECRET}`)
    expect(preview).toMatchObject({
      status: 200,
      itemsPath: 'items',
      count: 1,
      fields: [{ name: 'id', type: 'text', remote: 'id' }, { name: 'title', type: 'text', remote: 'title' }, { name: 'done', type: 'boolean', remote: 'done' }, { name: 'ownerName', type: 'text', remote: 'owner_name' }],
      items: [{ id: 't1', title: 'Write docs', done: false, owner_name: 'Ada' }]
    })
    expect(JSON.stringify(preview)).not.toContain(SECRET)
    expect(preview.sample.echo).toBe('Bearer •••')
  })

  it('redacts a secret holding a quote or a backslash (JSON escapes it)', async () => {
    await ok('datasource_create', { name: 'stub', kind: 'rest', defaults: { baseUrl: base }, auth: { type: 'bearer' } })
    writeFileSync(join(dir, '.env'), 'NUXT_DATASOURCES_STUB_API_KEY=\'sk-"quo\\te-1234\'\n')
    const preview = await ok('datasource_preview', { datasource: 'ds_stub', path: '/tasks' })
    expect(lastAuthorization).toBe('Bearer sk-"quo\\te-1234')
    expect(preview.sample.echo).toBe('Bearer •••')
    expect(JSON.stringify(preview)).not.toContain('quo')
  })

  it('refuses paths outside the base URL, redirects elsewhere, big or non-JSON answers', async () => {
    await stubSource()
    expect((await failure('datasource_preview', { datasource: 'ds_stub', path: 'http://example.invalid/x' }, 400, 'invalid_input')).message).toBe('Use a path relative to the data source\'s base URL, like "/posts"')
    expect((await failure('datasource_preview', { datasource: 'ds_stub', path: '/../admin' }, 400, 'invalid_input')).message).toBe('The path can\'t leave the data source\'s base URL')
    expect((await failure('datasource_preview', { datasource: 'ds_stub', path: '/away' }, 502, 'upstream')).message).toBe('The data source redirected to http://example.invalid, outside its base URL: not followed')
    expect((await ok('datasource_preview', { datasource: 'ds_stub', path: '/around' })).itemsPath).toBe('items')
    expect((await failure('datasource_preview', { datasource: 'ds_stub', path: '/big' }, 502, 'upstream')).message).toBe('The data source answered more than 1 MB: not read')
    expect((await failure('datasource_preview', { datasource: 'ds_stub', path: '/text' }, 502, 'upstream')).message).toBe('The data source answered 200 without JSON')
    await failure('datasource_preview', { datasource: 'ds_nope', path: '/tasks' }, 404, 'not_found')
  })

  it('gives up after the timeout', async () => {
    await expect(fetchJson(`${base}/slow`, { baseUrl: base, headers: {}, timeoutMs: 200 })).rejects.toThrow('The data source didn\'t answer within 0.2 s')
  })
})

describe('repository_endpoint_test', () => {
  it('sends the list (with paging) and get endpoints of a REST repository, and says which fields the items have', async () => {
    await stubSource()
    await ok('entity_create', {
      name: 'task', source: 'ds_stub',
      fields: [{ name: 'id', type: 'text' }, { name: 'title', type: 'text' }, { name: 'owner', type: 'text', remote: 'owner' }],
      endpoints: { list: { path: '/tasks', itemsPath: 'items', totalPath: 'total' }, get: { path: '/tasks/:id' }, create: { path: '/tasks' } }
    })
    const list = await ok('repository_endpoint_test', { repository: 'repo_task', op: 'list' })
    expect(list).toMatchObject({ status: 200, method: 'GET', path: '/tasks', itemsPath: 'items', count: 1 })
    expect(list.sample.query).toEqual({ limit: '10', offset: '0' })
    expect(list.mapping).toEqual([{ field: 'id', remote: 'id', found: true }, { field: 'title', remote: 'title', found: true }, { field: 'owner', remote: 'owner', found: false }])
    const got = await ok('repository_endpoint_test', { repository: 'repo_task', op: 'get', id: 't1' })
    expect(got).toMatchObject({ status: 200, path: '/tasks/t1', item: { id: 't1', title: 'Write docs' } })
    expect((await failure('repository_endpoint_test', { repository: 'repo_task', op: 'create' }, 403, 'forbidden')).message).toBe('repository_endpoint_test only sends GET: a POST to the API could change its data')
    expect((await failure('repository_endpoint_test', { repository: 'repo_task', op: 'delete' }, 400, 'invalid_input')).message).toBe('repo_task has no delete operation')
    expect((await failure('repository_endpoint_test', { repository: 'repo_task', op: 'get' }, 400, 'invalid_input')).message).toBe('Give the id of a row to get')
  })
})

describe('env_status', () => {
  it('lists the env vars data sources read and whether each is set, never the values', async () => {
    await stubSource()
    const status = await ok('env_status')
    expect(status.variables).toEqual([
      { name: 'NUXT_DATASOURCES_STUB_BASE_URL', datasource: 'ds_stub', setting: 'baseUrl', secret: false, set: false, from: null, hasDefault: true },
      { name: 'NUXT_DATASOURCES_STUB_API_KEY', datasource: 'ds_stub', setting: 'apiKey', secret: true, set: true, from: '.env', hasDefault: false }
    ])
    expect(JSON.stringify(status)).not.toContain(SECRET)
    expect(status.changed).toBeUndefined()
  })
})
