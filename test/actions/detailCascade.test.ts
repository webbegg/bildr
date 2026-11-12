import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { ProjectSchema } from '#shared/document/schema'
import type { Collection, Connection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const storage = memoryStorage()
  const bildr = createBildr(storage, ACTIONS)
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'M' }, mcp)
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, mcp)
  await call('collection_create', { name: 'Posts', fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }, { key: 'handle', type: 'text' }, { key: 'views', type: 'number' }] })
  const { pageId } = await call<{ pageId: string }>('page_add', { name: 'Post', collection: { slug: 'posts', field: 'handle' } })
  const { pageId: p2 } = await call<{ pageId: string }>('page_add', { name: 'Post2', collection: { slug: 'posts' } })
  const doc = () => call<Project>('project_get')
  const snap = async () => JSON.stringify(Object.fromEntries(await Promise.all((await storage.getKeys('')).sort().map(async k => [k, await storage.getItem(k)]))))
  const docSansVersion = async () => {
    const d = await doc()
    const { version: _v, updatedAt: _u, ...rest } = d as Project & { updatedAt?: string }
    return JSON.stringify(rest)
  }
  return { bildr, call, doc, snap, docSansVersion, pageId, p2, projectId, storage }
}

describe('verify: page_set_collection / page_add', () => {
  it('rejections leave storage byte-identical', async () => {
    const { call, snap, pageId } = await setup()
    const bad: [string, Record<string, unknown>][] = [
      ['page_set_collection', { pageId, collection: { slug: 'nope' } }],
      ['page_set_collection', { pageId, collection: { slug: 'posts', field: 'views' } }],
      ['page_set_collection', { pageId, collection: { slug: 'posts', field: 'zzz' } }],
      ['page_set_collection', { pageId, collection: { slug: 'posts', field: '' } }],
      ['page_set_collection', { pageId, collection: { slug: 'posts', field: '__proto__' } }],
      ['page_set_collection', { pageId, collection: { slug: 'Posts' } }],
      ['page_set_collection', { pageId: 'p_nope', collection: { slug: 'posts' } }],
      ['page_set_collection', { pageId, collection: 'posts' }],
      ['page_add', { name: 'X', collection: { slug: 'nope' } }],
      ['page_add', { name: 'X', collection: { slug: 'posts', field: 'views' } }]
    ]
    for (const [name, input] of bad) {
      const before = await snap()
      const r = await call(name, input).then(v => `OK ${JSON.stringify(v)}`, (e: { code?: string, message: string }) => `${e.code}: ${e.message}`)
      console.log(name, JSON.stringify(input), '→', r)
      expect(await snap(), `${name} ${JSON.stringify(input)}`).toBe(before)
    }
  })
  it('set / unset / undo / redo are exact', async () => {
    const { call, docSansVersion, pageId } = await setup()
    const s0 = await docSansVersion()
    console.log(JSON.stringify(await call('page_set_collection', { pageId, collection: { slug: 'posts' } })))
    const s1 = await docSansVersion()
    await call('history_undo')
    expect(await docSansVersion()).toBe(s0)
    await call('history_redo')
    expect(await docSansVersion()).toBe(s1)
    console.log(JSON.stringify(await call('page_set_collection', { pageId, collection: null })))
    const s2 = await docSansVersion()
    expect(s2).not.toContain('"handle"}')
    await call('history_undo')
    expect(await docSansVersion()).toBe(s1)
    // same value twice: no new step
    await call('page_set_collection', { pageId, collection: { slug: 'posts' } })
    const h1 = JSON.stringify(await call('history_get'))
    await call('page_set_collection', { pageId, collection: { slug: 'posts' } })
    expect(JSON.stringify(await call('history_get'))).toBe(h1)
  })
  it('page_add {collection} undo exact', async () => {
    const { call, docSansVersion } = await setup()
    const s0 = await docSansVersion()
    await call('page_add', { name: 'Third', collection: { slug: 'posts', field: 'title' } })
    await call('history_undo')
    expect(await docSansVersion()).toBe(s0)
  })
})

describe('verify: cascades', () => {
  const cases: [string, (c: Awaited<ReturnType<typeof setup>>) => Promise<unknown>][] = [
    ['rename slug', c => c.call('collection_update', { collection: 'posts', slug: 'articles' })],
    ['delete collection', c => c.call('collection_delete', { collection: 'posts', confirm: 'posts', force: true })],
    ['remove key field', c => c.call('field_remove', { collection: 'posts', key: 'handle' })],
    ['remove slug field', c => c.call('field_remove', { collection: 'posts', key: 'slug' })],
    ['retype key field', c => c.call('field_update', { collection: 'posts', key: 'handle', type: 'number' })],
    ['retype slug', c => c.call('field_update', { collection: 'posts', key: 'slug', type: 'number' })]
  ]
  for (const [label, run] of cases) {
    it(label, async () => {
      const c = await setup()
      const s0 = await c.docSansVersion()
      const h0 = (await c.storage.getItem(`history:${c.projectId}`) as { undo: unknown[] }).undo.length
      const r = await run(c).then(() => 'ok', (e: Error) => `ERR ${e.message}`)
      const after = await c.doc()
      console.log(label, r, JSON.stringify(after.pages.map(p => [p.name, p.collection ?? null])))
      expect(ProjectSchema.safeParse(after).success).toBe(true)
      if (r === 'ok') {
        expect((await c.storage.getItem(`history:${c.projectId}`) as { undo: unknown[] }).undo.length).toBe(h0 + 1)
        await c.call('history_undo')
        expect(await c.docSansVersion()).toBe(s0)
        await c.call('history_redo')
        expect(JSON.stringify((await c.doc()).pages)).toBe(JSON.stringify(after.pages))
      }
    })
  }
  it('connection_delete force', async () => {
    const c = await setup()
    const { connection } = await c.call<{ connection: Connection }>('connection_create', { name: 'API', baseUrl: 'https://api.example.com/v1' })
    await c.call<{ collection: Collection }>('collection_create', { name: 'Remote', source: { type: 'connection', connectionId: connection.id, endpoints: { get: { method: 'GET', path: '/p/{id}' } } }, fields: [{ key: 'title', type: 'text' }] })
    await c.call('page_add', { name: 'R', collection: { slug: 'remote' } })
    const s0 = await c.docSansVersion()
    await c.call('connection_delete', { connectionId: connection.id, force: true })
    const after = await c.doc()
    console.log('conn delete', JSON.stringify(after.pages.map(p => [p.name, p.collection ?? null])))
    await c.call('history_undo')
    expect(await c.docSansVersion()).toBe(s0)
  })
  it('API/connection source fields replaced', async () => {
    const c = await setup()
    const { connection } = await c.call<{ connection: Connection }>('connection_create', { name: 'API', baseUrl: 'https://api.example.com/v1' })
    await c.call('collection_create', { name: 'Remote', source: { type: 'connection', connectionId: connection.id, endpoints: { get: { method: 'GET', path: '/p/{id}' } } }, fields: [{ key: 'title', type: 'text' }, { key: 'code', type: 'text' }] })
    await c.call('page_add', { name: 'R', collection: { slug: 'remote', field: 'code' } })
    const s0 = await c.docSansVersion()
    const r = await c.call('collection_update', { collection: 'remote', fields: [{ key: 'title', type: 'text' }] }).then(() => 'ok', (e: Error) => e.message)
    console.log('fields replace', r, JSON.stringify((await c.doc()).pages.map(p => [p.name, p.collection ?? null])))
    await c.call('history_undo')
    expect(await c.docSansVersion()).toBe(s0)
  })
  it('old documents without collection parse and keep shape', async () => {
    const c = await setup()
    const d = await c.doc()
    const old = structuredClone(d) as Project
    for (const p of old.pages) delete (p as { collection?: unknown }).collection
    const parsed = ProjectSchema.parse(old)
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(old))
  })
})
