import { describe, expect, it } from 'vitest'
import { checkSurface, componentCatalog, fromA2ui, toA2ui } from '../../src/a2ui/index'
import type { A2uiComponent, A2uiCreateSurface } from '../../src/a2ui/index'
import { loadModel } from '../../src/model/load'
import { ModelNodeSchema } from '../../src/model/schemas'
import type { Model, ModelNode } from '../../src/model/schemas'
import { fixtureModelFiles } from '../model/fixture'

// A2UI spike: a bildr tree ⇄ an A2UI v1.0 surface, and a project's components as an A2UI catalog.

const model = (): Model => {
  const loaded = loadModel(fixtureModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return loaded.model
}
const blog = model()
const pages = blog.modules.blog!.pages
const components = blog.modules.blog!.components
const page = (id: string) => pages.find(candidate => candidate.id === id)!

const byId = (surface: A2uiCreateSurface) => new Map(surface.createSurface.components.map(component => [component.id, component]))
const UAX31 = /^[\p{XID_Start}_][\p{XID_Continue}]*$/u

/** The types and texts of a tree, depth first: what a round trip should keep. */
const skeleton = (node: ModelNode): unknown[] => [
  node.type,
  ...(node.props?.text !== undefined ? [node.props.text] : []),
  ...(node.children ?? []).flatMap(skeleton)
]

describe('toA2ui', () => {
  it('writes the index page as a v1.0 createSurface with a root and UAX #31 ids', () => {
    const { message } = toA2ui(page('pg_index').root, { surfaceId: 'pg_index', components })
    expect(message.version).toBe('1.0')
    expect(message.createSurface.surfaceId).toBe('pg_index')
    const all = byId(message)
    expect(all.get('root')?.component).toBe('Column')
    for (const id of all.keys()) expect(id).toMatch(UAX31)
  })

  it('maps a Heading to Markdown Text, a List to a template with item-relative paths, a Row to justify/align', () => {
    const all = byId(toA2ui(page('pg_index').root, { surfaceId: 's', components }).message)
    expect(all.get('n_h1')).toEqual({ id: 'n_h1', component: 'Text', text: '# Posts' })
    expect(all.get('n_head')).toMatchObject({ component: 'Row', justify: 'spaceBetween', align: 'center', children: ['n_h1', 'n_toggle'] })
    expect(all.get('n_quotes')).toMatchObject({ component: 'List', children: { path: '/quotes', componentId: 'n_quote' } })
    expect(all.get('n_quote')).toEqual({ id: 'n_quote', component: 'Text', text: { '@call': 'formatString', 'args': { value: '“${text}” — ${author}' } } })
    expect(all.get('n_toggle')).toMatchObject({ component: 'CheckBox', label: 'Show drafts', value: { '@path': '/preferences/showDrafts' } })
  })

  it('writes an Instance as the project component, its values by property name and its slot as a child list', () => {
    const all = byId(toA2ui(page('pg_index').root, { surfaceId: 's', components }).message)
    expect(all.get('n_card')).toEqual({ id: 'n_card', component: 'PostCard', post: { '@path': '' }, actions: ['n_read_more'] })
  })

  it('reports what A2UI cannot hold instead of dropping it silently', () => {
    const { lost } = toA2ui(page('pg_index').root, { surfaceId: 's', components })
    expect(lost).toContainEqual({ nodeId: 'n_h1', kind: 'style', detail: 'text, font' })
    expect(lost).toContainEqual(expect.objectContaining({ nodeId: 'n_toggle', kind: 'interaction' }))
    expect(lost).toContainEqual(expect.objectContaining({ nodeId: 'n_about', kind: 'node', detail: expect.stringContaining('Grid') }))
  })

  it('keeps the content a page puts in a layout slot, as a Column', () => {
    const all = byId(toA2ui(page('pg_post_detail').root, { surfaceId: 's', components }).message)
    expect(all.get('n_footer_fill')).toMatchObject({ component: 'Column', children: ['n_back'] })
    expect(all.get('n_back')).toMatchObject({ component: 'Button', variant: 'borderless', action: { event: { name: 'navigate', context: { page: 'pg_index' } } } })
  })

  it('turns a runAction click into an event named after the action', () => {
    const tree: ModelNode = {
      id: 'n_page',
      type: 'Page',
      children: [{ id: 'n_go', type: 'Button', props: { text: 'Publish' }, interactions: [{ on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post' }] }] }]
    }
    const all = byId(toA2ui(tree, { surfaceId: 's' }).message)
    expect(all.get('n_go')).toEqual({ id: 'n_go', component: 'Button', child: 'n_go_label', action: { event: { name: 'act_publish_post' } } })
    expect(all.get('n_go_label')).toEqual({ id: 'n_go_label', component: 'Text', text: 'Publish' })
  })

  it('writes the one argument of a runAction as the event context', () => {
    const { message, lost } = toA2ui(page('pg_post_detail').root, { surfaceId: 's', components })
    expect(byId(message).get('n_publish')).toMatchObject({ action: { event: { name: 'act_publish_post', context: { id: { '@path': '/post/id' } } } } })
    expect(lost).toContainEqual({ nodeId: 'n_publish', kind: 'interaction', detail: 'click: toast' })
  })

  it('renames ids A2UI refuses and keeps them unique', () => {
    const tree: ModelNode = { id: 'n_page', type: 'Page', children: [{ id: 'n-a', type: 'Text', props: { text: 'a' } }, { id: 'n_a', type: 'Text', props: { text: 'b' } }] }
    const ids = [...byId(toA2ui(tree, { surfaceId: 's' }).message).keys()]
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(UAX31)
  })

  it('writes every fixture page and component as a surface checkSurface accepts', () => {
    for (const artifact of [...pages, ...components]) {
      const { message } = toA2ui(artifact.root, { surfaceId: artifact.id, components })
      expect(checkSurface(message.createSurface.components), artifact.id).toEqual([])
    }
  })
})

describe('checkSurface', () => {
  it('reports a missing root, a dangling reference and a bad id', () => {
    const errors = checkSurface([{ id: 'a-b', component: 'Column', children: ['ghost'] }])
    expect(errors.map(error => error.message)).toEqual([
      'Id "a-b" is not a UAX #31 identifier',
      'Component "a-b" references "ghost", which is not defined',
      'No component has id "root"'
    ])
  })
})

describe('fromA2ui', () => {
  const contactCard: A2uiComponent[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['name', 'avatar', 'agree', 'email', 'save', 'volume'] },
    { id: 'name', component: 'Text', text: '## Ada Lovelace' },
    { id: 'avatar', component: 'Image', url: { '@path': '/contact/photo' }, description: 'Portrait' },
    { id: 'agree', component: 'CheckBox', label: 'Subscribe', value: { '@path': '/contact/subscribed' } },
    { id: 'email', component: 'TextField', label: 'Email', value: { '@path': '/form/fld_email' } },
    { id: 'save', component: 'Button', child: 'save_label', action: { event: { name: 'act_save_contact' } } },
    { id: 'save_label', component: 'Text', text: 'Save' },
    { id: 'volume', component: 'Slider', value: 3, max: 10 }
  ]

  it('nests a flat surface into a valid .bildr tree', () => {
    const { root, warnings } = fromA2ui(contactCard, { actions: ['act_save_contact'] })
    expect(ModelNodeSchema.safeParse(root).success).toBe(true)
    expect(root).toEqual({
      id: 'root',
      type: 'Card',
      children: [{
        id: 'body',
        type: 'Column',
        children: [
          { id: 'name', type: 'Heading', props: { level: 2, text: 'Ada Lovelace' } },
          { id: 'avatar', type: 'Image', props: { src: { $bind: 'contact.photo' }, alt: 'Portrait' } },
          { id: 'agree', type: 'Checkbox', props: { label: 'Subscribe', value: { $bind: 'contact.subscribed' } } },
          { id: 'email', type: 'Input', props: { label: 'Email', field: 'fld_email' } },
          { id: 'save', type: 'Button', props: { text: 'Save' }, interactions: [{ on: 'click', do: [{ kind: 'runAction', action: 'act_save_contact' }] }] }
        ]
      }]
    })
    expect(warnings).toEqual([{ componentId: 'volume', message: 'Slider has no bildr node type: left out' }])
  })

  it('warns about an event that names no action of the page', () => {
    const { root, warnings } = fromA2ui(contactCard, { actions: [] })
    expect(root.children?.[0]?.children?.at(-1)?.interactions).toBeUndefined()
    expect(warnings).toContainEqual({ componentId: 'save', message: 'Event "act_save_contact" is not an action of the page: left out' })
  })

  it('turns an event context into the args of the runAction step', () => {
    const { root } = fromA2ui([
      { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'act_publish_post', context: { id: { '@path': '/post/id' } } } } },
      { id: 'label', component: 'Text', text: 'Publish' }
    ], { actions: ['act_publish_post'] })
    expect(root.interactions).toEqual([{ on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } }] }])
  })

  it('turns a project component back into an Instance, its slot into a SlotFill', () => {
    const { message } = toA2ui(page('pg_index').root, { surfaceId: 's', components })
    const { root, warnings } = fromA2ui(message.createSurface.components, { components })
    const find = (node: ModelNode, id: string): ModelNode | undefined => node.id === id ? node : (node.children ?? []).map(child => find(child, id)).find(Boolean)
    expect(find(root, 'n_card')).toMatchObject({
      type: 'Instance',
      props: { component: 'cmp_post_card', values: { prop_post: { $bind: 'item' } } },
      children: [{ type: 'SlotFill', props: { slot: 'prop_actions' }, children: [{ id: 'n_read_more', type: 'Link' }] }]
    })
    expect(warnings.map(warning => warning.componentId)).not.toContain('n_card')
  })

  it('leaves out, with a warning, a project component missing a required value', () => {
    const { root, warnings } = fromA2ui([{ id: 'root', component: 'Column', children: ['tip'] }, { id: 'tip', component: 'Tip', tone: 'info' }], { components })
    expect(root.children).toEqual([])
    expect(warnings).toEqual([{ componentId: 'tip', message: 'Tip needs title: left out' }])
  })

  it('turns a List template back into a List whose item paths are bound to its `as`', () => {
    const { root } = fromA2ui([
      { id: 'root', component: 'List', children: { path: '/quotes', componentId: 'quote' } },
      { id: 'quote', component: 'Text', text: { '@path': 'text' } }
    ])
    expect(root).toEqual({ id: 'root', type: 'List', props: { items: { $bind: 'quotes' }, as: 'item' }, children: [{ id: 'quote', type: 'Text', props: { text: { $bind: 'item.text' } } }] })
  })
})

describe('round trip', () => {
  it('keeps the types and texts of a tree in the overlapping vocabulary', () => {
    const tree: ModelNode = {
      id: 'root',
      type: 'Column',
      children: [
        { id: 'title', type: 'Heading', props: { level: 2, text: 'Hello' } },
        { id: 'row', type: 'Row', children: [{ id: 'pic', type: 'Image', props: { src: '/a.png', alt: 'A' } }, { id: 'body', type: 'Text', props: { text: { $bind: 'post.body' } } }] },
        { id: 'card', type: 'Card', children: [{ id: 'ok', type: 'Button', props: { text: 'OK' }, interactions: [{ on: 'click', do: [{ kind: 'runAction', action: 'act_ok' }] }] }] },
        { id: 'list', type: 'List', props: { items: { $bind: 'posts' }, as: 'item' }, children: [{ id: 'item_title', type: 'Text', props: { text: { $bind: 'item.title' } } }] }
      ]
    }
    const { message } = toA2ui(tree, { surfaceId: 's' })
    const back = fromA2ui(message.createSurface.components, { actions: ['act_ok'] })
    expect(back.warnings).toEqual([])
    expect(back.root).toEqual(tree)
  })

  it('keeps the shape of every fixture page through A2UI (types and texts, depth first)', () => {
    for (const artifact of pages) {
      const { message } = toA2ui(artifact.root, { surfaceId: artifact.id })
      const back = fromA2ui(message.createSurface.components, { actions: blog.modules.blog!.actions.map(action => action.id) })
      expect(ModelNodeSchema.safeParse(back.root).success, artifact.id).toBe(true)
      expect(skeleton(back.root).length, artifact.id).toBeGreaterThan(1)
    }
  })
})

describe('componentCatalog', () => {
  it('describes each project component as a v1.0 catalog entry', () => {
    const catalog = componentCatalog(components, { catalogId: 'https://example.com/a2ui/catalog/v1' })
    expect(catalog.catalogId).toBe('https://example.com/a2ui/catalog/v1')
    expect(catalog.protocolVersion).toBe('1.0')
    expect(catalog.components.PostCard).toEqual({
      type: 'object',
      properties: {
        component: { const: 'PostCard' },
        post: { $ref: 'common_types.json#/$defs/DataBinding', description: 'A Post: title, slug, body, published' },
        cover: { $ref: 'common_types.json#/$defs/DynamicString', description: 'An image URL' },
        draftLabel: { $ref: 'common_types.json#/$defs/DynamicString', description: 'Draft label' },
        actions: { $ref: 'common_types.json#/$defs/ChildList' }
      },
      required: ['component', 'post']
    })
    for (const name of Object.keys(catalog.components)) expect(name).toMatch(UAX31)
    expect(catalog.instructions).toContain('PostCard')
  })
})
