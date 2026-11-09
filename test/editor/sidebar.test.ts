import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { filterByName, filterLayers, filterPages } from '#shared/editor/sidebar'

describe('filterPages', () => {
  const pages = [createPage('Home'), createPage('About us', 'about'), createPage('Pricing')]

  it('keeps the pages whose name or slug contains the query, ignoring case and outer spaces', () => {
    expect(filterPages(pages, 'ABOUT').map(p => p.name)).toEqual(['About us'])
    expect(filterPages(pages, ' us ').map(p => p.name)).toEqual(['About us'])
    expect(filterPages(pages, 'pric').map(p => p.slug)).toEqual(['pricing'])
    expect(filterPages(pages, 'blog')).toEqual([])
  })

  it('keeps every page for an empty query', () => {
    expect(filterPages(pages, '  ')).toEqual(pages)
  })
})

describe('filterLayers', () => {
  function fixture() {
    const page = createPage('Home')
    const heading = createNode('Heading', { text: 'Welcome' })
    const card = createNode('Card')
    const row = createNode('Row')
    const button = createNode('Button', { label: 'Order now' })
    row.children.push(button)
    card.children.push(createNode('Text', { text: 'Fresh coffee daily' }), row)
    page.root.children.push(heading, card)
    return { root: page.root, heading, card, row, button, text: card.children[0]! }
  }

  it('shows the rows whose type or text matches, with their ancestors', () => {
    const { root, card, row, button } = fixture()
    expect(filterLayers(root, 'order')).toEqual(new Set([root.id, card.id, row.id, button.id]))
    expect(filterLayers(root, 'BUTTON')).toEqual(new Set([root.id, card.id, row.id, button.id]))
  })

  it('keeps a matching container without its non-matching children', () => {
    const { root, card } = fixture()
    expect(filterLayers(root, 'card')).toEqual(new Set([root.id, card.id]))
  })

  it('is empty without a match and null (show everything) for an empty query', () => {
    const { root } = fixture()
    expect(filterLayers(root, 'zebra')).toEqual(new Set())
    expect(filterLayers(root, '')).toBeNull()
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
