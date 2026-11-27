import { describe, expect, it } from 'vitest'
import { generateUi } from '../../../codegen/src/generate/ui/index.ts'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { Model } from '../../../codegen/src/model/load.ts'
import { blogModelFiles } from './fixture.ts'
import { renderPlan } from '../../src/canvas/render.ts'
import type { RenderInput } from '../../src/canvas/render.ts'
import { loadSfc, normalized, planElements, renderGenerated, renderGeneratedPage } from './generated.ts'
import type { App } from './generated.ts'

/**
 * Render parity (V4): for the blog fixture's pages, components and layout,
 * the canvas renders the elements the generated app renders, each with the
 * same tag (HTML or Nuxt UI component) and classes, given the same data.
 */

const model = (): Model => {
  const result = loadModel(blogModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}
const fixture = model()
const files = generateUi(fixture)
const sfc = (path: string) => loadSfc(files.find(file => file.path === path)!.content)
const app: App = {
  components: { BlogPostCard: sfc('layers/blog/app/components/blog/PostCard.vue'), BlogTip: sfc('layers/blog/app/components/blog/Tip.vue') },
  layouts: { main: sfc('layers/core/app/layouts/main.vue') }
}
const blog = fixture.modules.blog!
const page = (name: string) => blog.pages.find(entry => entry.name === name)!
const component = (name: string) => blog.components.find(entry => entry.name === name)!

const site = { name: 'Blog', description: 'A blog built with bildr.' }
const hello = { id: 'p1', title: 'Hello bildr', slug: 'hello-bildr', body: 'Seeded.', published: true }
const draft = { id: 'p2', title: 'A draft', slug: 'a-draft', body: 'Not yet.', published: false }
const quote = { id: 'q1', text: 'Simplicity is prerequisite for reliability.', author: 'Dijkstra' }

const canvas = (file: RenderInput['file'], data: Record<string, unknown>, variant?: RenderInput['variant']) =>
  normalized(planElements(renderPlan({ file, components: blog.components, layouts: fixture.layouts, data, variant })))

describe('canvas render parity with the generated app', () => {
  it('index page: layout, lists, instances with slot fills, grid, image', () => {
    const generated = renderGeneratedPage(app, sfc('layers/blog/app/pages/index.vue'), {
      site, preferences: { showDrafts: false }, featured: [draft], all: [hello, draft], quotes: [quote], posts: [draft], allLoading: false, featuredLoading: false
    })
    const rendered = canvas(page('index'), { site, preferences: { showDrafts: false }, featured: [draft], all: [hello, draft], quotes: [quote] })
    expect(rendered).toEqual(normalized(generated))
    // Known lines, from the fixture's generated files: the card's root (its CSS hover state), the slot fill's link.
    expect(rendered).toContain('div: bg-default duration-200 ease-[ease-out] group/post-card hover:shadow-md motion-reduce:duration-0 overflow-hidden p-5 ring ring-default rounded-lg transition-[padding,box-shadow]')
    expect(rendered).toContain('ULink: gap-1 hover:underline inline-flex items-center text-primary text-sm underline-offset-4')
    expect(rendered).toContain('p: text-muted whitespace-pre-line')
    expect(rendered.length).toBe(32)
  })

  it('index page: a card instance set to the hover state renders its base variant, as the generated page does', () => {
    const changed = model()
    const index = changed.modules.blog!.pages.find(entry => entry.name === 'index')!
    const cards: Array<{ props?: Record<string, unknown> }> = []
    const walk = (node: { type: string, props?: Record<string, unknown>, children?: unknown[] }) => {
      if (node.type === 'Instance' && node.props?.component === component('PostCard').id) cards.push(node)
      for (const child of node.children ?? []) walk(child as typeof node)
    }
    walk(index.root as never)
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) card.props!.variant = 'var_hovered'
    const data = { site, preferences: { showDrafts: false }, featured: [draft], all: [hello, draft], quotes: [quote] }
    const generated = renderGeneratedPage(app, loadSfc(generateUi(changed).find(file => file.path === 'layers/blog/app/pages/index.vue')!.content), {
      ...data, posts: [draft], allLoading: false, featuredLoading: false
    })
    const rendered = normalized(planElements(renderPlan({ file: index, components: changed.modules.blog!.components, layouts: changed.layouts, data })))
    expect(rendered).toEqual(normalized(generated))
    expect(rendered).toEqual(canvas(page('index'), data))
  })

  it('index page: the computed alias follows its condition', () => {
    const generated = renderGeneratedPage(app, sfc('layers/blog/app/pages/index.vue'), {
      site, preferences: { showDrafts: true }, featured: [], all: [hello, draft], quotes: [], posts: [hello, draft], allLoading: false, featuredLoading: false
    })
    expect(canvas(page('index'), { site, preferences: { showDrafts: true }, featured: [], all: [hello, draft], quotes: [] })).toEqual(normalized(generated))
  })

  // list-load-more: the index list shows its first 6 records and a Load more button while more follow.
  it.each([[7, true], [6, false]])('index page: a List with loadMore and %i records (button: %s)', (count, button) => {
    const rows = Array.from({ length: count }, (_, index) => ({ ...hello, id: `p${index}`, slug: `p${index}` }))
    const generated = renderGeneratedPage(app, sfc('layers/blog/app/pages/index.vue'), {
      site, preferences: { showDrafts: true }, featured: [], all: rows, quotes: [], posts: rows, allLoading: false, featuredLoading: false, shownList: 6
    })
    const rendered = canvas(page('index'), { site, preferences: { showDrafts: true }, featured: [], all: rows, quotes: [] })
    expect(rendered).toEqual(normalized(generated))
    expect(rendered.filter(line => line.startsWith('UButton:'))).toHaveLength(button ? 1 : 0)
    expect(rendered.includes('div: basis-full col-span-full flex flex-col gap-2 items-center self-stretch w-full')).toBe(button)
  })

  it('detail page: `when`, a filled layout slot, a bound visible and action state', () => {
    const generated = renderGeneratedPage(app, sfc('layers/blog/app/pages/posts/[slug].vue'), {
      site, post: draft, postLoading: false, publishPending: false, publishError: null
    })
    expect(canvas(page('posts-slug'), { site, post: draft, publish: { pending: false, error: null } })).toEqual(normalized(generated))
  })

  it('new post page: an interactive instance in a variant, a form with fields', () => {
    const generated = renderGeneratedPage(app, sfc('layers/blog/app/pages/posts/new.vue'), {
      site, form: { title: '', slug: '', body: '', published: false }, createPostPending: false, createPostError: null
    })
    expect(canvas(page('posts-new'), { site, createPost: { pending: false, error: null } })).toEqual(normalized(generated))
  })

  it('new post page: a select field\'s Input is a dropdown on both sides (select inputs)', () => {
    const changed = model()
    const title = changed.modules.blog!.entities.find(entity => entity.id === 'ent_post')!.fields.find(field => field.id === 'fld_title')!
    Object.assign(title, { type: 'select', options: ['draft', 'live'], min: undefined, max: undefined })
    const newPage = loadSfc(generateUi(changed).find(file => file.path === 'layers/blog/app/pages/posts/new.vue')!.content)
    const generated = normalized(renderGeneratedPage(app, newPage, { site, form: { title: 'draft', slug: '', body: '', published: false }, createPostPending: false, createPostError: null }))
    const formSelects = { act_create_post: { fld_title: ['draft', 'live'] } }
    const rendered = normalized(planElements(renderPlan({ file: page('posts-new'), components: blog.components, layouts: fixture.layouts, data: { site, createPost: { pending: false, error: null } }, formSelects })))
    expect(rendered).toEqual(generated)
    expect(rendered).toContain('USelect: w-full')
  })

  it.each([
    ['default', undefined],
    ['compact', { id: 'var_compact', label: 'compact' }]
  ])('PostCard component file, %s variant', (name, variant) => {
    const props = { ...app.components.BlogPostCard!.defaults, post: draft, variant: name }
    const generated = renderGenerated(app, app.components.BlogPostCard!, { props, variant: name, $slots: {} })
    expect(canvas(component('PostCard'), { post: draft }, variant)).toEqual(normalized(generated))
  })

  it('PostCard component file, its hover state: what the generated card shows under the pointer', () => {
    // The state is no variant of the generated card (codegen-architecture T2): its `hover:` and `group-hover/post-card:` classes show it.
    expect(app.components.BlogPostCard!.defaults.variant).toBe('default')
    const generated = renderGenerated(app, app.components.BlogPostCard!, { props: { ...app.components.BlogPostCard!.defaults, post: draft }, variant: 'default', $slots: {} })
    // Under the pointer: the root's `hover:` classes and the group's `group-hover/post-card:` ones apply (a Link's own `hover:underline`
    // is no part of the state). The fixture's state only adds tokens the card doesn't set, so it replaces none.
    const state = (name: string, root: boolean) => name.startsWith('group-hover/post-card:') || (root && name.startsWith('hover:'))
    const hovered = generated.map((element, index) => ({ ...element, classes: element.classes.map(name => state(name, index === 0) ? name.slice(name.indexOf(':') + 1) : name) }))
    expect(canvas(component('PostCard'), { post: draft }, { id: 'var_hovered', label: 'hovered' })).toEqual(normalized(hovered))
  })

  it('PostCard component file, a hover state with its own transition: its timing under hover:, on both sides', () => {
    const changed = model()
    const card = changed.modules.blog!.components.find(entry => entry.name === 'PostCard')!
    card.variants.find(variant => variant.id === 'var_hovered')!.transition = { type: 'ease', duration: 0.5, easing: 'linear' }
    const sfcOf = loadSfc(generateUi(changed).find(file => file.path === 'layers/blog/app/components/blog/PostCard.vue')!.content)
    const generated = renderGenerated(app, sfcOf, { props: { ...sfcOf.defaults, post: draft }, variant: 'default', $slots: {} })
    const rendered = normalized(planElements(renderPlan({ file: card, components: changed.modules.blog!.components, layouts: changed.layouts, data: { post: draft } })))
    expect(rendered).toEqual(normalized(generated))
    expect(rendered[0]).toContain('hover:duration-500 hover:ease-linear hover:motion-reduce:duration-0')
  })

  it.each([
    ['default', undefined],
    ['collapsed', { id: 'var_collapsed', label: 'collapsed' }]
  ])('Tip component file (interactive), %s variant', (name, variant) => {
    const props = { ...app.components.BlogTip!.defaults, title: 'A tip', variant: name }
    const generated = renderGenerated(app, app.components.BlogTip!, { props, variant: name, on: {}, $slots: {} })
    expect(canvas(component('Tip'), { title: 'A tip' }, variant)).toEqual(normalized(generated))
  })

  it.each([['one line', 'Shown'], ['a line break', 'Sho\nwn']])('Tip component file, a variant that changes a Text\'s text to %s', (_, text) => {
    // The body's text is the node's own (no property), and the collapsed variant shows another instead of hiding it.
    const changed = model()
    const tip = changed.modules.blog!.components.find(entry => entry.name === 'Tip')!
    const body = tip.properties.find(property => property.name === 'body')!
    body.bindings = []
    tip.root.children!.find(child => child.id === 'n_tip_body')!.props = { text: 'Body' }
    tip.variants[0]!.overrides.n_tip_body = { props: { text } }
    const sfcOf = loadSfc(generateUi(changed).find(file => file.path === 'layers/blog/app/components/blog/Tip.vue')!.content)
    for (const [name, variant] of [['default', undefined], ['collapsed', { id: 'var_collapsed', label: 'collapsed' }]] as const) {
      const generated = renderGenerated(app, sfcOf, { props: { ...sfcOf.defaults, title: 'A tip', variant: name }, variant: name, on: {}, $slots: {} })
      const rendered = normalized(planElements(renderPlan({ file: tip, components: changed.modules.blog!.components, layouts: changed.layouts, data: { title: 'A tip' }, variant })))
      expect(rendered).toEqual(normalized(generated))
      // The title (bound to a property) always keeps its breaks; the body does in every variant when one of its texts has one.
      expect(rendered.filter(line => line.includes('whitespace-pre-line'))).toHaveLength(text.includes('\n') ? 2 : 1)
    }
  })

  it('layout file: header, slots with default content', () => {
    const layout = app.layouts.main!
    const generated = renderGenerated(app, layout, { site, layout: layout.layoutDefaults, $slots: {} })
    expect(canvas(fixture.layouts[0]!, { site })).toEqual(normalized(generated))
  })
})
