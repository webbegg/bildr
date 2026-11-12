import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createMcpServer } from '../../server/mcp/server'
import { createApiFetcher } from '../../server/utils/apiFetch'
import type { PublicWriteResult } from '../../server/utils/publicData'
import type { Resolver, Transport } from '../../server/utils/urlGuard'
import type { DataRecord } from '#shared/data/records'
import type { Collection, Connection, Project } from '#shared/document/schema'
import { visitorSnapshot } from '#shared/runtime/visitor'
import { memoryStorage } from '../helpers'

const SECRET = 'sk_live_CONN_SECRET42'
const mcp = { caller: 'mcp' as const, source: 'mcp' }
const visitor = { caller: 'public' as const, source: 'public' }
const leaks = (value: unknown) => JSON.stringify(value ?? null).toLowerCase().includes(SECRET.toLowerCase())

const ENDPOINTS = {
  list: { method: 'GET', path: '/posts', itemsPath: 'data' },
  get: { method: 'GET', path: '/posts/{id}', itemPath: 'data' },
  create: { method: 'POST', path: '/posts', itemPath: 'data' },
  update: { method: 'PATCH', path: '/posts/{id}', itemPath: 'data' },
  delete: { method: 'DELETE', path: '/posts/{id}' }
}
const FIELDS = [
  { key: 'title', type: 'text' },
  { key: 'author', type: 'text', path: 'author.name' },
  { key: 'userId', type: 'number' }
]
const POSTS = [
  { id: 1, title: 'First', author: { name: 'Ana' }, userId: 1 },
  { id: 2, title: 'Second', author: { name: 'Bo' }, userId: 2 }
]

const resolve: Resolver = async (host) => {
  if (host === 'blocked.example.com') return [{ address: '10.0.0.1', family: 4 }]
  if (host.endsWith('.example.com') || host === 'evil.com') return [{ address: '93.184.216.34', family: 4 }]
  throw new Error(`getaddrinfo ENOTFOUND ${host}`)
}

interface Call { method: string, url: string, headers?: Record<string, string>, body?: unknown }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function setup() {
  const calls: Call[] = []
  const transport: Transport = async (url, init) => {
    const method = init.method ?? 'GET'
    const body = init.body === undefined ? undefined : JSON.parse(init.body) as Record<string, unknown>
    calls.push({ method, url: url.href, headers: init.headers, body })
    if (url.hostname === 'down.example.com') throw new Error(`connect ECONNREFUSED ${url.href} (${init.headers?.['x-key']})`)
    const route = `${method} ${url.pathname}`
    if (route === 'GET /v1/posts') return json({ data: POSTS })
    if (route === 'GET /v1/posts/1') return json({ data: POSTS[0] })
    if (route === 'POST /v1/posts') return json({ data: { ...body, id: 101 } }, 201)
    if (route === 'PATCH /v1/posts/1') return json({ data: { ...POSTS[0], ...body } })
    if (route === 'PUT /v1/posts/1') return json({ data: { ...body, id: 1 } })
    if (route === 'DELETE /v1/posts/1') return new Response(null, { status: 204 })
    return json({ error: 'nope' }, 404)
  }
  const storage = memoryStorage()
  const bildr = createBildr(storage, ACTIONS, { api: createApiFetcher({ transport, resolve }) })
  const events: ChangeEvent[] = []
  bildr.onChange(e => events.push(e))
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Remote' }, mcp)
  await bildr.call('env_set', { projectId, name: 'K', value: SECRET, secret: true }, mcp)
  const { connection } = await bildr.call<{ connection: Connection }>('connection_create', {
    projectId, name: 'Blog API', baseUrl: 'https://api.example.com/v1', headers: [{ name: 'X-Key', value: '{{ env.K }}' }]
  }, mcp)
  const { collection } = await bildr.call<{ collection: Collection }>('collection_create', {
    projectId, name: 'Posts', source: { type: 'connection', connectionId: connection.id, endpoints: ENDPOINTS }, fields: FIELDS
  }, mcp)
  const posts = (endpoints: object, name = 'Other') => bildr.call<{ collection: Collection }>('collection_create', {
    projectId, name, source: { type: 'connection', connectionId: connection.id, endpoints }, fields: FIELDS
  }, mcp)
  return { bildr, storage, events, projectId, connection, collection, calls, posts }
}

type Setup = Awaited<ReturnType<typeof setup>>
const list = ({ bildr, projectId }: Setup, collection = 'posts') => bildr.call<{ total: number, records: DataRecord[] }>('record_list', { projectId, collection }, mcp)

async function mcpClient(bildr: ReturnType<typeof createBildr>) {
  const client = new Client({ name: 'remote-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createMcpServer(bildr).connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

describe('connection actions', () => {
  it('creates, updates and undoes connections in the document', async () => {
    const { bildr, projectId, connection } = await setup()
    expect(connection).toMatchObject({ name: 'Blog API', baseUrl: 'https://api.example.com/v1', headers: [{ name: 'X-Key', value: '{{ env.K }}' }] })
    const { connection: updated } = await bildr.call<{ connection: Connection }>('connection_update', { projectId, connectionId: connection.id, name: 'Blog' }, mcp)
    expect(updated).toEqual({ ...connection, name: 'Blog' })
    await bildr.call('history_undo', { projectId }, mcp)
    expect((await bildr.call<Project>('project_get', { projectId }, mcp)).connections).toEqual([connection])
    await expect(bildr.call('connection_create', { projectId, name: 'Bad', baseUrl: '/relative' }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('refuses deleting a connection in use; force deletes its collections too, in one undo step', async () => {
    const { bildr, projectId, connection } = await setup()
    await expect(bildr.call('connection_delete', { projectId, connectionId: connection.id }, mcp))
      .rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('"Blog API" is used by Posts') })
    const before = await bildr.call<Project>('project_get', { projectId }, mcp)
    const deleted = await bildr.call<{ deletedCollections: string[] }>('connection_delete', { projectId, connectionId: connection.id, force: true }, mcp)
    expect(deleted.deletedCollections).toEqual([before.collections[0]!.id])
    const after = await bildr.call<Project>('project_get', { projectId }, mcp)
    expect([after.connections, after.collections]).toEqual([[], []])
    await bildr.call('history_undo', { projectId }, mcp)
    const restored = await bildr.call<Project>('project_get', { projectId }, mcp)
    expect([restored.connections, restored.collections]).toEqual([before.connections, before.collections])
  })
})

describe('record actions on a connection collection', () => {
  it('lists through the list endpoint, with the resolved headers, cached', async () => {
    const ctx = await setup()
    const result = await list(ctx)
    expect(result.records.map(r => [r.id, r.values])).toEqual([
      ['1', { title: 'First', author: 'Ana', userId: 1 }],
      ['2', { title: 'Second', author: 'Bo', userId: 2 }]
    ])
    expect(ctx.calls).toEqual([{ method: 'GET', url: 'https://api.example.com/v1/posts', headers: { 'accept': 'application/json', 'user-agent': 'bildr', 'x-key': SECRET }, body: undefined }])
    await list(ctx)
    expect(ctx.calls).toHaveLength(1)
  })

  it('gets through the get endpoint, or the list filtered by id', async () => {
    const ctx = await setup()
    const record = await ctx.bildr.call<DataRecord>('record_get', { projectId: ctx.projectId, collection: 'posts', recordId: '1' }, mcp)
    expect([record.id, record.values]).toEqual(['1', { title: 'First', author: 'Ana', userId: 1 }])
    expect(ctx.calls.map(c => `${c.method} ${c.url}`)).toEqual(['GET https://api.example.com/v1/posts/1'])
    await ctx.posts({ list: ENDPOINTS.list }, 'List only')
    const second = await ctx.bildr.call<DataRecord>('record_get', { projectId: ctx.projectId, collection: 'list-only', recordId: '2' }, mcp)
    expect(second.values).toEqual({ title: 'Second', author: 'Bo', userId: 2 })
    await expect(ctx.bildr.call('record_get', { projectId: ctx.projectId, collection: 'list-only', recordId: '9' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reads the record id at idPath', async () => {
    const ctx = await setup()
    const { collection } = await ctx.posts({ list: ENDPOINTS.list }, 'By user')
    await ctx.bildr.call('collection_update', { projectId: ctx.projectId, collection: collection.id, source: { ...collection.source, idPath: 'userId' } }, mcp)
    expect((await list(ctx, 'by-user')).records.map(r => r.id)).toEqual(['1', '2'])
    expect((await ctx.bildr.call<DataRecord>('record_get', { projectId: ctx.projectId, collection: 'by-user', recordId: '2' }, mcp)).values.title).toBe('Second')
  })

  it('creates with a POST of the mapped fields, then refreshes the list', async () => {
    const ctx = await setup()
    await list(ctx)
    const created = await ctx.bildr.call<DataRecord>('record_create', { projectId: ctx.projectId, collection: 'posts', values: { title: 'New', author: 'Cy', userId: '3' } }, mcp)
    expect([created.id, created.values]).toEqual(['101', { title: 'New', author: 'Cy', userId: 3 }])
    expect(ctx.calls.at(-1)).toMatchObject({ method: 'POST', url: 'https://api.example.com/v1/posts', body: { title: 'New', author: { name: 'Cy' }, userId: 3 } })
    expect(ctx.calls.at(-1)!.headers).toMatchObject({ 'content-type': 'application/json', 'x-key': SECRET })
    expect(ctx.events.at(-1)).toMatchObject({ action: 'record_create', scope: 'data', collectionId: ctx.collection.id })
    await list(ctx)
    expect(ctx.calls.map(c => c.method)).toEqual(['GET', 'POST', 'GET'])
  })

  it('updates with a PATCH of the given values, or a PUT of the whole record', async () => {
    const ctx = await setup()
    const updated = await ctx.bildr.call<DataRecord>('record_update', { projectId: ctx.projectId, collection: 'posts', recordId: '1', values: { title: 'Renamed' } }, mcp)
    expect(updated.values).toEqual({ title: 'Renamed', author: 'Ana', userId: 1 })
    expect(ctx.calls.at(-1)).toMatchObject({ method: 'PATCH', url: 'https://api.example.com/v1/posts/1', body: { title: 'Renamed' } })
    await ctx.posts({ ...ENDPOINTS, update: { method: 'PUT', path: '/posts/{id}', itemPath: 'data' } }, 'Put')
    ctx.calls.length = 0
    await ctx.bildr.call('record_update', { projectId: ctx.projectId, collection: 'put', recordId: '1', values: { title: 'Whole' } }, mcp)
    expect(ctx.calls.map(c => `${c.method} ${c.url}`)).toEqual(['GET https://api.example.com/v1/posts/1', 'PUT https://api.example.com/v1/posts/1'])
    expect(ctx.calls[1]!.body).toEqual({ title: 'Whole', author: { name: 'Ana' }, userId: 1 })
  })

  it('deletes with a DELETE and refreshes the list and the record', async () => {
    const ctx = await setup()
    await list(ctx)
    await ctx.bildr.call('record_get', { projectId: ctx.projectId, collection: 'posts', recordId: '1' }, mcp)
    expect(await ctx.bildr.call('record_delete', { projectId: ctx.projectId, collection: 'posts', recordId: '1' }, mcp)).toEqual({ recordId: '1' })
    await list(ctx)
    await ctx.bildr.call('record_get', { projectId: ctx.projectId, collection: 'posts', recordId: '1' }, mcp)
    expect(ctx.calls.map(c => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /v1/posts', 'GET /v1/posts/1', 'DELETE /v1/posts/1', 'GET /v1/posts', 'GET /v1/posts/1'])
  })

  it('never caches writes', async () => {
    const ctx = await setup()
    for (let i = 0; i < 2; i++) await ctx.bildr.call('record_create', { projectId: ctx.projectId, collection: 'posts', values: { title: 'Same' } }, mcp)
    expect(ctx.calls.filter(c => c.method === 'POST')).toHaveLength(2)
  })

  it('names the missing endpoint and sends nothing', async () => {
    const ctx = await setup()
    await ctx.posts({ list: ENDPOINTS.list }, 'Read only')
    const call = (name: string, input: object) => ctx.bildr.call(name, { projectId: ctx.projectId, collection: 'read-only', ...input }, mcp)
    await expect(call('record_update', { recordId: '1', values: {} })).rejects.toMatchObject({ code: 'invalid', message: 'This collection has no Update endpoint' })
    await expect(call('record_create', { values: {} })).rejects.toMatchObject({ code: 'invalid', message: 'This collection has no Create endpoint' })
    await expect(call('record_delete', { recordId: '1' })).rejects.toMatchObject({ code: 'invalid', message: 'This collection has no Delete endpoint' })
    await ctx.posts({}, 'Nothing')
    await expect(ctx.bildr.call('record_list', { projectId: ctx.projectId, collection: 'nothing' }, mcp)).rejects.toMatchObject({ message: 'This collection has no List endpoint' })
    await expect(ctx.bildr.call('record_get', { projectId: ctx.projectId, collection: 'nothing', recordId: '1' }, mcp)).rejects.toMatchObject({ message: 'This collection has no Get endpoint' })
    expect(ctx.calls).toHaveLength(0)
  })

  it('keeps refusing writes to api sources', async () => {
    const ctx = await setup()
    await ctx.bildr.call('collection_create', { projectId: ctx.projectId, name: 'Feed', source: { type: 'api', url: 'https://api.example.com/v1/posts', itemsPath: 'data' } }, mcp)
    await expect(ctx.bildr.call('record_create', { projectId: ctx.projectId, collection: 'feed', values: {} }, mcp)).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('origin lock and SSRF', () => {
  it('refuses stored paths that are not relative', async () => {
    const ctx = await setup()
    for (const path of ['//evil.com/x', 'https://evil.com', '/../x', '/posts/%2E%2E/x', '\\\\evil.com']) {
      await expect(ctx.posts({ list: { method: 'GET', path } }, 'Evil'), path).rejects.toMatchObject({ code: 'invalid_input' })
    }
  })

  it('refuses paths whose env refs resolve outside the base URL, sending nothing', async () => {
    const ctx = await setup()
    await ctx.posts({ list: { method: 'GET', path: '/{{ env.P }}' }, get: { method: 'GET', path: '{{ env.P }}' } }, 'Evil')
    for (const value of ['https://evil.com/x', '/evil.com/x', '//evil.com/x', '../x', 'a/../../x', 'a\\b', `https://${SECRET}.evil.com`]) {
      await ctx.bildr.call('env_set', { projectId: ctx.projectId, name: 'P', value, secret: true }, mcp)
      const error = await list(ctx, 'evil').then(() => undefined, (e: Error) => e)
      expect(error, value).toMatchObject({ code: 'invalid' })
      expect(leaks(error!.message)).toBe(false)
    }
    await ctx.bildr.call('env_set', { projectId: ctx.projectId, name: 'P', value: 'https://evil.com/x' }, mcp)
    await expect(ctx.bildr.call('record_get', { projectId: ctx.projectId, collection: 'evil', recordId: '1' }, mcp)).rejects.toMatchObject({ code: 'invalid' })
    expect(ctx.calls).toHaveLength(0)
  })

  it('runs the URL and SSRF checks on the resolved base URL', async () => {
    const ctx = await setup()
    await ctx.bildr.call('connection_update', { projectId: ctx.projectId, connectionId: ctx.connection.id, baseUrl: '{{ env.BASE }}' }, mcp)
    for (const value of ['file:///etc', 'http://127.0.0.1', 'https://blocked.example.com/v1', 'http://169.254.169.254/latest', 'relative/path']) {
      await ctx.bildr.call('env_set', { projectId: ctx.projectId, name: 'BASE', value }, mcp)
      await expect(list(ctx), value).rejects.toMatchObject({ code: 'invalid' })
      await expect(ctx.bildr.call('record_create', { projectId: ctx.projectId, collection: 'posts', values: {} }, mcp), value).rejects.toMatchObject({ code: 'invalid' })
    }
    expect(ctx.calls).toHaveLength(0)
  })

  it('refuses a record id that would change the path', async () => {
    const ctx = await setup()
    await expect(ctx.bildr.call('record_delete', { projectId: ctx.projectId, collection: 'posts', recordId: '..' }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
    await ctx.bildr.call('record_get', { projectId: ctx.projectId, collection: 'posts', recordId: 'a-b_c' }, mcp).catch(() => {})
    expect(ctx.calls.map(c => c.url)).toEqual(['https://api.example.com/v1/posts/a-b_c'])
  })
})

describe('endpoint_test', () => {
  it('runs a GET and proposes a mapping, without history or events', async () => {
    const ctx = await setup()
    const history = await ctx.bildr.call('history_get', { projectId: ctx.projectId }, mcp)
    const events = ctx.events.length
    const result = await ctx.bildr.call<{ status: number, itemsPath: string, fields: { key: string, path: string }[], sample: { id: string }[], items: unknown[] }>('endpoint_test', {
      projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '/posts'
    }, mcp)
    expect(result.status).toBe(200)
    expect(result.itemsPath).toBe('data')
    expect(result.fields.map(f => [f.key, f.path])).toEqual([['externalId', 'id'], ['title', 'title'], ['authorName', 'author.name'], ['userId', 'userId']])
    expect(result.items).toEqual(POSTS)
    expect(result.sample.map(r => r.id)).toEqual(['1', '2'])
    const one = await ctx.bildr.call<{ item: unknown, fields: unknown[] }>('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '/posts/{id}', id: '1', itemPath: 'data' }, mcp)
    expect(one.item).toEqual(POSTS[0])
    expect(await ctx.bildr.call('history_get', { projectId: ctx.projectId }, mcp)).toEqual(history)
    expect(ctx.events).toHaveLength(events)
  })

  it('refuses other methods without confirm, sending nothing', async () => {
    const ctx = await setup()
    const input = { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'POST', path: '/posts' }
    await expect(ctx.bildr.call('endpoint_test', input, mcp)).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('confirm') })
    expect(ctx.calls).toHaveLength(0)
    expect(await ctx.bildr.call('endpoint_test', { ...input, confirm: true }, mcp)).toMatchObject({ status: 201 })
    expect(ctx.calls.map(c => c.method)).toEqual(['POST'])
  })

  it('refuses paths that leave the origin', async () => {
    const ctx = await setup()
    await expect(ctx.bildr.call('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '//evil.com/x' }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(ctx.calls).toHaveLength(0)
  })
})

describe('published apps', () => {
  async function published(patch: object = { publicCreate: true, publicRead: true }) {
    const ctx = await setup()
    await ctx.bildr.call('collection_update', { projectId: ctx.projectId, collection: 'posts', ...patch }, mcp)
    await ctx.bildr.call('project_publish', { projectId: ctx.projectId }, mcp)
    const submit = (body: unknown, collection = 'posts') => ctx.bildr.call<PublicWriteResult>('public_record_create', { projectId: ctx.projectId, collection, body }, visitor)
    return { ...ctx, submit }
  }

  it('reads through the PUBLISHED connection', async () => {
    const ctx = await published()
    await ctx.bildr.call('connection_update', { projectId: ctx.projectId, connectionId: ctx.connection.id, baseUrl: 'https://other.example.com' }, mcp)
    const snapshot = (await ctx.bildr.services.getPublished('remote'))!
    const posts = snapshot.project.collections[0]!
    const records = await ctx.bildr.services.collectionRecords(ctx.projectId, posts, snapshot.project.connections)
    expect(records).toHaveLength(2)
    expect(ctx.calls.map(c => c.url)).toEqual(['https://api.example.com/v1/posts'])
  })

  it('creates through the create endpoint only with publicCreate, keeping declared fields', async () => {
    const closed = await published({ publicRead: true })
    expect(await closed.submit({ values: { title: 'Hi' } })).toEqual({ ok: false, status: 404, message: 'Collection not found' })
    const ctx = await published()
    const result = await ctx.submit({ values: { title: 'Hi', userId: '4', extra: 'dropped' } })
    expect(result).toMatchObject({ ok: true, record: { id: '101', values: { title: 'Hi', userId: 4 } } })
    expect(ctx.calls.map(c => [c.method, c.body])).toEqual([['POST', { title: 'Hi', userId: 4 }]])
    expect(ctx.events.at(-1)).toMatchObject({ action: 'public_record_create', scope: 'data', collectionId: ctx.collection.id })
    expect(await ctx.submit({ values: { userId: 'many' } })).toMatchObject({ ok: false, status: 422 })
    expect(await ctx.submit({ title: 'no values' })).toMatchObject({ ok: false, status: 400 })
    expect(ctx.calls).toHaveLength(1)
  })

  it('refuses public creates when the collection has no create endpoint', async () => {
    const ctx = await setup()
    await ctx.posts({ list: ENDPOINTS.list }, 'Read only')
    await ctx.bildr.call('collection_update', { projectId: ctx.projectId, collection: 'read-only', publicCreate: true }, mcp)
    await ctx.bildr.call('project_publish', { projectId: ctx.projectId }, mcp)
    expect(await ctx.bildr.call('public_record_create', { projectId: ctx.projectId, collection: 'read-only', body: { values: {} } }, visitor))
      .toEqual({ ok: false, status: 403, message: 'This collection does not accept new records' })
    expect(ctx.calls).toHaveLength(0)
  })

  it('gives visitors no way to update or delete', async () => {
    const ctx = await published()
    for (const name of ['record_update', 'record_delete', 'record_create', 'endpoint_test', 'connection_update']) {
      await expect(ctx.bildr.call(name, { projectId: ctx.projectId, collection: 'posts', recordId: '1', values: {} }, visitor), name).rejects.toMatchObject({ code: 'not_found' })
    }
    const root = fileURLToPath(new URL('../../server/api/public', import.meta.url))
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.ts')).sort()
    expect(files).toEqual(['[projectSlug]/[collectionSlug].get.ts', '[projectSlug]/[collectionSlug].post.ts', '[projectSlug]/[collectionSlug].ts', '[projectSlug]/[collectionSlug]/record.get.ts', '[projectSlug]/[collectionSlug]/record.ts'])
    const source = (file: string) => readFileSync(join(root, file), 'utf8')
    expect(source(files[2]!)).toContain('statusCode: 405')
    expect(source(files[4]!)).toContain('statusCode: 405')
    expect(source(files[3]!)).not.toMatch(/\.call\(|remote\.(?:update|remove|create)/)
    expect([...source(files[1]!).matchAll(/\.call(?:<[^>]*>)?\('([a-z_]+)'/g)].map(m => m[1])).toEqual(['public_record_create'])
    expect(source(files[0]!)).not.toMatch(/\.call\(|remote\.(?:update|remove|create)/)
    await ctx.submit({ values: { title: 'Hi' } })
    await ctx.bildr.services.collectionRecords(ctx.projectId, (await ctx.bildr.services.getPublished('remote'))!.project.collections[0]!, (await ctx.bildr.services.getPublished('remote'))!.project.connections)
    expect(new Set(ctx.calls.map(c => c.method))).toEqual(new Set(['POST', 'GET']))
  })

  it('rate-limits public creates as before: the write budget is spent before the action runs', () => {
    const root = fileURLToPath(new URL('../../server/api/public/[projectSlug]', import.meta.url))
    const post = readFileSync(join(root, '[collectionSlug].post.ts'), 'utf8')
    expect(post.indexOf('limitPublicRequest(event, \'write\'')).toBeGreaterThan(0)
    expect(post.indexOf('limitPublicRequest(event, \'write\'')).toBeLessThan(post.indexOf('readCappedBody('))
    expect(post.indexOf('readCappedBody(')).toBeLessThan(post.indexOf('public_record_create'))
    const get = readFileSync(join(root, '[collectionSlug].get.ts'), 'utf8')
    expect(get.indexOf('limitPublicRequest(event, \'read\'')).toBeLessThan(get.indexOf('collectionRecords('))
  })

  it('strips connections, endpoints, idPath and headers from the visitor snapshot', async () => {
    const ctx = await published()
    const project = await ctx.bildr.call<Project>('project_get', { projectId: ctx.projectId }, mcp)
    await ctx.bildr.call('collection_update', { projectId: ctx.projectId, collection: 'posts', source: { ...project.collections[0]!.source, idPath: 'uuid' } }, mcp)
    await ctx.bildr.call('project_publish', { projectId: ctx.projectId }, mcp)
    const snapshot = visitorSnapshot((await ctx.bildr.services.getPublished('remote'))!)
    expect('connections' in snapshot.project).toBe(false)
    expect(snapshot.project.collections[0]!.source).toEqual({ type: 'connection' })
    expect(snapshot.project.collections[0]!.fields).toEqual([
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'author', label: 'Author', type: 'text' },
      { key: 'userId', label: 'User id', type: 'number' }
    ])
    const text = JSON.stringify(snapshot)
    for (const hidden of ['api.example.com', 'X-Key', 'env.K', '/posts', 'uuid', 'Blog API', 'author.name']) expect(text, hidden).not.toContain(hidden)
  })
})

describe('connection secret leak checks', () => {
  async function everything() {
    const ctx = await setup()
    const { connection: down } = await ctx.bildr.call<{ connection: Connection }>('connection_create', {
      projectId: ctx.projectId, name: 'Down', baseUrl: 'https://down.example.com/?k={{ env.K }}', headers: [{ name: 'X-Key', value: '{{ env.K }}' }]
    }, mcp)
    await ctx.bildr.call('collection_create', { projectId: ctx.projectId, name: 'Downs', source: { type: 'connection', connectionId: down.id, endpoints: ENDPOINTS }, fields: FIELDS }, mcp)
    await ctx.bildr.call('collection_update', { projectId: ctx.projectId, collection: 'downs', publicCreate: true, publicRead: true }, mcp)
    return { ...ctx, down }
  }

  it('never shows the secret in project_get, the history, the snapshot or /api/published', async () => {
    const { bildr, storage, projectId } = await everything()
    expect(leaks(await bildr.call('project_get', { projectId }, mcp))).toBe(false)
    expect(leaks(await bildr.call('history_get', { projectId }, mcp))).toBe(false)
    expect(leaks(await storage.getItem(`history:${projectId}`))).toBe(false)
    expect(leaks(await bildr.call('project_publish', { projectId }, mcp))).toBe(false)
    expect(leaks(await storage.getItem(`published:${projectId}`))).toBe(false)
    expect(leaks(visitorSnapshot((await bildr.services.getPublished('remote'))!))).toBe(false)
  })

  it('redacts the secret from record action and endpoint_test errors', async () => {
    const { bildr, projectId, down, calls } = await everything()
    const failure = (name: string, input: object) => bildr.call(name, { projectId, ...input }, mcp).then(() => undefined, (e: Error) => e)
    const errors = [
      await failure('record_list', { collection: 'downs' }),
      await failure('record_get', { collection: 'downs', recordId: '1' }),
      await failure('record_create', { collection: 'downs', values: { title: 'x' } }),
      await failure('record_update', { collection: 'downs', recordId: '1', values: { title: 'x' } }),
      await failure('record_delete', { collection: 'downs', recordId: '1' }),
      await failure('endpoint_test', { connectionId: down.id, method: 'GET', path: '/posts' })
    ]
    expect(calls.length).toBeGreaterThan(5)
    expect(calls.every(c => c.url.includes(SECRET))).toBe(true)
    for (const error of errors) {
      expect(error).toBeInstanceOf(Error)
      expect(error!.message).toMatch(/^Could not reach the API: connect ECONNREFUSED https:\/\/down\.example\.com\/.*k=•••.* \(•••\)$/)
      expect(leaks(error!.message)).toBe(false)
    }
  })

  it('never answers a visitor with the secret', async () => {
    const { bildr, projectId } = await everything()
    await bildr.call('project_publish', { projectId }, mcp)
    const error = await bildr.call('public_record_create', { projectId, collection: 'downs', body: { values: { title: 'x' } } }, visitor).then(() => undefined, (e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect(leaks(error!.message)).toBe(false)
  })

  it('never shows the secret over MCP', async () => {
    const { bildr, projectId, connection, down } = await everything()
    const client = await mcpClient(bildr)
    const tools = (await client.listTools()).tools.map(t => t.name)
    expect(tools).toEqual(expect.arrayContaining(['connection_create', 'connection_update', 'connection_delete', 'endpoint_test']))
    for (const [name, args] of [
      ['project_get', { projectId }],
      ['connection_update', { projectId, connectionId: connection.id, name: 'Renamed' }],
      ['record_list', { projectId, collection: 'posts' }],
      ['record_list', { projectId, collection: 'downs' }],
      ['record_create', { projectId, collection: 'downs', values: {} }],
      ['endpoint_test', { projectId, connectionId: down.id, method: 'GET', path: '/posts' }],
      ['endpoint_test', { projectId, connectionId: connection.id, method: 'GET', path: '/posts' }],
      ['history_get', { projectId }]
    ] as const) {
      expect(leaks(await client.callTool({ name, arguments: args })), name).toBe(false)
    }
  })
})
