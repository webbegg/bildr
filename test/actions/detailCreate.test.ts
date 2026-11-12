import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import type { Collection, Connection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const strip = ({ version: _v, updatedAt: _u, ...rest }: Project) => rest

/** A project with an internal Posts collection (title, slug, body, views). */
async function setup() {
  const storage = memoryStorage()
  const bildr = createBildr(storage, ACTIONS)
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Blog' }, mcp)
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, mcp)
  await call('collection_create', {
    name: 'Posts',
    fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }, { key: 'body', type: 'text' }, { key: 'views', type: 'number' }]
  })
  const project = () => call<Project>('project_get')
  const snap = async () => JSON.stringify(Object.fromEntries(await Promise.all((await storage.getKeys('')).sort().map(async k => [k, await storage.getItem(k)]))))
  return { call, project, snap }
}

interface Created { version: number, pageId: string, slug: string, nodeIds: string[], keyField: string, path: string }

/** The page's content as type and text, in order. */
const content = (project: Project, pageId: string) => project.pages.find(p => p.id === pageId)!.root.children.map(n => ({ type: n.type, text: n.props.text }))

describe('page_create_detail', () => {
  it('adds a page bound to the collection with a Heading on the title and a Text on the body', async () => {
    const { call, project } = await setup()
    const created = await call<Created>('page_create_detail', { collection: 'posts' })
    expect(created).toMatchObject({ slug: 'posts', keyField: 'slug', path: '/posts/:slug' })
    expect(created.nodeIds).toHaveLength(2)
    const doc = await project()
    const page = doc.pages.find(p => p.id === created.pageId)!
    expect(page).toMatchObject({ name: 'Posts', slug: 'posts', collection: { slug: 'posts' } })
    expect(page.root.children.map(n => n.id)).toEqual(created.nodeIds)
    expect(content(doc, created.pageId)).toEqual([
      { type: 'Heading', text: '{{ item.title }}' },
      { type: 'Text', text: '{{ item.body }}' }
    ])
  })

  it('is one undo step that restores the document exactly, and redo brings the page back whole', async () => {
    const { call, project } = await setup()
    const before = strip(await project())
    const created = await call<Created>('page_create_detail', { collection: 'posts' })
    const after = strip(await project())
    expect(await call<{ undo: string | null }>('history_get')).toMatchObject({ undo: 'Create detail page' })
    await call('history_undo')
    expect(strip(await project())).toEqual(before)
    await call('history_redo')
    expect(strip(await project())).toEqual(after)
    expect(content(await project(), created.pageId)).toHaveLength(2)
  })

  it('takes a name and slug, and otherwise picks a name and slug no page has', async () => {
    const { call, project } = await setup()
    expect(await call<Created>('page_create_detail', { collection: 'posts', name: 'Article', slug: 'blog' })).toMatchObject({ slug: 'blog', path: '/blog/:slug' })
    expect(await call<Created>('page_create_detail', { collection: 'posts', name: 'Story' })).toMatchObject({ slug: 'story' })
    await call('page_create_detail', { collection: 'posts' })
    const again = await call<Created>('page_create_detail', { collection: 'posts' })
    expect((await project()).pages.find(p => p.id === again.pageId)).toMatchObject({ name: 'Posts 2', slug: 'posts-2' })
  })

  it('binds the Heading to name, else the URL key, and the Text to another text field, left out without one', async () => {
    const { call, project } = await setup()
    await call('collection_create', { name: 'Users', fields: [{ key: 'name', type: 'text' }, { key: 'email', type: 'text' }] })
    await call('collection_create', { name: 'Tags', fields: [{ key: 'count', type: 'number' }] })
    await call('collection_create', { name: 'Docs', fields: [{ key: 'slug', type: 'text' }, { key: 'summary', type: 'text' }, { key: 'content', type: 'text' }] })
    const users = await call<Created>('page_create_detail', { collection: 'users' })
    const tags = await call<Created>('page_create_detail', { collection: 'tags' })
    const docs = await call<Created>('page_create_detail', { collection: 'docs' })
    const doc = await project()
    expect(content(doc, users.pageId)).toEqual([{ type: 'Heading', text: '{{ item.name }}' }, { type: 'Text', text: '{{ item.email }}' }])
    expect(content(doc, tags.pageId)).toEqual([{ type: 'Heading', text: '{{ item.id }}' }])
    expect(tags).toMatchObject({ keyField: 'id', path: '/tags/:id' })
    expect(content(doc, docs.pageId)).toEqual([{ type: 'Heading', text: '{{ item.slug }}' }, { type: 'Text', text: '{{ item.content }}' }])
  })

  it('takes the collection id', async () => {
    const { call, project } = await setup()
    const posts = (await project()).collections.find(c => c.slug === 'posts')!
    expect(await call<Created>('page_create_detail', { collection: posts.id })).toMatchObject({ slug: 'posts', keyField: 'slug', path: '/posts/:slug' })
  })

  it('gives a collection with no text fields a Heading on the record id at /<page>/:id', async () => {
    const { call, project } = await setup()
    await call('collection_create', { name: 'Nums', fields: [{ key: 'n', type: 'number' }] })
    const created = await call<Created>('page_create_detail', { collection: 'nums' })
    expect(created).toMatchObject({ keyField: 'id', path: '/nums/:id' })
    expect(content(await project(), created.pageId)).toEqual([{ type: 'Heading', text: '{{ item.id }}' }])
  })

  it('keys a connection collection by the record id', async () => {
    const { call } = await setup()
    const { connection } = await call<{ connection: Connection }>('connection_create', { name: 'API', baseUrl: 'https://api.example.com/v1' })
    await call<{ collection: Collection }>('collection_create', { name: 'Remote', source: { type: 'connection', connectionId: connection.id, endpoints: { get: { method: 'GET', path: '/p/{id}' } } }, fields: [{ key: 'title', type: 'text' }] })
    expect(await call<Created>('page_create_detail', { collection: 'remote' })).toMatchObject({ keyField: 'id', path: '/remote/:id' })
  })

  it('takes a field as the URL key, the record id included, in one undo step', async () => {
    const { call, project } = await setup()
    const before = strip(await project())
    const byId = await call<Created & { collection: unknown }>('page_create_detail', { collection: 'posts', field: 'id' })
    expect(byId).toMatchObject({ collection: { slug: 'posts', field: 'id' }, keyField: 'id', path: '/posts/:id' })
    expect(content(await project(), byId.pageId)).toEqual([{ type: 'Heading', text: '{{ item.title }}' }, { type: 'Text', text: '{{ item.body }}' }])
    await call('history_undo')
    expect(strip(await project())).toEqual(before)
    await call('collection_create', { name: 'Notes', fields: [{ key: 'handle', type: 'text' }, { key: 'slug', type: 'text' }] })
    const notes = await call<Created>('page_create_detail', { collection: 'notes', field: 'handle' })
    expect(notes).toMatchObject({ keyField: 'handle', path: '/notes/:handle' })
    expect(content(await project(), notes.pageId)).toEqual([{ type: 'Heading', text: '{{ item.handle }}' }, { type: 'Text', text: '{{ item.slug }}' }])
  })

  it('refuses a URL key that is not a text field, leaving storage untouched', async () => {
    const { call, snap } = await setup()
    const before = await snap()
    for (const field of ['views', 'zzz', '', '__proto__']) {
      await expect(call('page_create_detail', { collection: 'posts', field }), field).rejects.toMatchObject({ code: expect.stringMatching(/^invalid/) })
    }
    expect(await snap()).toBe(before)
  })

  it('refuses an unknown collection and a taken slug, leaving storage untouched', async () => {
    const { call, snap } = await setup()
    await call('page_create_detail', { collection: 'posts' })
    const before = await snap()
    await expect(call('page_create_detail', { collection: 'news' })).rejects.toMatchObject({ code: 'not_found', message: 'Collection "news" not found' })
    await expect(call('page_create_detail', { collection: 'posts', slug: 'posts' })).rejects.toThrow()
    expect(await snap()).toBe(before)
  })
})
