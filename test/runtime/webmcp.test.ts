import { describe, expect, it, vi } from 'vitest'
import { getModelContext, registerWebMcpTools } from '#shared/runtime/webmcp'
import type { ModelContext, WebMcpTool } from '#shared/runtime/webmcp'
import { createNode, createPage, createProject } from '#shared/document/factory'

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
      properties: { slug: { type: 'string', description: expect.any(String) } },
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

  it('cleanup unregisters every tool', () => {
    const { tools, cleanup } = setup()
    cleanup()
    expect(tools.size).toBe(0)
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
