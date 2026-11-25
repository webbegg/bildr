import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { ModelNode } from '../../../codegen/src/model/schemas.ts'
import { CANVAS_LINK, pageNodeId, renderPlan, setsState } from '../../src/canvas/render.ts'
import type { PlanChild, PlanElement, RenderInput } from '../../src/canvas/render.ts'
import { blogModelFiles } from './fixture.ts'
import { evaluate } from './generated.ts'
import { generateUi } from '../../../codegen/src/generate/ui/index.ts'
import { valueFormats } from '../../../codegen/src/edit/formats.ts'

/** What the canvas adds to the generated app's markup: node ids, placeholders for missing data, list copies. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const fixture = loaded.model
const blog = fixture.modules.blog!
const page = (name: string) => blog.pages.find(entry => entry.name === name)!
const find = (tree: ModelNode, id: string): ModelNode | undefined => tree.id === id ? tree : tree.children?.map(child => find(child, id)).find(Boolean)

const plan = (file: RenderInput['file'], data: Record<string, unknown> = {}, paths?: Record<string, string>) => renderPlan({ file, components: blog.components, layouts: fixture.layouts, data, ...(paths ? { paths } : {}) })
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

describe('multi-line text', () => {
  it('keeps the line break of a Text, as the generated app does (it emits the text as a string expression, which Vue does not condense)', () => {
    const [body] = byNode(plan(page('index')), 'n_about_body')
    expect(body).toMatchObject({ tag: 'p', children: ['Notes on building apps from a model.\nNew posts most weeks.'] })
    expect(body!.class).toContain('whitespace-pre-line')
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

describe('page links', () => {
  const paths = Object.fromEntries(blog.pages.map(entry => [entry.id, entry.path]))
  const rows = [{ id: 'a', title: 'A', slug: 'first' }]

  it('link to the page path the editor sends, with its params filled from the row, so the current page\'s links are active', () => {
    const elements = plan(page('index'), { preferences: { showDrafts: false }, featured: rows, quotes: [] }, paths)
    expect(byNode(elements, 'n_read_more')[0]!.attrs.to).toBe('/posts/first')
    const home = all(elements).filter(element => element.tag === 'ULink' && element.attrs.to === '/')
    expect(home.length).toBeGreaterThan(0)
  })

  it('says which nodes set a State: only a node with a Set state step, which then carries its scope', () => {
    const elements = plan(page('index'), { preferences: { showDrafts: false }, featured: rows, quotes: [] })
    expect(setsState(find(page('index').root, 'n_toggle')!)).toBe(true)
    expect(setsState(find(page('index').root, 'n_h1')!)).toBe(false)
    expect(byNode(elements, 'n_toggle')[0]!.scope).toMatchObject({ preferences: { showDrafts: false } })
    expect(byNode(elements, 'n_h1')[0]!.scope).toBeUndefined()
  })

  it('stays inert without a path or without the param\'s value', () => {
    const noPaths = plan(page('index'), { preferences: { showDrafts: false }, featured: rows, quotes: [] })
    expect(byNode(noPaths, 'n_read_more')[0]!.attrs.to).toBe(CANVAS_LINK)
    const noRow = plan(page('index'), {}, paths)
    expect(byNode(noRow, 'n_read_more')[0]!.attrs.to).toBe(CANVAS_LINK)
  })
})

describe('money and percent text (field types: formatting)', () => {
  it('formats the fields the generated app formats, to the same text', () => {
    const changed = loadModel(blogModelFiles())
    if (!changed.ok) throw new Error('fixture')
    const model = changed.model
    model.modules.blog!.entities.find(entity => entity.id === 'ent_post')!.fields.push({ id: 'fld_price', name: 'price', type: 'money', currency: 'EUR' }, { id: 'fld_share', name: 'share', type: 'percent' })
    const index = model.modules.blog!.pages.find(entry => entry.name === 'index')!
    index.root.children!.push({ id: 'n_prices', type: 'List', props: { items: { $bind: 'posts' }, as: 'p' }, children: [
      { id: 'n_price', type: 'Text', props: { text: { $bind: 'p.price', fallback: 'Free' } } },
      { id: 'n_share', type: 'Text', props: { text: { $template: 'Off: {p.share}' } } }
    ] })
    const rows = [{ id: 'p1', title: 'Paid', slug: 'paid', price: 1234.5, share: 25 }, { id: 'p2', title: 'Free', slug: 'free', price: null, share: 12.345 }]
    const rendered = renderPlan({ file: index, components: blog.components, layouts: fixture.layouts, data: { preferences: { showDrafts: true }, all: rows, featured: [], quotes: [] }, formats: { [index.id]: valueFormats(model, index.id) } })
    const texts = (id: string) => byNode(rendered, id).map(textOf)
    expect(texts('n_price')).toEqual(['€1,234.50', 'Free'])
    expect(texts('n_share')).toEqual(['Off: 25%', 'Off: 12.35%'])

    // The generated template's own expressions, run over the same rows, write the same text.
    const vue = generateUi(model).find(file => file.path.endsWith('pages/index.vue'))!.content
    const expressionOf = (needle: string) => [...vue.matchAll(/\{\{ (.*?) \}\}/g)].map(match => match[1]!).find(code => code.includes(needle))!
    expect(rows.map(p => String(evaluate(expressionOf('p.price'), { p })))).toEqual(texts('n_price'))
    expect(rows.map(p => `Off: ${String(evaluate(expressionOf('p.share'), { p }))}`)).toEqual(texts('n_share'))
  })

  it('formats a component instance\'s text with the component\'s formats, not the page\'s', () => {
    const changed = loadModel(blogModelFiles())
    if (!changed.ok) throw new Error('fixture')
    const model = changed.model
    model.modules.blog!.entities.find(entity => entity.id === 'ent_post')!.fields.push({ id: 'fld_price', name: 'price', type: 'money', currency: 'EUR' })
    const card = model.modules.blog!.components.find(component => component.id === 'cmp_post_card')!
    card.root.children!.push({ id: 'n_card_price', type: 'Text', props: { text: { $bind: 'post.price' } } })
    const index = model.modules.blog!.pages.find(entry => entry.name === 'index')!
    const data = { preferences: { showDrafts: false }, featured: [{ id: 'a', title: 'A', slug: 'a', price: 9.99 }], quotes: [] }
    const priceOf = (formats: RenderInput['formats']) => textOf(byNode(renderPlan({ file: index, components: model.modules.blog!.components, layouts: fixture.layouts, data, formats }), 'n_card/n_card_price')[0]!)
    expect(priceOf({ cmp_post_card: valueFormats(model, 'cmp_post_card') })).toBe('€9.99')
    // The same map under the page's id formats nothing: node ids are per file.
    expect(priceOf({ [index.id]: valueFormats(model, 'cmp_post_card') })).toBe('9.99')
  })
})
