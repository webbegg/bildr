import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { NavigateEvent } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createApiFetcher } from '../../server/utils/apiFetch'
import type { Resolver, Transport } from '../../server/utils/urlGuard'
import type { DataRecord } from '#shared/data/records'
import type { Collection, Connection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const strip = ({ version: _v, updatedAt: _u, ...rest }: Project) => rest

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }]
const POSTS = [{ id: 1, title: 'First', slug: 'first' }, { id: 2, title: 'Second', slug: 'second' }]

/** A blog: an internal Posts collection (title, slug, body, views) with two records, and a Post page. */
async function setup() {
  const urls: string[] = []
  const transport: Transport = async (url) => {
    urls.push(url.href)
    if (url.pathname === '/posts') return json(POSTS)
    const one = POSTS.find(p => url.pathname === `/posts/${p.id}`)
    return one ? json(one) : json({}, 404)
  }
  const bildr = createBildr(memoryStorage(), ACTIONS, { api: createApiFetcher({ transport, resolve }) })
  const navigations: NavigateEvent[] = []
  bildr.onNavigate(e => navigations.push(e))
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Blog' }, mcp)
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, mcp)
  await call('collection_create', {
    name: 'Posts',
    fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }, { key: 'body', type: 'text' }, { key: 'views', type: 'number' }]
  })
  const hello = await call<DataRecord>('record_create', { collection: 'posts', values: { title: 'Hello', slug: 'hello-world', body: 'Hi there', views: 3 } })
  const second = await call<DataRecord>('record_create', { collection: 'posts', values: { title: 'Second', slug: 'second', body: 'More' } })
  const { pageId } = await call<{ pageId: string }>('page_add', { name: 'Post' })
  const project = () => call<Project>('project_get')
  const page = async () => (await project()).pages.find(p => p.id === pageId)!
  return { bildr, call, projectId, pageId, hello, second, project, page, navigations, urls }
}

describe('page_set_collection', () => {
  it('makes a page a detail page and back, one undo step each', async () => {
    const { call, pageId, page, project } = await setup()
    const before = strip(await project())
    expect(await call('page_set_collection', { pageId, collection: { slug: 'posts' } })).toMatchObject({ collection: { slug: 'posts' }, keyField: 'slug', path: '/post/:slug' })
    expect((await page()).collection).toEqual({ slug: 'posts' })
    expect(await call('page_set_collection', { pageId, collection: { slug: 'posts', field: 'title' } })).toMatchObject({ keyField: 'title', path: '/post/:title' })
    await call('page_set_collection', { pageId, collection: null })
    expect(await page()).not.toHaveProperty('collection')
    await call('history_undo')
    await call('history_undo')
    expect((await page()).collection).toEqual({ slug: 'posts' })
    await call('history_undo')
    expect(strip(await project())).toEqual(before)
  })

  it('takes the record id as the URL key, even with a text slug field', async () => {
    const { call, pageId, page } = await setup()
    expect(await call('page_set_collection', { pageId, collection: { slug: 'posts', field: 'id' } })).toMatchObject({ collection: { slug: 'posts', field: 'id' }, keyField: 'id', path: '/post/:id' })
    expect((await page()).collection).toEqual({ slug: 'posts', field: 'id' })
  })

  it('refuses an unknown collection and a key field that is missing or not text', async () => {
    const { call, pageId } = await setup()
    await expect(call('page_set_collection', { pageId, collection: { slug: 'news' } })).rejects.toThrow('Page "Post" shows the unknown collection "news"')
    await expect(call('page_set_collection', { pageId, collection: { slug: 'posts', field: 'nope' } })).rejects.toThrow('"Posts" has no field "nope" for the URL key')
    await expect(call('page_set_collection', { pageId, collection: { slug: 'posts', field: 'views' } })).rejects.toThrow('must be a text field, not number')
  })

  it('page_add takes a collection', async () => {
    const { call, project } = await setup()
    const { pageId } = await call<{ pageId: string }>('page_add', { name: 'Article', collection: { slug: 'posts', field: 'title' } })
    expect((await project()).pages.find(p => p.id === pageId)!.collection).toEqual({ slug: 'posts', field: 'title' })
    await expect(call('page_add', { name: 'Bad', collection: { slug: 'nope' } })).rejects.toThrow('unknown collection "nope"')
  })
})

describe('cascades from collection and field changes', () => {
  async function detail(field?: string) {
    const ctx = await setup()
    await ctx.call('page_set_collection', { pageId: ctx.pageId, collection: field ? { slug: 'posts', field } : { slug: 'posts' } })
    return { ...ctx, before: strip(await ctx.project()) }
  }

  it('renaming the collection slug updates the page, and one undo restores both', async () => {
    const { call, page, project, before } = await detail('title')
    await call('collection_update', { collection: 'posts', slug: 'articles' })
    expect((await page()).collection).toEqual({ slug: 'articles', field: 'title' })
    await call('history_undo')
    expect(strip(await project())).toEqual(before)
    await call('history_redo')
    expect((await page()).collection).toEqual({ slug: 'articles', field: 'title' })
  })

  it('deleting the collection makes the page a plain page, and one undo restores both', async () => {
    const { call, page, project, before } = await detail()
    await call('collection_delete', { collection: 'posts' })
    expect(await page()).not.toHaveProperty('collection')
    await call('history_undo')
    expect(strip(await project())).toEqual(before)
  })

  it('removing the key field or making it non-text falls back to the default key, one undo step', async () => {
    const { call, page, project, before } = await detail('title')
    await call('field_remove', { collection: 'posts', key: 'title' })
    expect((await page()).collection).toEqual({ slug: 'posts' })
    await call('history_undo')
    expect(strip(await project())).toEqual(before)
    await call('field_update', { collection: 'posts', key: 'title', type: 'number' })
    expect((await page()).collection).toEqual({ slug: 'posts' })
    await call('history_undo')
    expect(strip(await project())).toEqual(before)
    await call('field_update', { collection: 'posts', key: 'title', label: 'Headline' })
    expect((await page()).collection).toEqual({ slug: 'posts', field: 'title' })
  })

  it('keeps the record id key when fields are renamed, retyped or removed, and follows a slug rename', async () => {
    const { call, page, project, before } = await detail('id')
    await call('field_update', { collection: 'posts', key: 'slug', type: 'number' })
    expect((await page()).collection).toEqual({ slug: 'posts', field: 'id' })
    await call('field_remove', { collection: 'posts', key: 'slug' })
    expect((await page()).collection).toEqual({ slug: 'posts', field: 'id' })
    await call('field_update', { collection: 'posts', key: 'title', label: 'Headline' })
    await call('collection_update', { collection: 'posts', slug: 'articles' })
    expect((await page()).collection).toEqual({ slug: 'articles', field: 'id' })
    for (let i = 0; i < 4; i++) await call('history_undo')
    expect(strip(await project())).toEqual(before)
  })

  it('deleting a connection clears the detail pages of its collections', async () => {
    const { call, project } = await setup()
    const { connection } = await call<{ connection: Connection }>('connection_create', { name: 'JP', baseUrl: 'https://api.example.com' })
    await call('collection_create', { name: 'Remote', source: { type: 'connection', connectionId: connection.id, endpoints: { list: { method: 'GET', path: '/posts' } } }, fields: [{ key: 'title', type: 'text' }] })
    const { pageId } = await call<{ pageId: string }>('page_add', { name: 'Remote post', collection: { slug: 'remote', field: 'title' } })
    const before = strip(await project())
    await call('connection_delete', { connectionId: connection.id, force: true })
    expect((await project()).pages.find(p => p.id === pageId)).not.toHaveProperty('collection')
    await call('history_undo')
    expect(strip(await project())).toEqual(before)
  })
})

describe('record_find', () => {
  it('finds a record by its slug field, by id, or by a chosen field', async () => {
    const { call, hello, second } = await setup()
    expect(await call<DataRecord>('record_find', { collection: 'posts', value: 'hello-world' })).toMatchObject({ id: hello.id, values: { title: 'Hello' } })
    expect(await call<DataRecord>('record_find', { collection: 'posts', field: 'id', value: second.id })).toMatchObject({ values: { slug: 'second' } })
    expect(await call<DataRecord>('record_find', { collection: 'posts', field: 'title', value: 'Second' })).toMatchObject({ id: second.id })
  })

  it('falls back to the record id when the collection has no text slug field', async () => {
    const { call } = await setup()
    await call('collection_create', { name: 'Notes', fields: [{ key: 'text', type: 'text' }] })
    const note = await call<DataRecord>('record_create', { collection: 'notes', values: { text: 'n' } })
    expect(await call<DataRecord>('record_find', { collection: 'notes', value: note.id })).toMatchObject({ id: note.id })
  })

  it('answers not found for an unknown key, and refuses fields that are not text', async () => {
    const { call } = await setup()
    await expect(call('record_find', { collection: 'posts', value: 'nope' })).rejects.toMatchObject({ code: 'not_found', message: 'No record of "Posts" has slug "nope"' })
    await expect(call('record_find', { collection: 'posts', field: 'views', value: '3' })).rejects.toThrow('"views" is not a text field of "Posts"')
    await expect(call('record_find', { collection: 'posts', field: 'zzz', value: '3' })).rejects.toThrow('"zzz" is not a text field of "Posts"')
  })

  it('reads a connection record by id through its get endpoint, and other keys from the list', async () => {
    const { call, urls } = await setup()
    const { connection } = await call<{ connection: Connection }>('connection_create', { name: 'JP', baseUrl: 'https://api.example.com' })
    await call<{ collection: Collection }>('collection_create', {
      name: 'Remote',
      source: { type: 'connection', connectionId: connection.id, endpoints: { list: { method: 'GET', path: '/posts' }, get: { method: 'GET', path: '/posts/{id}' } } },
      fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }]
    })
    expect(await call<DataRecord>('record_find', { collection: 'remote', field: 'id', value: '2' })).toMatchObject({ id: '2', values: { title: 'Second' } })
    expect(urls).toEqual(['https://api.example.com/posts/2'])
    await expect(call('record_find', { collection: 'remote', field: 'id', value: '99' })).rejects.toMatchObject({ code: 'not_found' })
    expect(await call<DataRecord>('record_find', { collection: 'remote', value: 'first' })).toMatchObject({ id: '1' })
    expect(urls.at(-1)).toBe('https://api.example.com/posts')
  })
})

describe('the node_insert description', () => {
  it('hints the real detail link shape, not a path that no route serves', async () => {
    const { bildr } = await setup()
    const description = bildr.list().find(a => a.name === 'node_insert')!.description
    expect(description).not.toContain('/menu/{{ item.id }}')
    expect(description).toContain('"post/{{ item.slug }}"')
    expect(description).toContain('<page>/{{ item.<key field> }}')
  })
})

describe('editor_navigate to a record of a detail page', () => {
  it('carries the record id for the canvas to preview', async () => {
    const { call, pageId, hello, navigations } = await setup()
    await call('page_set_collection', { pageId, collection: { slug: 'posts' } })
    expect(await call('editor_navigate', { pageId, recordId: hello.id })).toEqual({ pageId, nodeId: null, componentId: null, layoutId: null, variantId: null, recordId: hello.id })
    expect(navigations.at(-1)).toMatchObject({ pageId, recordId: hello.id })
  })

  it('refuses a record on a plain page and an unknown record', async () => {
    const { call, pageId, hello, project } = await setup()
    const home = (await project()).pages[0]!.id
    await expect(call('editor_navigate', { pageId: home, recordId: hello.id })).rejects.toThrow('recordId needs a detail page: "Home" shows no collection')
    await call('page_set_collection', { pageId, collection: { slug: 'posts' } })
    await expect(call('editor_navigate', { pageId, recordId: 'rec_missing' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('shows the detail path in the editor context outline', async () => {
    const { bildr, projectId, call, pageId } = await setup()
    await call('page_set_collection', { pageId, collection: { slug: 'posts' } })
    await bildr.call('editor_set_context', { projectId, pageId, selectedId: null }, { caller: 'ui' })
    const context = await call<{ outline: string }>('editor_get_context')
    expect(context.outline.split('\n')[0]).toBe('Page "Post" (/post/:slug)')
  })
})
