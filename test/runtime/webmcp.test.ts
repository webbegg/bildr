import { describe, expect, it, vi } from 'vitest'
import { getModelContext, registerWebMcpTools } from '#shared/runtime/webmcp'
import type { ModelContext, WebMcpTool } from '#shared/runtime/webmcp'
import { createCollection, createNode, createPage, createProject } from '#shared/document/factory'
import type { Project } from '#shared/document/schema'

function fakeModelContext() {
  const tools = new Map<string, WebMcpTool>()
  const modelContext: ModelContext = {
    registerTool: (tool) => {
      tools.set(tool.name, tool)
    },
    unregisterTool: (name) => {
      tools.delete(name)
    }
  }
  return { modelContext, tools }
}

function setup() {
  const project = createProject('Shop')
  const pricing = createPage('Pricing')
  project.pages.push(pricing)
  project.pages[0]!.root.children.push(
    createNode('Heading', { text: 'Welcome' }),
    createNode('Button', { label: 'See pricing', to: 'pricing' })
  )
  let current = project.pages[0]!
  const navigate = vi.fn((path: string) => {
    current = project.pages.find(p => path.endsWith(`/${p.slug}`))!
  })
  const { modelContext, tools } = fakeModelContext()
  const cleanup = registerWebMcpTools(modelContext, {
    getProject: () => project,
    getCurrentPage: () => current,
    navigate
  })
  const call = async (name: string, input: Record<string, unknown> = {}) => tools.get(name)!.execute(input)
  return { tools, navigate, cleanup, call }
}

describe('registerWebMcpTools', () => {
  it('registers the three published-app tools with their schemas', () => {
    const { tools } = setup()
    expect([...tools.keys()]).toEqual(['list_pages', 'navigate_to_page', 'get_page_content'])
    expect(tools.get('list_pages')!.annotations).toEqual({ readOnlyHint: true })
    expect(tools.get('get_page_content')!.annotations).toEqual({ readOnlyHint: true })
    expect(tools.get('navigate_to_page')!.inputSchema).toEqual({
      type: 'object',
      properties: { slug: { type: 'string', description: expect.any(String) }, key: { type: 'string', description: expect.any(String) } },
      required: ['slug']
    })
  })

  it('list_pages returns each page with its name, slug and url', async () => {
    const { call } = setup()
    const result = await call('list_pages')
    expect(JSON.parse(result.content[0]!.text)).toEqual([
      { name: 'Home', slug: 'home', url: '/p/shop/home' },
      { name: 'Pricing', slug: 'pricing', url: '/p/shop/pricing' }
    ])
  })

  it('navigate_to_page navigates to a known slug', async () => {
    const { call, navigate } = setup()
    const result = await call('navigate_to_page', { slug: 'pricing' })
    expect(navigate).toHaveBeenCalledWith('/p/shop/pricing')
    expect(result.isError).toBeFalsy()
    expect(result.content[0]!.text).toContain('/p/shop/pricing')
  })

  it('navigate_to_page rejects an unknown slug and lists the valid ones', async () => {
    const { call, navigate } = setup()
    const result = await call('navigate_to_page', { slug: 'nope' })
    expect(navigate).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe('Unknown page "nope". Valid slugs: home, pricing')
  })

  it('get_page_content returns the outline of the current page', async () => {
    const { call } = setup()
    expect((await call('get_page_content')).content[0]!.text).toBe([
      'Page "Home" (/home)',
      '  Heading: Welcome',
      '  Button: See pricing → pricing'
    ].join('\n'))
    await call('navigate_to_page', { slug: 'pricing' })
    expect((await call('get_page_content')).content[0]!.text).toBe('Page "Pricing" (/pricing)')
  })

  it('get_page_content outlines component instances as they render', async () => {
    const project = createProject('Shop')
    project.components = [{
      id: 'promo',
      name: 'Promo',
      root: { id: 'r', type: 'Card', props: {}, style: {}, children: [{ id: 't', type: 'Heading', props: { text: 'Default' }, style: {}, children: [] }] },
      properties: [{ id: 'title', name: 'Title', kind: 'text', bindings: [{ nodeId: 't', prop: 'text' }] }],
      variants: []
    }]
    project.pages[0]!.root.children.push({ id: 'i1', type: 'Instance', props: { component: 'promo', title: 'Sale' }, style: {}, children: [] })
    const { modelContext, tools } = fakeModelContext()
    registerWebMcpTools(modelContext, { getProject: () => project, getCurrentPage: () => project.pages[0], navigate: () => {} })
    expect((await tools.get('get_page_content')!.execute({})).content[0]!.text).toBe([
      'Page "Home" (/home)',
      '  Card',
      '    Heading: Sale'
    ].join('\n'))
  })

  it('cleanup unregisters every tool', () => {
    const { tools, cleanup } = setup()
    cleanup()
    expect(tools.size).toBe(0)
  })
})

function cafe() {
  const project = createProject('Café')
  const menu = createCollection('Menu', 'menu', [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'price', label: 'Price', type: 'number' }
  ])
  const messages = createCollection('Messages', 'messages', [
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'message', label: 'Message', type: 'text' }
  ])
  const characters = createCollection('Characters', 'characters', [{ key: 'name', label: 'Name', type: 'text' }], { type: 'api', url: 'https://example.com/api', itemsPath: 'results' })
  const notes = createCollection('Notes', 'notes')
  project.collections.push(
    { ...menu, publicRead: true },
    { ...messages, publicCreate: true },
    { ...characters, publicRead: true, publicCreate: true },
    notes
  )
  return project
}

function dataSetup(project: Project, respond: (url: string, init?: RequestInit) => Response) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => respond(url, init))
  const { modelContext, tools } = fakeModelContext()
  registerWebMcpTools(modelContext, { getProject: () => project, getCurrentPage: () => project.pages[0], navigate: () => {}, fetch })
  const call = async (name: string, input: Record<string, unknown> = {}) => tools.get(name)!.execute(input)
  return { tools, fetch, call }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('list_records', () => {
  const records = { total: 1, records: [{ id: 'r1', createdAt: '', updatedAt: '', values: { name: 'Latte', price: 3 } }] }

  it('is registered read-only for the publicRead collections, listing their slugs and fields', () => {
    const { tools } = dataSetup(cafe(), () => json(records))
    const tool = tools.get('list_records')!
    expect(tool.annotations).toEqual({ readOnlyHint: true })
    expect(tool.description).toContain('menu (name: text, price: number)')
    expect(tool.description).toContain('characters (name: text)')
    expect(tool.description).not.toContain('messages')
    expect(tool.description).not.toContain('notes')
    expect(tool.inputSchema).toMatchObject({ properties: { collection: { type: 'string', enum: ['menu', 'characters'] } }, required: ['collection'] })
  })

  it('reads through the public endpoint with limit, filter and sort', async () => {
    const { call, fetch } = dataSetup(cafe(), () => json(records))
    const result = await call('list_records', { collection: 'menu', limit: 5, filter: { name: 'Latte' }, sort: '-price' })
    expect(fetch).toHaveBeenCalledWith('/api/public/cafe/menu?limit=5&sort=price&dir=desc&filter%5Bname%5D=Latte', undefined)
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0]!.text)).toEqual(records)
  })

  it('asks for everything by default', async () => {
    const { call, fetch } = dataSetup(cafe(), () => json(records))
    await call('list_records', { collection: 'menu' })
    expect(fetch).toHaveBeenCalledWith('/api/public/cafe/menu', undefined)
  })

  it('refuses a collection that is not publicRead without fetching', async () => {
    const { call, fetch } = dataSetup(cafe(), () => json(records))
    const result = await call('list_records', { collection: 'messages' })
    expect(fetch).not.toHaveBeenCalled()
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Unknown collection "messages". Readable collections: menu, characters' }] })
  })

  it('returns the endpoint\'s generic error', async () => {
    const { call } = dataSetup(cafe(), () => json({ statusCode: 502, statusMessage: 'Could not load the data', message: 'Could not load the data' }, 502))
    expect(await call('list_records', { collection: 'characters' })).toEqual({ isError: true, content: [{ type: 'text', text: 'Could not load the data' }] })
  })

  it('is not registered when no collection is publicRead', () => {
    const project = cafe()
    project.collections = project.collections.map(c => ({ ...c, publicRead: false }))
    expect(dataSetup(project, () => json(records)).tools.has('list_records')).toBe(false)
  })
})

describe('submit_form', () => {
  it('is registered for internal publicCreate collections only, listing their slugs and fields', () => {
    const { tools } = dataSetup(cafe(), () => json({ id: 'rec_1' }, 201))
    const tool = tools.get('submit_form')!
    expect(tool.annotations).toBeUndefined()
    expect(tool.description).toContain('messages (email: text, message: text)')
    expect(tool.description).not.toContain('characters')
    expect(tool.description).not.toContain('menu')
    expect(tool.inputSchema).toMatchObject({
      properties: { collection: { type: 'string', enum: ['messages'] }, values: { type: 'object' } },
      required: ['collection', 'values']
    })
  })

  it('posts the values to the public endpoint and returns its result', async () => {
    const { call, fetch } = dataSetup(cafe(), () => json({ id: 'rec_1' }, 201))
    const result = await call('submit_form', { collection: 'messages', values: { email: 'ana@example.com', message: 'Hi' } })
    expect(fetch).toHaveBeenCalledWith('/api/public/cafe/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { email: 'ana@example.com', message: 'Hi' } })
    })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0]!.text)).toEqual({ id: 'rec_1' })
  })

  it('returns the endpoint\'s generic error', async () => {
    const { call } = dataSetup(cafe(), () => json({ statusCode: 422, statusMessage: '"email" must be a string', message: '"email" must be a string' }, 422))
    expect(await call('submit_form', { collection: 'messages', values: { email: 1 } })).toEqual({ isError: true, content: [{ type: 'text', text: '"email" must be a string' }] })
  })

  it('falls back to a generic message when the request fails', async () => {
    const { call } = dataSetup(cafe(), () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await call('submit_form', { collection: 'messages', values: {} })).toEqual({ isError: true, content: [{ type: 'text', text: 'Could not send the form, try again later' }] })
  })

  it('refuses other collections without posting', async () => {
    const { call, fetch } = dataSetup(cafe(), () => json({ id: 'rec_1' }, 201))
    for (const collection of ['characters', 'menu']) {
      expect(await call('submit_form', { collection, values: {} })).toEqual({ isError: true, content: [{ type: 'text', text: `Unknown collection "${collection}". Collections that take new records: messages` }] })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lists publicCreate connection collections, unless their endpoints are known to lack create', () => {
    const project = cafe()
    const posts = createCollection('Posts', 'posts', [{ key: 'title', label: 'Title', type: 'text' }], { type: 'connection', connectionId: 'con_1', endpoints: { list: { method: 'GET', path: '/posts' } } })
    const visitorPosts = { ...posts, slug: 'visitor-posts', publicCreate: true, source: { type: 'connection' as const } }
    const withCreate = { ...posts, slug: 'with-create', publicCreate: true, source: { ...posts.source, endpoints: { create: { method: 'POST' as const, path: '/posts' } } } }
    project.collections.push({ ...posts, publicCreate: true }, visitorPosts as never, withCreate as never)
    const tool = dataSetup(project, () => json({})).tools.get('submit_form')!
    expect(tool.inputSchema).toMatchObject({ properties: { collection: { enum: ['messages', 'visitor-posts', 'with-create'] } } })
  })

  it('is not registered when no internal collection is publicCreate', () => {
    const project = cafe()
    project.collections = project.collections.filter(c => c.slug !== 'messages')
    const { tools } = dataSetup(project, () => json({}))
    expect(tools.has('submit_form')).toBe(false)
    expect(tools.has('list_records')).toBe(true)
  })
})

describe('getModelContext', () => {
  const ctx = (): ModelContext => ({ registerTool: () => {} })

  it('prefers document.modelContext, then navigator.modelContext', () => {
    const fromDocument = ctx()
    const fromNavigator = ctx()
    expect(getModelContext({ modelContext: fromDocument }, { modelContext: fromNavigator })).toBe(fromDocument)
    expect(getModelContext({}, { modelContext: fromNavigator })).toBe(fromNavigator)
  })

  it('returns undefined when WebMCP is absent', () => {
    expect(getModelContext({}, {})).toBeUndefined()
    expect(getModelContext(undefined, undefined)).toBeUndefined()
    expect(getModelContext({ modelContext: {} }, {})).toBeUndefined()
  })
})
