import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createApiFetcher } from '../../server/utils/apiFetch'
import type { PublicWriteResult } from '../../server/utils/publicData'
import type { Resolver, Transport } from '../../server/utils/urlGuard'
import { buildEndpointUrl } from '#shared/data/remote'
import type { Connection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const SECRET = 'sk_live_HARDEN_77'
const mcp = { caller: 'mcp' as const, source: 'mcp' }
const visitor = { caller: 'public' as const, source: 'public' }
const resolve: Resolver = async host => (host === 'blocked.example.com' ? [{ address: '10.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } })

interface Call { method: string, url: string, headers?: Record<string, string>, body?: string }

async function setup(route: (url: URL, method: string, hop: number) => Response) {
  const calls: Call[] = []
  const transport: Transport = async (url, init) => {
    calls.push({ method: init.method ?? 'GET', url: url.href, headers: init.headers, body: init.body })
    return route(url, init.method ?? 'GET', calls.length - 1)
  }
  const storage = memoryStorage()
  const bildr = createBildr(storage, ACTIONS, { api: createApiFetcher({ transport, resolve }) })
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Harden' }, mcp)
  await bildr.call('env_set', { projectId, name: 'K', value: SECRET, secret: true }, mcp)
  const { connection } = await bildr.call<{ connection: Connection }>('connection_create', { projectId, name: 'C', baseUrl: 'https://api.example.com/v1', headers: [{ name: 'X-Key', value: '{{ env.K }}' }] }, mcp)
  const collection = (name: string, endpoints: object, fields: object[] = [{ key: 'title', type: 'text' }]) =>
    bildr.call('collection_create', { projectId, name, source: { type: 'connection', connectionId: connection.id, endpoints }, fields }, mcp)
  return { bildr, storage, projectId, connection, calls, collection }
}

describe('origin lock (fuzzed)', () => {
  const bases = ['https://api.example.com/v1', 'https://api.example.com', 'https://api.example.com:8443/a/b/', 'https://api.example.com/v1?key=1']
  const paths = ['/posts', 'posts', '', '?q=1', '//evil.com', '///evil.com', '/\\evil.com', '/@evil.com', '@evil.com', ':@evil.com', 'https:evil.com', 'http:/evil.com', 'HTTPS://evil.com', '/%2e%2e/x', '/.%2e/x', '/%5c%5cevil.com', '/x?u=//evil.com', '/x?u=https://evil.com', '/．．/x', '/x\ty', '/x#y', '/{id}', '/a/{id}/b', '/x?id={id}', 'evil.com:443/x', '../x', '/x/..']
  const ids = [undefined, '1', 'a/b', '..', '.', '?x=1', '#f', '%2e%2e', '../../evil', '//evil.com', '@evil.com', 'a&admin=1', '\\evil', '']
  it('every URL that builds is on the base origin', () => {
    let built = 0
    for (const base of bases) {
      for (const path of paths) {
        for (const id of ids) {
          let url: string
          try {
            url = buildEndpointUrl(base, path, { id })
          } catch {
            continue
          }
          built++
          expect(new URL(url).origin, `${base} ${path} ${id}`).toBe(new URL(base).origin)
        }
      }
    }
    expect(built).toBeGreaterThan(50)
  })

  it('env values that would leave the origin are refused before any request', async () => {
    const ctx = await setup(() => json([]))
    await ctx.bildr.call('env_set', { projectId: ctx.projectId, name: 'P', value: '//evil.com/x' }, mcp)
    await ctx.bildr.call('env_set', { projectId: ctx.projectId, name: 'Q', value: '..' }, mcp)
    for (const path of ['{{ env.P }}', '/{{ env.Q }}/admin']) {
      await expect(ctx.bildr.call('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path }, mcp)).rejects.toThrow()
    }
    expect(ctx.calls).toHaveLength(0)
  })
})

describe('redirects of connection writes', () => {
  async function create(route: (url: URL, method: string, hop: number) => Response) {
    const ctx = await setup(route)
    await ctx.collection('P', { create: { method: 'POST', path: '/posts' } })
    const result = await ctx.bildr.call('record_create', { projectId: ctx.projectId, collection: 'p', values: { title: 'hi' } }, mcp).then(r => r, (e: Error) => e)
    return { ...ctx, result }
  }

  it('a 307 to another origin is refused, so the write never goes there', async () => {
    const { calls, result } = await create((_, __, hop) => [redirect(307, `https://evil.com/a?k=${SECRET}`)][hop] ?? json({ id: 1 }, 201))
    expect(calls.map(c => [c.method, c.url, c.headers?.['x-key'] ?? null])).toEqual([['POST', 'https://api.example.com/v1/posts', SECRET]])
    expect(result).toMatchObject({ message: 'The API redirected a write to another site' })
  })

  it('a 307 on the same origin keeps the method, body and headers', async () => {
    const { calls } = await create((_, __, hop) => (hop === 0 ? redirect(307, '/v1/posts/') : json({ id: 1 }, 201)))
    expect(calls.map(c => [c.method, c.url, c.body ?? null, c.headers?.['x-key'] ?? null])).toEqual([
      ['POST', 'https://api.example.com/v1/posts', '{"title":"hi"}', SECRET],
      ['POST', 'https://api.example.com/v1/posts/', '{"title":"hi"}', SECRET]
    ])
  })

  it('a 303 continues as a GET without the body', async () => {
    const { calls } = await create((_, __, hop) => (hop === 0 ? redirect(303, '/v1/posts/9') : json({ id: 9 })))
    expect(calls.map(c => [c.method, c.body ?? null])).toEqual([['POST', '{"title":"hi"}'], ['GET', null]])
  })

  it('a redirect to a private address or a scheme downgrade is guarded', async () => {
    const blocked = await create((_, __, hop) => (hop === 0 ? redirect(307, 'https://blocked.example.com/x') : json({})))
    expect(blocked.calls).toHaveLength(1)
    expect(blocked.result).toBeInstanceOf(Error)
    const downgrade = await create((_, __, hop) => (hop === 0 ? redirect(308, 'http://api.example.com/v1/posts') : json({ id: 1 }, 201)))
    expect(downgrade.calls).toHaveLength(1)
    expect(downgrade.result).toMatchObject({ message: 'The API redirected a write to another site' })
  })
})

describe('visitor creates through a connection', () => {
  async function published() {
    const ctx = await setup((_, method) => (method === 'GET' ? json([{ id: 1, title: 'a' }]) : json({ id: 5 }, 201)))
    await ctx.collection('P', { list: { method: 'GET', path: '/posts' }, create: { method: 'POST', path: '/posts' } }, [{ key: 'title', type: 'text' }, { key: 'n', type: 'number', path: 'meta.n' }])
    await ctx.bildr.call('collection_create', { projectId: ctx.projectId, name: 'I', fields: [{ key: 'title', type: 'text' }] }, mcp)
    for (const collection of ['p', 'i']) await ctx.bildr.call('collection_update', { projectId: ctx.projectId, collection, publicRead: true, publicCreate: true }, mcp)
    await ctx.bildr.call('project_publish', { projectId: ctx.projectId }, mcp)
    const submit = (body: unknown, collection = 'p') => ctx.bildr.call<PublicWriteResult>('public_record_create', { projectId: ctx.projectId, collection, body }, visitor)
    return { ...ctx, submit }
  }

  it('sends only the declared fields at their paths, no prototype keys', async () => {
    const ctx = await published()
    expect(await ctx.submit(JSON.parse('{"values":{"title":"x","__proto__":{"admin":true},"constructor":1,"id":"7","meta.n":3,"meta":{"admin":1},"n":2}}'))).toMatchObject({ ok: true })
    expect(ctx.calls.filter(c => c.method === 'POST').map(c => c.body)).toEqual(['{"title":"x","meta":{"n":2}}'])
  })

  it('a visitor create refreshes the published list', async () => {
    const ctx = await published()
    const snapshot = (await ctx.bildr.services.getPublished('harden'))!
    const read = () => ctx.bildr.services.collectionRecords(ctx.projectId, snapshot.project.collections[0]!, snapshot.project.connections)
    await read()
    await read()
    await ctx.submit({ values: { title: 'x' } })
    await read()
    expect(ctx.calls.filter(c => c.method === 'GET')).toHaveLength(2)
  })

  // RED at 20fba68: the internal path answers 413, the remote one sends 15 KB on.
  it('applies the 10 KB record limit like internal collections', async () => {
    const ctx = await published()
    const big = { values: { title: 'x'.repeat(15000) } }
    expect(await ctx.submit(big, 'i')).toEqual({ ok: false, status: 413, message: 'A record can be at most 10 KB' })
    expect(await ctx.submit(big, 'p')).toEqual({ ok: false, status: 413, message: 'A record can be at most 10 KB' })
    expect(ctx.calls.filter(c => c.method === 'POST')).toHaveLength(0)
  })

  it('editors and agents get the same limit on connection creates and updates', async () => {
    const ctx = await setup(() => json({ id: 1, title: 'a' }))
    await ctx.collection('P', { get: { method: 'GET', path: '/posts/{id}' }, create: { method: 'POST', path: '/posts' }, update: { method: 'PUT', path: '/posts/{id}' } })
    const values = { title: 'x'.repeat(15000) }
    await expect(ctx.bildr.call('record_create', { projectId: ctx.projectId, collection: 'p', values }, mcp)).rejects.toThrow('A record can be at most 10 KB')
    await expect(ctx.bildr.call('record_update', { projectId: ctx.projectId, collection: 'p', recordId: '1', values }, mcp)).rejects.toThrow('A record can be at most 10 KB')
    expect(ctx.calls.filter(c => c.method !== 'GET')).toHaveLength(0)
  })
})

describe('List and Get endpoints', () => {
  it('a stored List or Get with another method still reads with GET', async () => {
    const ctx = await setup(() => json([{ id: 1, title: 'a' }]))
    await ctx.collection('P', { list: { method: 'GET', path: '/posts' } })
    const key = `projects:${ctx.projectId}`
    const stored = (await ctx.storage.getItem<Project>(key))!
    const source = stored.collections[0]!.source
    if (source.type === 'connection') Object.assign(source.endpoints.list!, { method: 'POST' })
    await ctx.storage.setItem(key, stored)
    expect(await ctx.bildr.call('record_list', { projectId: ctx.projectId, collection: 'p' }, mcp)).toMatchObject({ total: 1 })
    expect(ctx.calls.map(c => c.method)).toEqual(['GET'])
  })

  it('collection_update refuses a List endpoint that does not use GET', async () => {
    const ctx = await setup(() => json([]))
    await ctx.collection('P', { list: { method: 'GET', path: '/posts' } })
    const source = { type: 'connection', connectionId: ctx.connection.id, endpoints: { list: { method: 'POST', path: '/posts' } } }
    await expect(ctx.bildr.call('collection_update', { projectId: ctx.projectId, collection: 'p', source }, mcp)).rejects.toThrow('List and Get endpoints use GET')
  })
})

describe('endpoint_test and undo', () => {
  it('refuses every non-GET method without confirm: true, sending nothing', async () => {
    const ctx = await setup(() => json({}))
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const confirm of [undefined, false]) {
        await expect(ctx.bildr.call('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method, path: '/x', confirm }, mcp)).rejects.toThrow(/only sends GET unless confirm/)
      }
    }
    expect(ctx.calls).toHaveLength(0)
  })

  it('connection_delete with force is one undo step that restores collections in place; redo repeats it', async () => {
    const ctx = await setup(() => json([]))
    const { bildr, projectId, connection } = ctx
    await bildr.call('collection_create', { projectId, name: 'Internal A' }, mcp)
    await ctx.collection('R1', { list: { method: 'GET', path: '/a' } }, [{ key: 'title', type: 'text', path: 'x.y' }])
    await bildr.call('collection_create', { projectId, name: 'Internal B' }, mcp)
    await ctx.collection('R2', { list: { method: 'GET', path: '/b' } })
    await bildr.call('connection_create', { projectId, name: 'Other', baseUrl: 'https://o.example.com' }, mcp)
    const before = await bildr.call<Project>('project_get', { projectId }, mcp)
    await bildr.call('connection_delete', { projectId, connectionId: connection.id, force: true }, mcp)
    const after = await bildr.call<Project>('project_get', { projectId }, mcp)
    expect(after.collections.map(c => c.name)).toEqual(['Internal A', 'Internal B'])
    const strip = (p: Project) => ({ ...p, version: 0, updatedAt: '' })
    await bildr.call('history_undo', { projectId }, mcp)
    expect(strip(await bildr.call<Project>('project_get', { projectId }, mcp))).toEqual(strip(before))
    await bildr.call('history_redo', { projectId }, mcp)
    expect(strip(await bildr.call<Project>('project_get', { projectId }, mcp))).toEqual(strip(after))
  })
})
