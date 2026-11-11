import { describe, expect, it } from 'vitest'
import type { DocNode, Layout, Project } from '#shared/document/schema'
import { createProject } from '#shared/document/factory'
import { createLimiter, ThumbnailCache, thumbnailFit, thumbnailSignature, thumbnailSource } from '#shared/editor/thumbnails'
import { layoutDragPayload, parseLayoutPayload } from '../../app/composables/layoutEditor'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = []): DocNode => ({ id, type, props, style: {}, children })

/** A Card component nesting a Badge, an unrelated Logo, and a layout with a Card instance. */
function project(): Project {
  const p = createProject('Demo')
  p.components = [
    { id: 'cmp_badge', name: 'Badge', root: n('b', 'Text', { text: 'New' }), properties: [], variants: [] },
    { id: 'cmp_card', name: 'Card', root: n('c', 'Card', {}, [n('ci', 'Instance', { component: 'cmp_badge' })]), properties: [], variants: [] },
    { id: 'cmp_logo', name: 'Logo', root: n('l', 'Text', { text: 'Logo' }), properties: [], variants: [] }
  ]
  const layout: Layout = { id: 'lay', name: 'Site', root: n('lr', 'Page', {}, [n('li', 'Instance', { component: 'cmp_card' }), n('ls', 'Container')]), slots: [{ id: 'children', name: 'Content', nodeId: 'ls' }], variables: [] }
  p.layouts = [layout]
  return p
}

describe('thumbnailSource', () => {
  it('renders a component definition on a page of its own (measured at its natural size), or a layout tree as the page, with the definitions it uses', () => {
    const p = project()
    const card = thumbnailSource(p, 'component', 'cmp_card')!
    expect(card.page).toMatchObject({ id: 'cmp_card', name: 'Card', root: { type: 'Page', children: [{ id: 'c' }] } })
    expect(card.measureId).toBe('c')
    expect(card.components.map(c => c.id)).toEqual(['cmp_badge'])
    expect(card.width).toBe(390)
    const site = thumbnailSource(p, 'layout', 'lay')!
    expect(site.page).toMatchObject({ id: 'lay', root: { id: 'lr' } })
    expect(site.measureId).toBe('lr')
    expect(site.components.map(c => c.id)).toEqual(['cmp_badge', 'cmp_card'])
    expect(site.width).toBe(1280)
    expect(thumbnailSource(p, 'component', 'cmp_missing')).toBeNull()
  })
})

describe('thumbnailSignature', () => {
  it('changes when what the thumbnail shows changes, and only then', () => {
    const p = project()
    const theme = p.theme
    const card = (q: Project) => thumbnailSignature(thumbnailSource(q, 'component', 'cmp_card')!, theme, false)
    const before = card(p)
    expect(card(project())).toBe(before)
    const logoEdited = project()
    logoEdited.components[2]!.root.props.text = 'Brand'
    expect(card(logoEdited)).toBe(before)
    const badgeEdited = project()
    badgeEdited.components[0]!.root.props.text = 'Hot'
    expect(card(badgeEdited)).not.toBe(before)
    expect(thumbnailSignature(thumbnailSource(p, 'component', 'cmp_card')!, theme, true)).not.toBe(before)
    expect(thumbnailSignature(thumbnailSource(p, 'component', 'cmp_card')!, { ...theme, radius: theme.radius === '0' ? '1rem' : '0' }, false)).not.toBe(before)
  })
})

describe('thumbnailFit', () => {
  it('scales the rendered box down to fit the tile, centred, never up', () => {
    expect(thumbnailFit({ x: 0, y: 0, width: 400, height: 100 }, { width: 100, height: 60 })).toEqual({ scale: 0.25, x: 0, y: 17.5 })
    expect(thumbnailFit({ x: 0, y: 0, width: 50, height: 20 }, { width: 100, height: 60 })).toEqual({ scale: 1, x: 25, y: 20 })
    expect(thumbnailFit({ x: 10, y: 20, width: 200, height: 240 }, { width: 100, height: 60 })).toEqual({ scale: 0.25, x: 22.5, y: -5 })
    expect(thumbnailFit({ x: 0, y: 0, width: 0, height: 0 }, { width: 100, height: 60 })).toEqual({ scale: 1, x: 0, y: 0 })
  })
})

describe('ThumbnailCache', () => {
  it('keeps the most recently used entries', () => {
    const cache = new ThumbnailCache<string>(2)
    cache.set('a', 'A')
    cache.set('b', 'B')
    expect(cache.get('a')).toBe('A')
    cache.set('c', 'C')
    expect(cache.get('b')).toBeUndefined()
    expect([cache.get('a'), cache.get('c')]).toEqual(['A', 'C'])
  })
})

describe('createLimiter', () => {
  it('runs at most `max` holders at a time, the waiting ones in order, and ignores a second release', async () => {
    const limit = createLimiter(2)
    const order: string[] = []
    const take = (name: string) => limit().then((release) => {
      order.push(name)
      return release
    })
    const a = await take('a')
    const b = await take('b')
    const c = take('c')
    const d = take('d')
    await Promise.resolve()
    expect(order).toEqual(['a', 'b'])
    a()
    a()
    const releaseC = await c
    await Promise.resolve()
    expect(order).toEqual(['a', 'b', 'c'])
    b()
    await d
    expect(order).toEqual(['a', 'b', 'c', 'd'])
    releaseC()
  })
})

describe('layout drag payload', () => {
  it('round-trips a layout id and ignores other payloads', () => {
    expect(parseLayoutPayload(layoutDragPayload('lay'))).toBe('lay')
    expect(parseLayoutPayload(JSON.stringify({ kind: 'instance', componentId: 'c' }))).toBeNull()
    expect(parseLayoutPayload('nope')).toBeNull()
  })
})
