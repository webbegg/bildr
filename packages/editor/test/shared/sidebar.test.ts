import { describe, expect, it } from 'vitest'
import type { ModelNode } from '@bildr/codegen/model'
import { sameComponentNodes, sameTypeNodes } from '../../src/editor/selection.ts'
import { INSERT_TOOLS, toolHint } from '../../src/editor/tools.ts'
import { filterByName, filterLayers, filterPages, pageOptionLabel, pageRowLabel } from '../../src/shared/sidebar.ts'

/** Ported from the hosted `test/editor/sidebar.test.ts` (and its `sameTypeNodes`/`toolHint` cases), over the model's pages (`path`, not `slug`). */

const n = (id: string, type: string, props: ModelNode['props'] = {}, children: ModelNode[] = []): ModelNode => ({ id, type, props, ...(children.length ? { children } : {}) })

describe('filterPages', () => {
  const pages = [{ name: 'index', path: '/' }, { name: 'about-us', path: '/about' }, { name: 'pricing', path: '/pricing' }]

  it('keeps the pages whose name or path contains the query, ignoring case and outer spaces', () => {
    expect(filterPages(pages, 'ABOUT').map(page => page.name)).toEqual(['about-us'])
    expect(filterPages(pages, ' us ').map(page => page.name)).toEqual(['about-us'])
    expect(filterPages(pages, 'pric').map(page => page.path)).toEqual(['/pricing'])
    expect(filterPages(pages, 'blog')).toEqual([])
  })

  it('keeps every page for an empty query', () => {
    expect(filterPages(pages, '  ')).toEqual(pages)
  })

  it('matches the path a page row shows', () => {
    expect(filterPages(pages, '/pric').map(page => page.path)).toEqual(['/pricing'])
  })
})

describe('pageRowLabel', () => {
  it('names pages by path, like Framer, with Home for the home page (the path /)', () => {
    expect(pageRowLabel({ name: 'pricing', path: '/pricing' }, false)).toEqual({ path: '/pricing' })
    expect(pageRowLabel({ name: 'index', path: '/' }, true)).toEqual({ path: 'Home' })
    expect(pageRowLabel({ name: 'home', path: '/' }, true)).toEqual({ path: 'Home' })
  })

  it('adds the page name when the path does not say it', () => {
    expect(pageRowLabel({ name: 'plans', path: '/pricing' }, false)).toEqual({ path: '/pricing', hint: 'plans' })
    expect(pageRowLabel({ name: 'about-us', path: '/about-us' }, false)).toEqual({ path: '/about-us' })
    expect(pageRowLabel({ name: 'post-detail', path: '/posts/:slug' }, false)).toEqual({ path: '/posts/:slug', hint: 'post-detail' })
    expect(pageRowLabel({ name: 'landing', path: '/' }, true)).toEqual({ path: 'Home', hint: 'landing' })
  })
})

describe('pageOptionLabel', () => {
  it('names a page in a select the way the sidebar does: Home, or its path, and its name when the path does not say it', () => {
    expect(pageOptionLabel({ name: 'index', path: '/' })).toBe('Home')
    expect(pageOptionLabel({ name: 'pricing', path: '/pricing' })).toBe('/pricing')
    expect(pageOptionLabel({ name: 'posts-slug', path: '/posts/:slug' })).toBe('/posts/:slug')
    expect(pageOptionLabel({ name: 'post-detail', path: '/posts/:slug' })).toBe('/posts/:slug · post-detail')
    expect(pageOptionLabel({ name: 'landing', path: '/' })).toBe('Home · landing')
  })
})

describe('filterLayers', () => {
  const tree = () => {
    const button = n('button', 'Button', { label: 'Order now' })
    const row = n('row', 'Row', {}, [button])
    const text = n('text', 'Text', { text: 'Fresh coffee daily' })
    const card = n('card', 'Card', {}, [text, row])
    const heading = n('heading', 'Heading', { text: 'Welcome' })
    return n('root', 'Page', {}, [heading, card])
  }

  it('shows the rows whose type or text matches, with their ancestors', () => {
    expect(filterLayers(tree(), 'order')).toEqual(new Set(['root', 'card', 'row', 'button']))
    expect(filterLayers(tree(), 'BUTTON')).toEqual(new Set(['root', 'card', 'row', 'button']))
  })

  it('keeps a matching container without its non-matching children', () => {
    expect(filterLayers(tree(), 'card')).toEqual(new Set(['root', 'card']))
  })

  it('is empty without a match and null (show everything) for an empty query', () => {
    expect(filterLayers(tree(), 'zebra')).toEqual(new Set())
    expect(filterLayers(tree(), '')).toBeNull()
  })
})

describe('filterByName', () => {
  it('keeps the assets whose name matches', () => {
    const assets = [{ name: 'Menu' }, { name: 'Contact messages' }, { name: 'primary' }]
    expect(filterByName(assets, 'MESS')).toEqual([{ name: 'Contact messages' }])
    expect(filterByName(assets, 'x')).toEqual([])
    expect(filterByName(assets, '')).toEqual(assets)
  })
})

describe('Select ▸ Same type / Same component', () => {
  const root = n('root', 'Page', {}, [n('t1', 'Text'), n('card', 'Card', {}, [n('t2', 'Text'), n('i1', 'Instance', { component: 'cmp_a' })]), n('i2', 'Instance', { component: 'cmp_a' }), n('i3', 'Instance', { component: 'cmp_b' })])

  it('selects every node of the type, in document order', () => {
    expect(sameTypeNodes(root, 't2')).toEqual(['t1', 't2'])
    expect(sameTypeNodes(root, 'missing')).toEqual([])
  })

  it('selects every instance of the component, and nothing from a non-instance', () => {
    expect(sameComponentNodes(root, 'i1')).toEqual(['i1', 'i2'])
    expect(sameComponentNodes(root, 'i3')).toEqual(['i3'])
    expect(sameComponentNodes(root, 't1')).toEqual([])
  })
})

describe('toolHint', () => {
  it('names an armed insert tool, and says nothing for Move and Hand', () => {
    expect(toolHint('Container')).toBe('Frame · click to insert · Esc')
    expect(toolHint('Text')).toBe('Text · click to insert · Esc')
    expect(toolHint('move')).toBeNull()
    expect(toolHint('hand')).toBeNull()
    expect(INSERT_TOOLS.find(tool => tool.id === 'hand')?.keys).toEqual(['H'])
  })
})
