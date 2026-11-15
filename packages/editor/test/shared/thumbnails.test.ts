import { describe, expect, it } from 'vitest'
import type { ComponentFile, LayoutFile, Model, ModelNode } from '@bildr/codegen/model'
import { DEFAULT_THEME } from '@bildr/codegen/design'
import { createLimiter, ThumbnailCache, thumbnailFit, thumbnailSignature, thumbnailSource } from '../../src/shared/thumbnails.ts'

/** Ported from the hosted `test/editor/thumbnails.test.ts`, over the model's component and layout files. */

const n = (id: string, type: string, props: ModelNode['props'] = {}, children: ModelNode[] = []): ModelNode => ({ id, type, props, ...(children.length ? { children } : {}) })

/** A Card component nesting a Badge, an unrelated Logo, and a layout with a Card instance. */
const model = (): Pick<Model, 'modules' | 'layouts'> => {
  const component = (id: string, name: string, root: ModelNode) => ({ id, name, properties: [], variants: [], root }) as unknown as ComponentFile
  const layout = { id: 'lay', name: 'site', root: n('lr', 'Page', {}, [n('li', 'Instance', { component: 'cmp_card' }), n('ls', 'Container')]), slots: [{ id: 'children', name: 'Content', nodeId: 'ls' }] } as unknown as LayoutFile
  return {
    modules: { app: { components: [component('cmp_badge', 'Badge', n('b', 'Text', { text: 'New' })), component('cmp_card', 'Card', n('c', 'Card', {}, [n('ci', 'Instance', { component: 'cmp_badge' })])), component('cmp_logo', 'Logo', n('l', 'Text', { text: 'Logo' }))], pages: [] } },
    layouts: [layout]
  } as unknown as Pick<Model, 'modules' | 'layouts'>
}

describe('thumbnailSource', () => {
  it('renders a component as one instance on a page of its own, or a layout around an empty page, with the definitions it uses', () => {
    const m = model()
    const card = thumbnailSource(m, 'component', 'cmp_card')!
    expect(card.file.root).toMatchObject({ type: 'Page', children: [{ type: 'Instance', props: { component: 'cmp_card' } }] })
    expect(card.measureId).toBe(card.file.root.children![0]!.id)
    expect(card.components.map(c => c.id)).toEqual(['cmp_badge', 'cmp_card'])
    expect(card.layouts).toEqual([])
    expect(card.width).toBe(390)
    const site = thumbnailSource(m, 'layout', 'lay')!
    expect(site.file).toMatchObject({ layout: 'lay', root: { type: 'Page' } })
    expect(site.layouts.map(l => l.id)).toEqual(['lay'])
    expect(site.measureId).toBe('lr')
    expect(site.components.map(c => c.id)).toEqual(['cmp_badge', 'cmp_card'])
    expect(site.width).toBe(1280)
    expect(thumbnailSource(m, 'component', 'cmp_missing')).toBeNull()
  })
})

describe('thumbnailSignature', () => {
  it('changes when what the thumbnail shows changes, and only then', () => {
    const card = (m: ReturnType<typeof model>) => thumbnailSignature(thumbnailSource(m, 'component', 'cmp_badge')!, DEFAULT_THEME, false)
    const before = card(model())
    expect(card(model())).toBe(before)
    const logoEdited = model()
    logoEdited.modules.app!.components[2]!.root.props!.text = 'Brand'
    expect(card(logoEdited)).toBe(before)
    const badgeEdited = model()
    badgeEdited.modules.app!.components[0]!.root.props!.text = 'Hot'
    expect(card(badgeEdited)).not.toBe(before)
    const source = thumbnailSource(model(), 'component', 'cmp_badge')!
    expect(thumbnailSignature(source, DEFAULT_THEME, true)).not.toBe(thumbnailSignature(source, DEFAULT_THEME, false))
    expect(thumbnailSignature(source, { ...DEFAULT_THEME, radius: '1rem' }, false)).not.toBe(thumbnailSignature(source, DEFAULT_THEME, false))
  })
})

describe('thumbnailFit', () => {
  it('scales a box down to fit the tile, never up, and centres it', () => {
    const tile = { width: 104, height: 60 }
    expect(thumbnailFit({ x: 0, y: 0, width: 208, height: 60 }, tile)).toEqual({ scale: 0.5, x: 0, y: 15 })
    expect(thumbnailFit({ x: 10, y: 5, width: 52, height: 30 }, tile)).toEqual({ scale: 1, x: 16, y: 10 })
    expect(thumbnailFit({ x: 0, y: 0, width: 0, height: 0 }, tile)).toEqual({ scale: 1, x: 0, y: 0 })
  })
})

describe('createLimiter', () => {
  it('lets at most `max` holders in, first come first served, and a double release frees one slot', async () => {
    const take = createLimiter(1)
    const first = await take()
    let second = false
    const waiting = take().then((release) => {
      second = true
      return release
    })
    await Promise.resolve()
    expect(second).toBe(false)
    first()
    first()
    await waiting
    expect(second).toBe(true)
  })
})

describe('ThumbnailCache', () => {
  it('keeps the most recently used entries', () => {
    const cache = new ThumbnailCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect([cache.get('a'), cache.get('c')]).toEqual([1, 3])
  })
})
