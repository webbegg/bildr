import { describe, expect, it, vi } from 'vitest'
import { registerWebMcpTools } from '#shared/runtime/webmcp'
import type { ModelContext, WebMcpTool } from '#shared/runtime/webmcp'
import type { BindingItem } from '#shared/runtime/bindings'
import { createCollection, createNode, createPage, createProject } from '#shared/document/factory'
import type { Page } from '#shared/document/schema'

/** A blog: Home with a List of posts, and a Post detail page (heading and body bound to the record). */
function setup() {
  const project = createProject('Blog')
  project.collections.push({ ...createCollection('Posts', 'posts', [{ key: 'title', label: 'Title', type: 'text' }, { key: 'slug', label: 'Slug', type: 'text' }]), publicRead: true })
  const post: Page = { ...createPage('Post', 'post'), collection: { slug: 'posts' } }
  const list = createNode('List', { collection: 'posts' })
  list.children.push(createNode('Link', { label: '{{ item.title }}', to: 'post/{{ item.slug }}' }))
  post.root.children.push(createNode('Heading', { text: '{{ item.title }}' }), createNode('Text', { text: 'Slug: {{ item.slug }}' }), list)
  project.pages.push(post)
  let current: Page = project.pages[0]!
  let record: BindingItem | null = null
  const navigate = vi.fn((path: string) => {
    current = project.pages.find(p => path.includes(`/${p.slug}`))!
    record = current.collection ? { id: 'r1', title: 'Hello', slug: decodeURIComponent(path.split('/').at(-1)!) } : null
  })
  const tools = new Map<string, WebMcpTool>()
  const modelContext: ModelContext = { registerTool: tool => void tools.set(tool.name, tool) }
  registerWebMcpTools(modelContext, { getProject: () => project, getCurrentPage: () => current, getCurrentRecord: () => record, navigate })
  const call = async (name: string, input: Record<string, unknown> = {}) => tools.get(name)!.execute(input)
  return { call, navigate, tools }
}

describe('WebMCP on detail pages', () => {
  it('list_pages marks detail pages with their collection, key field and URL pattern', async () => {
    const { call } = setup()
    expect(JSON.parse((await call('list_pages')).content[0]!.text)).toEqual([
      { name: 'Home', slug: 'home', url: '/p/blog/home' },
      { name: 'Post', slug: 'post', url: '/p/blog/post/:slug', collection: 'posts', keyField: 'slug' }
    ])
  })

  it('navigate_to_page takes the key of a detail page, and needs it there only', async () => {
    const { call, navigate, tools } = setup()
    expect(tools.get('navigate_to_page')!.inputSchema).toMatchObject({ properties: { slug: { type: 'string' }, key: { type: 'string' } }, required: ['slug'] })
    expect(await call('navigate_to_page', { slug: 'post', key: 'hello world' })).toEqual({ content: [{ type: 'text', text: 'Navigated to /p/blog/post/hello%20world' }] })
    expect(navigate).toHaveBeenLastCalledWith('/p/blog/post/hello%20world')
    const missing = await call('navigate_to_page', { slug: 'post' })
    expect(missing).toMatchObject({ isError: true, content: [{ text: 'Page "post" shows one record of "posts": give its key (the slug), e.g. from list_records' }] })
    const extra = await call('navigate_to_page', { slug: 'home', key: 'x' })
    expect(extra).toMatchObject({ isError: true, content: [{ text: 'Page "home" takes no key' }] })
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('get_page_content outlines the current record\'s values, a List keeping its own items', async () => {
    const { call } = setup()
    await call('navigate_to_page', { slug: 'post', key: 'hello' })
    expect((await call('get_page_content')).content[0]!.text).toBe([
      'Page "Post" (/p/blog/post/hello)',
      '  Heading: Hello',
      '  Text: Slug: hello',
      '  List',
      '    Link: {{ item.title }} → post/{{ item.slug }}'
    ].join('\n'))
  })
})
