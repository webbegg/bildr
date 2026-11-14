import { describe, expect, it } from 'vitest'
import type { PageFile } from '../../../codegen/src/model/schemas.ts'
import { CANVAS_LINK, renderPlan } from '../../src/canvas/render.ts'
import type { PlanChild, PlanElement } from '../../src/canvas/render.ts'

/**
 * Hostile model content (V6): the canvas renders what a model says, and a
 * model can come from an agent or a hand edit. None of these may reach the
 * DOM as markup, script or a navigation: the render plan (what `ModelNode.vue`
 * turns into vnodes) has a safe tag, an inert link, no unsafe image source,
 * and text as text.
 */

const hostile: PageFile = {
  id: 'pg_hostile',
  name: 'hostile',
  path: '/hostile',
  root: {
    id: 'n_page',
    type: 'Page',
    props: { tag: 'script' },
    children: [
      { id: 'n_link', type: 'Link', props: { href: '\tjavascript:x', text: 'go' } },
      { id: 'n_image', type: 'Image', props: { src: { $bind: 'u' }, alt: 'x' } },
      { id: 'n_text', type: 'Text', props: { text: '<img src=x onerror=alert(1)>' } }
    ]
  }
}

const all = (children: PlanChild[], out: PlanElement[] = []): PlanElement[] => {
  for (const child of children) {
    if (typeof child === 'string') continue
    out.push(child)
    all(child.children, out)
  }
  return out
}
const byNode = (elements: PlanElement[], id: string) => all(elements).find(element => element.node === id)!

describe('hostile model content in the render plan', () => {
  const elements = renderPlan({ file: hostile, components: [], layouts: [], data: { u: 'javascript:x' } })

  it('a container tag outside the allowed set renders as a div, never a script', () => {
    expect(byNode(elements, 'n_page').tag).toBe('div')
    expect(all(elements).some(element => element.tag.toLowerCase() === 'script')).toBe(false)
  })

  it('a javascript: link (leading whitespace and all) is the inert canvas link', () => {
    expect(byNode(elements, 'n_link').attrs.to).toBe(CANVAS_LINK)
  })

  it('an image whose bound source is a javascript: URL has no src', () => {
    expect(byNode(elements, 'n_image').attrs.src).toBeUndefined()
  })

  it('text with markup is a literal string, not an element', () => {
    const text = byNode(elements, 'n_text')
    expect(text.children).toEqual(['<img src=x onerror=alert(1)>'])
    expect(all(elements).some(element => element.tag.toLowerCase() === 'img' && element.attrs.onerror !== undefined)).toBe(false)
  })
})
