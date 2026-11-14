import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import { pageNodeId, renderPlan } from '../../src/canvas/render.ts'
import type { PlanChild, PlanElement, RenderInput } from '../../src/canvas/render.ts'
import { blogModelFiles } from './fixture.ts'

/** What the canvas adds to the generated app's markup: node ids, placeholders for missing data, list copies. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const fixture = loaded.model
const blog = fixture.modules.blog!
const page = (name: string) => blog.pages.find(entry => entry.name === name)!

const plan = (file: RenderInput['file'], data: Record<string, unknown> = {}) => renderPlan({ file, components: blog.components, layouts: fixture.layouts, data })
const all = (children: PlanChild[], out: PlanElement[] = []): PlanElement[] => {
  for (const child of children) {
    if (typeof child === 'string') continue
    out.push(child)
    all(child.children, out)
  }
  return out
}
const byNode = (children: PlanChild[], id: string) => all(children).filter(element => element.node === id)
const textOf = (element: PlanElement): string => element.children.map(child => typeof child === 'string' ? child : textOf(child)).join('')

describe('canvas node ids', () => {
  // `posts` is the page's computed alias: `featured` unless `preferences.showDrafts`.
  const elements = plan(page('index'), { preferences: { showDrafts: false }, featured: [{ id: 'a', title: 'A', slug: 'a' }, { id: 'b', title: 'B', slug: 'b' }], quotes: [] })

  it('page nodes keep their ids; layout nodes are <page root>/@<node>', () => {
    expect(byNode(elements, 'n_h1')[0]!.tag).toBe('h1')
    expect(byNode(elements, 'n_page/@n_header')[0]).toMatchObject({ tag: 'header', type: 'Layout' })
    expect(pageNodeId('n_page/@n_header')).toBe('n_page')
  })

  it('an instance root has the instance id, its parts <instance>/<node>; slot content keeps its page ids', () => {
    const roots = byNode(elements, 'n_card')
    expect(roots).toHaveLength(2)
    expect(roots[0]).toMatchObject({ tag: 'div', type: 'Instance' })
    expect(byNode(elements, 'n_card/n_title')[0]).toMatchObject({ tag: 'h2', type: 'Instance' })
    expect(pageNodeId('n_card/n_title')).toBe('n_card')
    expect(byNode(elements, 'n_read_more')[0]).toMatchObject({ tag: 'ULink', type: 'Link' })
  })

  it('List repetitions after the first are copies, inside and out', () => {
    const [first, second] = byNode(elements, 'n_card')
    expect(first!.copy).toBeUndefined()
    expect(second!.copy).toBe(true)
    expect(byNode(elements, 'n_read_more')[1]!.copy).toBe(true)
  })

  it('an empty List shows its empty text, a placeholder that selects the List', () => {
    const empty = plan(page('index'), { preferences: { showDrafts: false }, featured: [], quotes: [] })
    expect(byNode(empty, 'n_list')[0]).toMatchObject({ tag: 'p', placeholder: true, children: ['No posts yet.'] })
    // hideWhenEmpty: nothing, as in the app.
    expect(byNode(empty, 'n_quotes')).toHaveLength(0)
  })
})

describe('missing data', () => {
  it('a List without data shows its children once, dimmed, with bindings as their paths', () => {
    const elements = plan(page('index'))
    const cards = byNode(elements, 'n_card')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.class).toContain('opacity-60')
    expect(textOf(byNode(elements, 'n_card/n_title')[0]!)).toBe('{post.title}')
    expect(textOf(byNode(elements, 'n_quote')[0]!)).toBe('“{quote.text}” — {quote.author}')
  })

  it('a layout binding without the site shows its path; layout values come from the page', () => {
    const elements = plan(page('index'))
    expect(textOf(byNode(elements, 'n_page/@n_brand')[0]!)).toBe('{site.name}')
    expect(textOf(byNode(elements, 'n_page/@n_section')[0]!)).toBe('Posts')
  })

  it('a detail page without its record renders with placeholders; with a missing record it shows its empty text', () => {
    const missing = plan(page('posts-slug'))
    expect(textOf(byNode(missing, 'n_title')[0]!)).toBe('{post.title}')
    const none = plan(page('posts-slug'), { post: null })
    expect(byNode(none, 'n_page')[0]).toMatchObject({ placeholder: true, children: ['This post doesn\'t exist.'] })
  })

  it('an Image without a usable URL is a placeholder box that loads nothing', () => {
    const card = blog.components.find(entry => entry.name === 'PostCard')!
    for (const cover of ['', 'javascript:alert(1)']) {
      const image = byNode(plan(card, { post: { title: 'T' }, cover }), 'n_cover')
      // An empty cover hides the image (`visible`); an unsafe one renders without its src.
      if (cover === '') expect(image).toHaveLength(0)
      else expect(image[0]!.attrs.src).toBeUndefined()
    }
  })

  it('a missing component renders a placeholder', () => {
    const index = page('index')
    const broken = { ...index, root: { ...index.root, children: [{ id: 'n_x', type: 'Instance', props: { component: 'cmp_gone' } }] } }
    expect(byNode(plan(broken), 'n_x')[0]).toMatchObject({ placeholder: true, children: ['Missing component'] })
  })
})
