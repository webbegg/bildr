import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createApiFetcher } from '../../server/utils/apiFetch'
import { publicCollection, publicRecordByKey } from '../../server/utils/publicData'
import type { Resolver, Transport } from '../../server/utils/urlGuard'
import type { Collection, Connection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const SECRET = 'sk_live_TOPSECRET_99'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }]

async function setup(getPath = '/posts/{id}') {
  const calls: string[] = []
  const transport: Transport = async (url, init) => {
    calls.push(`${url.href} ${JSON.stringify(init.headers)}`)
    if (url.pathname === '/v1/posts/7') return json({ id: 7, title: 'Seven', slug: 'seven', internal: 'hidden-x' })
    if (url.pathname === '/v1/posts/boom') return json({ error: `boom ${SECRET}` }, 500)
    if (url.pathname === '/v1/posts') return json([{ id: 7, title: 'Seven', slug: 'seven', internal: 'hidden-x' }, { id: 8, title: 'Eight', slug: 'eight' }])
    return json({ nope: true }, 404)
  }
  const bildr = createBildr(memoryStorage(), ACTIONS, { api: createApiFetcher({ transport, resolve }) })
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Blog' }, mcp)
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, mcp)
  await call('env_set', { name: 'K', value: SECRET, secret: true })
  const { connection } = await call<{ connection: Connection }>('connection_create', { name: 'API', baseUrl: 'https://api.example.com/v1', headers: [{ name: 'X-Key', value: '{{ env.K }}' }] })
  await call<{ collection: Collection }>('collection_create', {
    name: 'Remote',
    source: { type: 'connection', connectionId: connection.id, endpoints: { list: { method: 'GET', path: '/posts' }, get: { method: 'GET', path: getPath } } },
    fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }]
  })
  await call('collection_update', { collection: 'remote', publicRead: true })
  await call('project_publish')
  const snapshot = (await bildr.services.getPublished('blog'))!
  const read = (key: string, params: Record<string, unknown> = {}) => {
    const collection = publicCollection(snapshot, 'remote')!
    return publicRecordByKey(collection, { key, ...params }, (field, value) => bildr.services.recordByKey(snapshot.project.id, collection, snapshot.project.connections, field, value))
  }
  return { read, calls, snapshot, call }
}

describe('verify: remote keys', () => {
  it('by id stays on the origin and base path segment', async () => {
    const { read, calls } = await setup()
    const keys = ['7', '../admin', '..%2Fadmin', '%2e%2e', '?x=1', '#frag', '//evil.com/x', '@evil.com', 'http://evil.com/', 'a/b', '\\\\evil.com', '%00', 'ü', ' 7']
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      try {
        out[key] = await read(key, { field: 'id' })
      } catch (e) {
        out[key] = `THROW ${(e as Error).message}`
      }
    }
    console.log(JSON.stringify(out, null, 1))
    console.log(calls.join('\n'))
    for (const c of calls) expect(c.startsWith('https://api.example.com/v1/posts/')).toBe(true)
    for (const c of calls) expect(c.split(' ')[0]!.split('/').length).toBe(6)
    expect(JSON.stringify(out)).not.toContain('hidden-x')
  })
  it('. and .. throw (caller makes 502); upstream 500 throws without being turned into data', async () => {
    const { read } = await setup()
    for (const key of ['.', '..', 'boom']) {
      let r: unknown
      try {
        r = await read(key, { field: 'id' })
      } catch (e) {
        r = `THROW ${(e as Error).message}`
      }
      console.log(key, JSON.stringify(r))
    }
  })
  it('default key (slug) scans the list', async () => {
    const { read, calls } = await setup()
    console.log(JSON.stringify(await read('seven')), JSON.stringify(await read('nine')), calls)
  })
  it('get path with {id} in the query', async () => {
    const { read, calls } = await setup('/posts?id={id}')
    for (const key of ['7&admin=1', '7#x']) {
      await read(key, { field: 'id' }).catch(() => undefined)
    }
    console.log(calls)
  })
})
