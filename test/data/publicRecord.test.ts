import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createApiFetcher } from '../../server/utils/apiFetch'
import { publicCollection, publicRecordByKey } from '../../server/utils/publicData'
import type { Resolver, Transport } from '../../server/utils/urlGuard'
import type { DataRecord } from '#shared/data/records'
import type { Collection, Connection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }]

/** `titles`: more posts, each with that title and slug. */
async function setup(titles: string[] = []) {
  const transport: Transport = async (url) => {
    if (url.pathname === '/v1/posts/7') return json({ id: 7, title: 'Remote seven', meta: { internal: 'x' } })
    if (url.pathname === '/v1/posts/down') return json({ error: 'boom at 10.0.0.5' }, 500)
    return json({}, 404)
  }
  const bildr = createBildr(memoryStorage(), ACTIONS, { api: createApiFetcher({ transport, resolve }) })
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Blog' }, mcp)
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, mcp)
  await call('collection_create', { name: 'Posts', fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }, { key: 'views', type: 'number' }] })
  await call('collection_create', { name: 'Drafts', fields: [{ key: 'slug', type: 'text' }] })
  const hello = await call<DataRecord>('record_create', { collection: 'posts', values: { title: 'Hello', slug: 'hello-world', views: 3 } })
  for (const title of titles) await call('record_create', { collection: 'posts', values: { title, slug: title } })
  await call('record_create', { collection: 'drafts', values: { slug: 'secret' } })
  const { connection } = await call<{ connection: Connection }>('connection_create', { name: 'API', baseUrl: 'https://api.example.com/v1' })
  await call<{ collection: Collection }>('collection_create', {
    name: 'Remote',
    source: { type: 'connection', connectionId: connection.id, endpoints: { get: { method: 'GET', path: '/posts/{id}' } } },
    fields: [{ key: 'title', type: 'text', path: 'title' }]
  })
  await call('collection_update', { collection: 'posts', publicRead: true })
  await call('collection_update', { collection: 'remote', publicRead: true })
  await call('project_publish')
  const snapshot = (await bildr.services.getPublished('blog'))!
  /** What the endpoint answers for `/api/public/blog/<slug>/record?<query>` (the query as `getQuery` parses it). */
  const query = (slug: string, params: Record<string, unknown>) => {
    const collection = publicCollection(snapshot, slug)
    if (!collection) return Promise.resolve({ ok: false, status: 404, message: 'Collection not found' })
    return publicRecordByKey(collection, params, (field, value) => bildr.services.recordByKey(snapshot.project.id, collection, snapshot.project.connections, field, value))
  }
  const read = (slug: string, key: string, params: Record<string, unknown> = {}) => query(slug, { key, ...params })
  return { read, query, hello }
}

describe('the public record endpoint', () => {
  it('reads one record of a publicRead collection by its URL key, declared fields only', async () => {
    const { read, hello } = await setup()
    expect(await read('posts', 'hello-world')).toEqual({ ok: true, record: { id: hello.id, createdAt: hello.createdAt, updatedAt: hello.updatedAt, values: { title: 'Hello', slug: 'hello-world', views: 3 } } })
    expect(await read('posts', 'Hello', { field: 'title' })).toMatchObject({ ok: true, record: { id: hello.id } })
    expect(await read('posts', hello.id, { field: 'id' })).toMatchObject({ ok: true, record: { id: hello.id } })
  })

  it('answers 404 for a collection without publicRead and for an unknown key', async () => {
    const { read } = await setup()
    expect(await read('drafts', 'secret')).toEqual({ ok: false, status: 404, message: 'Collection not found' })
    expect(await read('posts', 'nope')).toEqual({ ok: false, status: 404, message: 'Record not found' })
    expect(await read('posts', 'x'.repeat(501))).toEqual({ ok: false, status: 404, message: 'Record not found' })
  })

  it('refuses key fields that are not text with a generic message', async () => {
    const { read } = await setup()
    expect(await read('posts', '3', { field: 'views' })).toEqual({ ok: false, status: 400, message: 'Unknown key field' })
    expect(await read('posts', '3', { field: ['a', 'b'] })).toEqual({ ok: false, status: 400, message: 'Unknown key field' })
  })

  it('reads a connection record by id, without its source details; upstream errors stay out of the answer', async () => {
    const { read } = await setup()
    const found = await read('remote', '7')
    expect(found).toEqual({ ok: true, record: { id: '7', createdAt: expect.any(String), updatedAt: expect.any(String), values: { title: 'Remote seven' } } })
    expect(JSON.stringify(found)).not.toMatch(/example\.com|internal|path/)
    expect(await read('remote', '8')).toEqual({ ok: false, status: 404, message: 'Record not found' })
    await expect(read('remote', 'down')).rejects.toThrow()
  })
})

describe('the public record endpoint key and field', () => {
  it('takes the key from the query, so ?, #, & and / in a key reach the lookup as they are', async () => {
    const keys = ['What is new?', 'Part #2', 'Tea & cake', 'a/b', 'post-1?junk', '100%']
    const { query } = await setup(keys)
    for (const title of keys) {
      expect(await query('posts', { key: title, field: 'title' })).toMatchObject({ ok: true, record: { values: { title } } })
      expect(await query('posts', { key: title })).toMatchObject({ ok: true, record: { values: { slug: title } } })
    }
    expect(await query('posts', { key: 'post-1', field: 'title' })).toEqual({ ok: false, status: 404, message: 'Record not found' })
  })

  it('answers 404 without a key or with a repeated one, and 400 for a repeated field', async () => {
    const { query } = await setup()
    const notFound = { ok: false, status: 404, message: 'Record not found' }
    expect(await query('posts', {})).toEqual(notFound)
    expect(await query('posts', { key: '' })).toEqual(notFound)
    expect(await query('posts', { key: ['hello-world', 'second'] })).toEqual(notFound)
    expect(await query('posts', { key: 'hello-world', field: '' })).toMatchObject({ ok: true })
    expect(await query('posts', { key: 'hello-world', field: ['slug', 'title'] })).toEqual({ ok: false, status: 400, message: 'Unknown key field' })
  })
})

describe('the public record route', () => {
  const root = fileURLToPath(new URL('../../server/api/public/[projectSlug]/[collectionSlug]', import.meta.url))
  const source = (file: string) => readFileSync(join(root, file), 'utf8')

  it('serves GET only at /record: every other method answers 405', () => {
    expect(readdirSync(root).sort()).toEqual(['record.get.ts', 'record.ts'])
    expect(source('record.ts')).toContain('statusCode: 405')
    expect(source('record.ts')).toContain('setResponseHeader(event, \'allow\', \'GET\')')
  })

  it('reads the key and field from the query, never from the path', () => {
    const get = source('record.get.ts')
    expect(get).toContain('getQuery(event)')
    expect(get).not.toContain('getRouterParam(event, \'key\'')
  })

  it('spends the read budget before any lookup, and answers lookup failures with a generic 502', () => {
    const get = source('record.get.ts')
    expect(get.indexOf('limitPublicRequest(event, \'read\'')).toBeGreaterThan(0)
    expect(get.indexOf('limitPublicRequest(event, \'read\'')).toBeLessThan(get.indexOf('publicCollection('))
    expect(get.indexOf('limitPublicRequest(event, \'read\'')).toBeLessThan(get.indexOf('recordByKey('))
    expect(get).toContain('statusCode: 502, statusMessage: \'Could not load the data\'')
    expect(get).not.toMatch(/\.call\(|remote\.(?:update|remove|create)/)
  })
})
