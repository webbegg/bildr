import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createApiFetcher } from '../../server/utils/apiFetch'
import type { Resolver, Transport } from '../../server/utils/urlGuard'
import type { Connection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const SECRET = 'sk_live_REGRESSION_SECRET_42'
const mcp = { caller: 'mcp' as const, source: 'mcp' }
const BASE = 'https://api.example.com/v1'
const OFF_SITE = 'The API\'s next page is on another site'
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })
const publicAddress: Resolver = async () => [{ address: '93.184.216.34', family: 4 }]

async function setup(answer: (url: URL) => Response, resolve: Resolver = publicAddress) {
  const calls: { url: string, method: string, headers: Record<string, string> }[] = []
  const transport: Transport = async (url, init) => {
    calls.push({ url: url.href, method: init.method ?? 'GET', headers: init.headers ?? {} })
    return answer(url)
  }
  const bildr = createBildr(memoryStorage(), ACTIONS, { api: createApiFetcher({ transport, resolve }) })
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Paging regressions' }, mcp)
  await bildr.call('env_set', { projectId, name: 'K', value: SECRET, secret: true }, mcp)
  const { connection } = await bildr.call<{ connection: Connection }>('connection_create', { projectId, name: 'C', baseUrl: BASE, headers: [{ name: 'X-Key', value: '{{ env.K }}' }] }, mcp)
  const collection = (list: object, extra: object = {}) => bildr.call('collection_create', {
    projectId, name: 'A', fields: [{ key: 'name', type: 'text' }], source: { type: 'connection', connectionId: connection.id, endpoints: { list: { method: 'GET', path: '/a', itemsPath: 'data', ...list }, ...extra } }
  }, mcp)
  const read = (input: object = {}) => bildr.call<{ records: { id: string }[], total: number, hasMore?: boolean }>('record_list', { projectId, collection: 'a', ...input }, mcp)
  return { bildr, projectId, calls, collection, read }
}

const NEXT = { paging: { type: 'next', nextPath: 'next' } }

describe('S35.2 next URLs keep the origin', () => {
  for (const next of ['https://api.example.com./x', '\\\\evil.com\\x', '/\\evil.com/x', 'https://аpi.example.com/x', 'https://api.example.com.evil.com/x', 'javascript:alert(1)', 'data:text/plain,x', ' https://evil.com/x']) {
    it(`refuses ${JSON.stringify(next)} and sends nothing more`, async () => {
      const ctx = await setup(url => (url.pathname === '/v1/a' ? json({ next, data: [{ id: 1 }] }) : json({ data: [{ id: 2 }] })))
      await ctx.collection(NEXT)
      await expect(ctx.read({ limit: 10 })).rejects.toMatchObject({ code: 'invalid', message: OFF_SITE })
      expect(ctx.calls.map(c => c.url)).toEqual([`${BASE}/a`])
    })
  }

  it('refuses a same-origin next with user info before sending it', async () => {
    const ctx = await setup(url => (url.pathname === '/v1/a' ? json({ next: 'https://u:p@api.example.com/v1/b', data: [{ id: 1 }] }) : json({ data: [{ id: 2 }] })))
    await ctx.collection(NEXT)
    await expect(ctx.read({ limit: 10 })).rejects.toMatchObject({ message: 'URLs with a user name or password are not allowed' })
    expect(ctx.calls).toHaveLength(1)
  })

  it('runs the SSRF guard on a same-origin next page whose host now resolves privately', async () => {
    let lookups = 0
    const rebinding: Resolver = async () => (++lookups === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.5', family: 4 }])
    const ctx = await setup(url => (url.pathname === '/v1/a' ? json({ next: '/v1/b', data: [{ id: 1 }] }) : json({ data: [{ id: 2 }] })), rebinding)
    await ctx.collection(NEXT)
    const error = await ctx.read({ limit: 10 }).then(() => undefined, (e: Error) => e)
    expect(error?.message).toMatch(/^Blocked address/)
    expect(error?.message).not.toContain(SECRET)
    expect(ctx.calls).toHaveLength(1)
  })

  it('refuses an off-site Link header next even with several rel values', async () => {
    const ctx = await setup(() => json({ data: [{ id: 1 }] }, { link: '<https://evil.com/2>; rel="prev next"' }))
    await ctx.collection({ paging: { type: 'next' } })
    await expect(ctx.read({ limit: 10 })).rejects.toMatchObject({ message: OFF_SITE })
    expect(ctx.calls).toHaveLength(1)
  })
})

describe('S35.2 caps', () => {
  it('an ever-changing next URL stops at 20 pages', async () => {
    const ctx = await setup(url => json({ next: `/v1/a?p=${Number(url.searchParams.get('p') ?? 0) + 1}`, data: [{ id: 1 }] }))
    await ctx.collection(NEXT)
    expect(await ctx.read({ limit: 500 })).toMatchObject({ hasMore: true })
    expect(ctx.calls).toHaveLength(20)
  })

  it('alternating next URLs and cursors stop at the repeat', async () => {
    const next = await setup(url => json({ next: url.searchParams.get('p') === '1' ? '/v1/a?p=2' : '/v1/a?p=1', data: [{ id: 1 }] }))
    await next.collection(NEXT)
    await next.read({ limit: 500 })
    expect(next.calls).toHaveLength(3)
    const cursor = await setup(url => json({ c: url.searchParams.get('cursor') === 'A' ? 'B' : 'A', data: [{ id: 1 }] }))
    await cursor.collection({ paging: { type: 'cursor', param: 'cursor', cursorPath: 'c' } })
    await cursor.read({ limit: 500 })
    expect(cursor.calls).toHaveLength(3)
  })

  it('a lying totalPath cannot push past 20 pages', async () => {
    const ctx = await setup(() => json({ total: 1e9, data: [{ id: 1 }, { id: 2 }] }))
    await ctx.collection({ paging: { type: 'page', sizeParam: 'per_page', size: 2, totalPath: 'total' } })
    await ctx.read({ limit: 500 })
    expect(ctx.calls).toHaveLength(20)
  })
})

describe('S35.2 cache', () => {
  const pages = (url: URL) => {
    const page = Number(url.searchParams.get('page') ?? 1)
    return url.pathname === '/v1/a' ? json({ next: page < 3 ? `/v1/a?page=${page + 1}` : null, data: [{ id: page }] }) : json({ id: 9 })
  }

  it('a changed secret is never answered from pages cached with the old one', async () => {
    const ctx = await setup(pages)
    await ctx.collection(NEXT)
    await ctx.read()
    await ctx.bildr.call('env_set', { projectId: ctx.projectId, name: 'K', value: 'sk_live_ROTATED_SECRET_43', secret: true }, mcp)
    ctx.calls.length = 0
    await ctx.read()
    expect(ctx.calls.map(c => c.headers['x-key'])).toEqual(Array(3).fill('sk_live_ROTATED_SECRET_43'))
  })

  it('update and delete drop every cached page', async () => {
    const ctx = await setup(pages)
    await ctx.collection(NEXT, { update: { method: 'PATCH', path: '/a/{id}' }, delete: { method: 'DELETE', path: '/a/{id}' } })
    await ctx.read()
    for (const write of [
      () => ctx.bildr.call('record_update', { projectId: ctx.projectId, collection: 'a', recordId: '2', values: { name: 'x' } }, mcp),
      () => ctx.bildr.call('record_delete', { projectId: ctx.projectId, collection: 'a', recordId: '2' }, mcp)
    ]) {
      await write()
      ctx.calls.length = 0
      await ctx.read()
      expect(ctx.calls.map(c => c.url)).toEqual([`${BASE}/a`, `${BASE}/a?page=2`, `${BASE}/a?page=3`])
    }
  })
})
