import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../../codegen/src/edit/index.ts'
import { blogModelFiles } from '../canvas/fixture.ts'
import { allByTestId, byTestId, click, Failure, settle, typeInto } from '../helpers.ts'
import { check, choose, insertComponent, insertType, open, select, setupHarness } from './harness.ts'

/**
 * The binding panels (P5, mapping §4): a List's source and its query's sort, filter and
 * limit, a Form's action and fields, the names a text, image or link can bind, an
 * instance's entity values, the page's uses, and the values a component needs when
 * the palette inserts it.
 */

setupHarness()

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
/** The module's real edit over the blog fixture (what the action does), not a stand-in that always succeeds: its refusals come back as the module's. */
const real = (name: Parameters<typeof applyEdit>[1], outcomes: unknown[] = []) => (input: Record<string, unknown>) => {
  const outcome = applyEdit(blogModelFiles(), name, input)
  outcomes.push(outcome)
  return outcome.ok ? { changed: outcome.changes.map(change => change.path), ...outcome.result } : new Failure(422, outcome.code, outcome.message)
}
const nodeTab = () => click(byTestId('inspector-tab-node'))
const fileTab = () => click(byTestId('inspector-tab-file'))
const options = (id: string) => [...(byTestId(id) as HTMLSelectElement).options].map(option => option.value)

describe('a List\'s source', () => {
  it('picks among the page\'s lists and offers a new query for each entity', async () => {
    const outcomes: unknown[] = []
    const { actions } = await open({ node_update_props: ok(), query_create_for_list: real('query_create_for_list', outcomes) }, 'pg_index')
    await select('n_list')
    expect(options('list-items')).toEqual(['featured', 'all', 'quotes', 'posts', 'new:ent_post', 'new:ent_quote'])
    expect((byTestId('list-items') as HTMLSelectElement).value).toBe('posts')

    await choose('list-items', 'all')
    await choose('list-items', 'new:ent_post')

    expect(actions.named('node_update_props').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'all' } } }])
    expect(actions.named('query_create_for_list').map(call => call.input)).toEqual([{ page: 'pg_index', entity: 'ent_post', nodeId: 'n_list' }])
    // pg_index already uses "posts": the module takes the next free name instead of refusing, and the List is bound to it.
    expect(outcomes).toMatchObject([{ ok: true, result: { as: 'posts2' } }])
    expect(byTestId('design-error')).toBeNull()
  })

  it('edits the sort of every query behind a computed source, for this page use', async () => {
    const { actions } = await open({ query_update: ok({ forked: false }) }, 'pg_index')
    await select('n_list')
    // `posts` is `all` or `featured`: each is listed under its own name.
    expect(allByTestId('source').map(entry => entry.dataset.alias)).toEqual(['all', 'featured'])
    expect((byTestId('source-featured-sort-field') as HTMLSelectElement).value).toBe('publishedAt')
    expect((byTestId('source-featured-sort-dir') as HTMLSelectElement).value).toBe('desc')

    await choose('source-featured-sort-field', 'title')
    await choose('source-featured-sort-dir', 'asc')

    expect(actions.named('query_update').map(call => call.input)).toEqual([
      { query: 'q_featured_posts', page: 'pg_index', as: 'featured', orderBy: [{ field: 'title', direction: 'desc' }] },
      { query: 'q_featured_posts', page: 'pg_index', as: 'featured', orderBy: [{ field: 'publishedAt', direction: 'asc' }] }
    ])
  })

  it('builds a second sort change on the first when it comes before the model is read back', async () => {
    const { actions } = await open({ query_update: ok() }, 'pg_index')
    await select('n_list')
    const field = byTestId('source-featured-sort-field') as HTMLSelectElement
    const direction = byTestId('source-featured-sort-dir') as HTMLSelectElement
    field.value = 'title'
    field.dispatchEvent(new Event('change', { bubbles: true }))
    direction.value = 'asc'
    direction.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(actions.named('query_update').map(call => call.input)).toEqual([
      { query: 'q_featured_posts', page: 'pg_index', as: 'featured', orderBy: [{ field: 'title', direction: 'desc' }] },
      { query: 'q_featured_posts', page: 'pg_index', as: 'featured', orderBy: [{ field: 'title', direction: 'asc' }] }
    ])
  })

  it('edits a limit the query owns, and the page\'s argument for one it takes as a parameter', async () => {
    const { actions } = await open({ query_update: ok(), page_use_update: ok() }, 'pg_index')
    await select('n_list')
    await typeInto(byTestId('source-all-limit'), '4')
    expect((byTestId('source-featured-limit') as HTMLInputElement).value).toBe('6')
    await typeInto(byTestId('source-featured-limit'), '2')
    expect(actions.named('query_update').map(call => call.input)).toEqual([{ query: 'q_all_posts', page: 'pg_index', as: 'all', limit: 4 }])
    expect(actions.named('page_use_update').map(call => call.input)).toEqual([{ page: 'pg_index', as: 'featured', args: { limit: 2 } }])
  })

  it('edits the filter once it has a field, an operator and a value (typed by the field)', async () => {
    const { actions } = await open({ query_update: ok() }, 'pg_index')
    await select('n_list')
    expect((byTestId('source-featured-filter-field') as HTMLSelectElement).value).toBe('published')
    await choose('source-all-filter-field', 'published')
    expect(actions.named('query_update')).toEqual([])
    await choose('source-all-filter-op', 'eq')
    await choose('source-all-filter-value', 'true')
    await choose('source-all-filter-field', '')
    expect(actions.named('query_update').map(call => call.input)).toEqual([
      { query: 'q_all_posts', page: 'pg_index', as: 'all', where: { op: 'eq', field: 'published', value: true } },
      { query: 'q_all_posts', page: 'pg_index', as: 'all', where: null }
    ])
  })
})

describe('what a prop can bind', () => {
  it('binds a Heading\'s text to a name in scope, or adds it to the text', async () => {
    const { actions } = await open({ node_update_props: ok() }, 'pg_index')
    await select('n_h1')
    expect(options('bind-text')).toContain('site.name')
    expect(options('bind-text')).not.toContain('post.title')
    await choose('bind-text', 'site.name')
    expect(actions.named('node_update_props').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', props: { text: { $template: 'Posts {site.name}' } } }])
  })

  it('offers a List\'s item to what is inside it (a link in a slot fill), and no list or record as text', async () => {
    const { actions } = await open({ node_update_props: ok() }, 'pg_index')
    await select('n_read_more')
    expect(options('bind-text')).toContain('post.title')
    expect(options('bind-text')).toContain('featured.length')
    expect(options('bind-text')).not.toContain('featured')
    expect(options('bind-text')).not.toContain('post')
    await choose('bind-text', 'post.title')
    expect(actions.named('node_update_props').at(-1)?.input).toEqual({ file: 'pg_index', nodeId: 'n_read_more', props: { text: { $template: 'Read more {post.title}' } } })
  })

  it('shows what a text is bound to, and unbinds it', async () => {
    const { actions } = await open({ node_update_props: ok() }, 'pg_index')
    await select('n_quote')
    expect(byTestId('prop-text-bound')?.textContent).toContain('{quote.text}')
    await click(byTestId('prop-text-bound')!.querySelector('button'))
    expect(actions.named('node_update_props').at(-1)?.input).toMatchObject({ nodeId: 'n_quote', props: { text: null } })
  })

  it('binds in a layout through layout.x', async () => {
    const { actions } = await open({ node_update_props: ok() }, 'lay_main')
    await select('n_footer_link')
    expect(options('bind-text')).toEqual(expect.arrayContaining(['layout.title', 'site.name']))
    await choose('bind-text', 'layout.title')
    expect(actions.named('node_update_props').at(-1)?.input).toMatchObject({ file: 'lay_main', nodeId: 'n_footer_link', props: { text: { $template: 'Built with Nuxt {layout.title}' } } })
  })
})

describe('an instance\'s entity values', () => {
  it('shows the bound record of an entity property and rebinds it to another record in scope', async () => {
    const { actions } = await open({ instance_set_values: ok() }, 'pg_index')
    await select('n_card')
    expect((byTestId('value-post') as HTMLSelectElement).value).toBe('post')
    expect(options('value-post')).toEqual(['', 'post'])
    await choose('value-post', '')
    expect(actions.named('instance_set_values').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card', values: { prop_post: null } }])
  })
})

describe('inserting a component that needs a record', () => {
  it('asks for the record first: outside a List nothing can be bound, inside one the item is offered', async () => {
    const { actions } = await open({ node_insert: ok({ nodeId: 'n_instance_1' }) }, 'pg_index')
    await select('n_h1')
    await insertComponent('cmp_post_card')
    expect(byTestId('required-dialog')).not.toBeNull()
    expect(options('required-post')).toEqual([''])
    expect(byTestId('required-none')).not.toBeNull()
    await click(byTestId('required-cancel'))
    expect(actions.named('node_insert')).toEqual([])

    await select('n_list')
    await insertComponent('cmp_post_card')
    expect(options('required-post')).toEqual(['', 'post'])
    expect((byTestId('required-confirm') as HTMLButtonElement).disabled).toBe(true)
    await choose('required-post', 'post')
    await click(byTestId('required-confirm'))
    expect(actions.named('node_insert').map(call => call.input)).toEqual([
      { file: 'pg_index', parentId: 'n_list', type: 'Instance', props: { component: 'cmp_post_card', values: { prop_post: { $bind: 'post' } } } }
    ])
    expect(byTestId('required-dialog')).toBeNull()
  })

  it('asks for a required text too, and the insert waits for it', async () => {
    const { actions } = await open({ node_insert: ok({ nodeId: 'n_instance_1' }) }, 'pg_index')
    await insertComponent('cmp_tip')
    expect((byTestId('required-confirm') as HTMLButtonElement).disabled).toBe(true)
    await typeInto(byTestId('required-title'), 'Hello')
    await click(byTestId('required-confirm'))
    expect(actions.named('node_insert').map(call => call.input)).toEqual([
      { file: 'pg_index', type: 'Instance', props: { component: 'cmp_tip', values: { prop_title: 'Hello' } } }
    ])
  })

  it('inserts at once a component that needs nothing', async () => {
    const { actions } = await open({ node_insert: ok({ nodeId: 'n_instance_1' }) }, 'pg_index')
    // A component with no required property: PostCard's record is, so drop in a plain node instead.
    await insertType('Text')
    await settle()
    expect(byTestId('required-dialog')).toBeNull()
    expect(actions.named('node_insert')).toHaveLength(1)
  })
})

describe('a Form\'s action and fields', () => {
  it('sets the action in one edit (the module adds the page\'s use with it) and ticks the fields it edits', async () => {
    const { actions } = await open({ node_update_props: ok() }, 'pg_new_post')
    await select('n_form')
    expect((byTestId('form-action') as HTMLSelectElement).value).toBe('act_create_post')
    await check('form-field-fld_body', false)
    await choose('form-action', 'act_create_post')
    expect(actions.named('node_update_props').map(call => call.input)[0]).toMatchObject({ file: 'pg_new_post', nodeId: 'n_form', props: { fields: expect.not.arrayContaining(['fld_body']) } })
    expect(actions.named('node_update_props').at(-1)?.input).toMatchObject({ props: { action: 'act_create_post', fields: [] } })
    expect(actions.named('page_use_add')).toEqual([])
  })

  it('offers only actions a Form can run (an entity input), so picking one never leaves a stray use', async () => {
    await open({}, 'pg_new_post')
    await select('n_form')
    expect(options('form-action')).not.toContain('act_publish_post')
    expect(options('form-action')).toEqual(['', 'act_create_post'])
  })
})

describe('inserting a Form from the palette', () => {
  it('asks which action it runs, and inserts it with that action and no fields', async () => {
    const { actions } = await open({ node_insert: ok({ nodeId: 'n_form_2' }) }, 'pg_new_post')
    await insertType('Form')
    expect(byTestId('form-dialog')).not.toBeNull()
    expect(actions.named('node_insert')).toEqual([])
    expect((byTestId('form-dialog-confirm') as HTMLButtonElement).disabled).toBe(true)
    expect(options('form-dialog-action')).toEqual(['', 'act_create_post'])
    await choose('form-dialog-action', 'act_create_post')
    await click(byTestId('form-dialog-confirm'))
    expect(actions.named('node_insert').map(call => call.input)).toEqual([
      { file: 'pg_new_post', type: 'Form', props: { action: 'act_create_post', fields: [] } }
    ])
    expect(byTestId('form-dialog')).toBeNull()
  })

  it('inserts nothing when the dialog is cancelled', async () => {
    const { actions } = await open({ node_insert: ok() }, 'pg_new_post')
    await insertType('Form')
    await click(byTestId('form-dialog-cancel'))
    expect(actions.named('node_insert')).toEqual([])
    expect(byTestId('form-dialog')).toBeNull()
  })

  it('is accepted by the real edit: the page uses the action and the model builds', async () => {
    const outcomes: unknown[] = []
    await open({ node_insert: real('node_insert', outcomes) }, 'pg_index')
    await insertType('Form')
    await choose('form-dialog-action', 'act_create_post')
    await click(byTestId('form-dialog-confirm'))
    expect(outcomes).toMatchObject([{ ok: true }])
  })
})

describe('the page\'s uses', () => {
  it('lists them with their arguments, adds a query and removes one', async () => {
    const { actions } = await open({ page_use_add: ok(), page_use_remove: ok(), page_use_update: ok() }, 'pg_index')
    await nodeTab()
    await select('n_h1')
    await fileTab()
    expect(allByTestId('use-row').map(row => row.dataset.alias)).toEqual(['featured', 'all', 'quotes', 'preferences'])
    expect((byTestId('use-arg-featured-limit') as HTMLInputElement).value).toBe('6')
    await typeInto(byTestId('use-arg-featured-limit'), '8')
    await typeInto(byTestId('use-add-alias'), 'latest')
    await choose('use-add-source', 'q_all_posts')
    await click(byTestId('use-add'))
    await click(byTestId('use-remove-quotes'))
    expect(actions.named('page_use_update').map(call => call.input)).toEqual([{ page: 'pg_index', as: 'featured', args: { limit: 8 } }])
    expect(actions.named('page_use_add').map(call => call.input)).toEqual([{ page: 'pg_index', as: 'latest', query: 'q_all_posts' }])
    expect(actions.named('page_use_remove').map(call => call.input)).toEqual([{ page: 'pg_index', as: 'quotes' }])
  })
})
