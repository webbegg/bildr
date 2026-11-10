import { describe, expect, it } from 'vitest'
import type { ComponentDefinition, DocNode, Layout, Page } from '#shared/document/schema'
import { resolveBindings, resolveLayoutRefs } from '#shared/runtime/bindings'
import { isDefinitionNodeId, pageNodeId } from '#shared/runtime/instances'
import { isLayoutNodeId, resolvePageWithLayout } from '#shared/runtime/layouts'
import { listNodes } from '#shared/runtime/list'
import { registerWebMcpTools } from '#shared/runtime/webmcp'
import type { WebMcpTool } from '#shared/runtime/webmcp'
import { createProject } from '#shared/document/factory'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })
const find = (root: DocNode, id: string): DocNode | undefined => root.id === id ? root : root.children.map(c => find(c, id)).find(Boolean)

function main(): Layout {
  return {
    id: 'main',
    name: 'Main',
    root: n('l-root', 'Page', {}, [
      n('l-title', 'Heading', { text: 'Welcome to {{ layout.Title }}' }),
      n('l-badge', 'Text', { text: 'Default badge' }),
      n('l-main', 'Container', {}, [n('l-hint', 'Text', { text: 'never shown' })], { p: '6' }),
      n('l-foot', 'Container', {}, [n('l-copy', 'Text', { text: '© bildr' })])
    ], { gap: '0' }),
    slots: [
      { id: 'children', name: 'Content', nodeId: 'l-main' },
      { id: 'footer', name: 'Footer', nodeId: 'l-foot' }
    ],
    variables: [
      { id: 'title', name: 'Title', kind: 'text', default: 'Site', bindings: [] },
      { id: 'badge', name: 'Badge', kind: 'text', bindings: [{ nodeId: 'l-badge', prop: 'text' }] }
    ]
  }
}

function page(extra: Partial<Page> = {}, children: DocNode[] = [n('h', 'Heading', { text: 'Hi' })]): Page {
  return { id: 'p1', name: 'Home', slug: 'home', root: n('proot', 'Page', {}, children, { gap: '4' }), ...extra }
}

describe('resolvePageWithLayout', () => {
  it('returns the page root itself for a page without a layout', () => {
    const p = page()
    expect(resolvePageWithLayout(p, [main()], [])).toBe(p.root)
  })

  it('renders the layout around the page content, layout ids namespaced under the page root', () => {
    const p = page({ layoutId: 'main' })
    const tree = resolvePageWithLayout(p, [main()], [])
    expect(tree.type).toBe('Page')
    expect(tree.id).toBe('proot/@l-root')
    expect(tree.style).toEqual({ gap: '0' })
    expect(tree.children.map(c => c.id)).toEqual(['proot/@l-title', 'proot/@l-badge', 'proot', 'proot/@l-foot'])
    const content = tree.children[2]!
    expect(content.type).toBe('Container')
    expect(content.style).toEqual({ p: '6' })
    expect(content.children).toEqual(p.root.children)
    expect(content.children[0]).toBe(p.root.children[0])
  })

  it('maps layout nodes to the page root and marks them as not editable', () => {
    const tree = resolvePageWithLayout(page({ layoutId: 'main' }), [main()], [])
    for (const id of ['proot/@l-root', 'proot/@l-title', 'proot/@l-copy']) {
      expect(find(tree, id)).toBeDefined()
      expect(pageNodeId(id)).toBe('proot')
      expect(isDefinitionNodeId(id)).toBe(true)
      expect(isLayoutNodeId(id)).toBe(true)
    }
    expect(isLayoutNodeId('proot')).toBe(false)
    expect(isLayoutNodeId('i1/title')).toBe(false)
  })

  it('falls back to a named slot\'s default content, or shows the page\'s fill in its place', () => {
    const empty = resolvePageWithLayout(page({ layoutId: 'main' }), [main()], [])
    expect(find(empty, 'proot/@l-foot')!.children.map(c => c.id)).toEqual(['proot/@l-copy'])

    const fill = n('f', 'SlotFill', { slot: 'footer' }, [n('ft', 'Text', { text: 'Own footer' })])
    const filled = resolvePageWithLayout(page({ layoutId: 'main' }, [n('h', 'Heading'), fill]), [main()], [])
    expect(find(filled, 'proot/@l-foot')).toBeUndefined()
    const footer = find(filled, 'f')!
    expect(footer.type).toBe('Container')
    expect(footer.children).toEqual(fill.children)
    expect(find(filled, 'proot')!.children.map(c => c.id)).toEqual(['h'])
  })

  it('sets layout variables per page, else their default', () => {
    const own = resolvePageWithLayout(page({ layoutId: 'main', layoutValues: { title: 'Cafe', badge: 'New' } }), [main()], [])
    expect(find(own, 'proot/@l-title')!.props.text).toBe('Welcome to Cafe')
    expect(find(own, 'proot/@l-badge')!.props.text).toBe('New')

    const defaults = resolvePageWithLayout(page({ layoutId: 'main' }), [main()], [])
    expect(find(defaults, 'proot/@l-title')!.props.text).toBe('Welcome to Site')
    expect(find(defaults, 'proot/@l-badge')!.props.text).toBe('Default badge')
  })

  it('shows a layout edit of a bound prop on every page without a stored default, and keeps a stored default over it', () => {
    const layout = main()
    layout.root.children[1]!.props.text = 'Edited badge'
    expect(find(resolvePageWithLayout(page({ layoutId: 'main' }), [layout], []), 'proot/@l-badge')!.props.text).toBe('Edited badge')
    expect(find(resolvePageWithLayout(page({ layoutId: 'main', layoutValues: { badge: 'Own' } }), [layout], []), 'proot/@l-badge')!.props.text).toBe('Own')
    layout.variables[1]!.default = 'Stored'
    expect(find(resolvePageWithLayout(page({ layoutId: 'main' }), [layout], []), 'proot/@l-badge')!.props.text).toBe('Stored')
  })

  it('renders a known variable without value empty and keeps unknown refs as written', () => {
    const layout = main()
    layout.root.children[0]!.props.text = '{{ layout.Badge }}|{{ layout.Nope }}|{{ item.name }}'
    const tree = resolvePageWithLayout(page({ layoutId: 'main' }), [layout], [])
    expect(find(tree, 'proot/@l-title')!.props.text).toBe('|{{ layout.Nope }}|{{ item.name }}')
  })

  it('resolves component instances in the layout, their ids under the layout namespace', () => {
    const nav: ComponentDefinition = {
      id: 'nav',
      name: 'Nav',
      root: n('nr', 'Container', {}, [n('nt', 'Text', { text: 'x' })]),
      properties: [{ id: 'label', name: 'Label', kind: 'text', bindings: [{ nodeId: 'nt', prop: 'text' }] }],
      variants: []
    }
    const layout = main()
    layout.root.children.unshift(n('l-nav', 'Instance', { component: 'nav', label: '{{ layout.Title }}' }))
    const tree = resolvePageWithLayout(page({ layoutId: 'main', layoutValues: { title: 'Cafe' } }), [layout], [nav])
    const text = find(tree, 'proot/@l-nav/nt')!
    expect(text.props.text).toBe('Cafe')
    expect(pageNodeId(text.id)).toBe('proot')
    expect(isLayoutNodeId(text.id)).toBe(true)
  })

  it('leaves page instances in the content for the renderer', () => {
    const inst = n('i1', 'Instance', { component: 'nav' })
    const tree = resolvePageWithLayout(page({ layoutId: 'main' }, [inst]), [main()], [])
    expect(find(tree, 'proot')!.children).toEqual([inst])
  })

  it('renders the page without its slot fills when the layout is missing', () => {
    const p = page({ layoutId: 'gone' }, [n('h', 'Heading'), n('f', 'SlotFill', { slot: 'footer' })])
    const tree = resolvePageWithLayout(p, [main()], [])
    expect(tree.id).toBe('proot')
    expect(tree.children.map(c => c.id)).toEqual(['h'])
  })

  it('does not change the layout or the page', () => {
    const layout = main()
    const p = page({ layoutId: 'main', layoutValues: { title: 'X' } }, [n('h', 'Heading'), n('f', 'SlotFill', { slot: 'footer' })])
    const before = JSON.stringify([layout, p])
    resolvePageWithLayout(p, [layout], [])
    expect(JSON.stringify([layout, p])).toBe(before)
  })

  it('lets list discovery see Lists in the layout', () => {
    const layout = main()
    layout.root.children.push(n('l-list', 'List', { collection: 'news' }))
    const tree = resolvePageWithLayout(page({ layoutId: 'main' }), [layout], [])
    expect(listNodes(tree).map(node => node.id)).toEqual(['proot/@l-list'])
  })
})

describe('{{ layout.NAME }} refs', () => {
  it('resolves only layout refs', () => {
    expect(resolveLayoutRefs('{{ layout.Title }} {{ item.x }} {{ prop.P }} {{layout.Site name}}', { 'Title': 'A', 'Site name': 'B' })).toBe('A {{ item.x }} {{ prop.P }} B')
  })

  it('stays literal in the render-time pass', () => {
    expect(resolveBindings('{{ layout.Title }}', {})).toBe('{{ layout.Title }}')
  })
})

describe('WebMCP get_page_content with a layout', () => {
  it('outlines the page as it renders inside its layout', async () => {
    const project = createProject('Shop')
    project.layouts = [main()]
    const home = project.pages[0]!
    home.layoutId = 'main'
    home.layoutValues = { title: 'Cafe' }
    home.root.children = [n('h', 'Heading', { text: 'Hi' })]
    const tools = new Map<string, WebMcpTool>()
    registerWebMcpTools({ registerTool: t => void tools.set(t.name, t), unregisterTool: () => {} }, { getProject: () => project, getCurrentPage: () => home, navigate: () => {} })
    expect((await tools.get('get_page_content')!.execute({})).content[0]!.text).toBe([
      'Page "Home" (/home)',
      '  Heading: Welcome to Cafe',
      '  Text: Default badge',
      '  Container',
      '    Heading: Hi',
      '  Container',
      '    Text: © bildr'
    ].join('\n'))
  })
})
