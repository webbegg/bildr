import { describe, expect, it } from 'vitest'
import type { Model, PageFile } from '@bildr/codegen/model'
import { Failure, byTestId, settle, typeInto } from '../helpers.ts'
import { moduleEdits } from '../editor/dataKit.ts'
import { choose, find, indexPage, open, select, setupHarness, world } from './harness.ts'

/**
 * An API query as a List's source (simple data P7b, B1), mounted as the Design screen over the module's own edits: the Items select offers
 * each API query that answers many rows as "<API> · <query>"; picking one adds the page's use of it (`page_use_add`, under the query's
 * name, a free one) and binds the List's items and item name (`node_update_props`); a route parameter of the page fills a required
 * parameter of the same name; the other required ones are asked for first; the parameters are the page's arguments (`page_use_update`);
 * and sort, filter and limit, which are the query's own for a collection, are not there for an API.
 */

setupHarness()

const edits = () => moduleEdits(['node_update_props', 'page_use_add', 'page_use_remove', 'page_use_update', 'page_computed_set', 'page_computed_remove', 'query_create_for_list', 'query_update'])
const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const value = (id: string) => (byTestId(id) as HTMLSelectElement).value
const options = (id: string) => [...(byTestId(id) as HTMLSelectElement).options].map((option): [string, string] => [option.value, text(option)]).filter(([option]) => option)
const page = (id: string): PageFile => Object.values(world.model.modules).flatMap(mod => mod.pages).find(entry => entry.id === id)!
const writes = (actions: Awaited<ReturnType<typeof open>>['actions']) => actions.calls.map(call => call.name).filter(name => ['page_use_add', 'page_use_update', 'page_use_remove', 'node_update_props', 'page_computed_remove'].includes(name))

/** The index page gets a List of its own with no children (one that repeats records the model can't read in is refused for an API), reading `all`. */
const withPlainList = () => {
  const root = indexPage().root
  root.children!.push({ id: 'n_plain', type: 'List', props: { items: { $bind: 'all' }, as: 'item' } })
}
/** The query `products` of the catalog API takes its category: a query parameter the call can't go without. */
const requireCategory = (model: Model = world.model) => {
  const source = model.datasources.find(entry => entry.id === 'ds_catalog')!
  source.queries!.find(query => query.name === 'products')!.params[0]!.required = true
}

/** The preferences state gets fields of other types, one that can be empty, one that can be null and a text one that always has a value. */
const stateFields = () => {
  world.model.modules.blog!.state[0]!.fields.push(
    { id: 'fld_tag', name: 'tag', type: 'text', default: 'new' },
    { id: 'fld_note', name: 'note', type: 'text' },
    { id: 'fld_maybe', name: 'maybe', type: 'text', nullable: true, default: '' },
    { id: 'fld_count', name: 'count', type: 'integer', default: 1 }
  )
}

describe('the Items select', () => {
  it('offers each API query that answers many rows as "<API> · <query>", after the page\'s own lists', async () => {
    withPlainList()
    await open(edits(), 'pg_index')
    await select('n_plain')
    expect(options('list-items').map(([id]) => id)).toContain('api:ds_catalog:products')
    expect(options('list-items').find(([id]) => id === 'api:ds_catalog:products')![1]).toBe('catalog · products')
    // `product` and `forecast` answer one record: a List has nothing to repeat over.
    expect(options('list-items').map(([id]) => id).filter(id => id.startsWith('api:'))).toEqual(['api:ds_catalog:products'])
  })

  it('adds the page\'s use and binds the List: one page_use_add, then its items and item name', async () => {
    withPlainList()
    const { actions } = await open(edits(), 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    expect(writes(actions)).toEqual(['page_use_add', 'node_update_props'])
    expect(actions.named('page_use_add')[0]!.input).toEqual({ page: 'pg_index', as: 'products', api: { datasource: 'ds_catalog', query: 'products' } })
    expect(actions.named('node_update_props')[0]!.input).toEqual({ file: 'pg_index', nodeId: 'n_plain', props: { items: { $bind: 'products' }, as: 'product' } })
    expect(indexPage().uses!.apis).toEqual([{ as: 'products', datasource: 'ds_catalog', query: 'products' }])
    expect(find(indexPage().root, 'n_plain')!.props).toMatchObject({ items: { $bind: 'products' }, as: 'product' })
    // The select shows the List's source by the name it reads it under.
    expect(value('list-items')).toBe('products')
  })

  it('keeps an item name the List already has', async () => {
    withPlainList()
    find(indexPage().root, 'n_plain')!.props!.as = 'thing'
    const { actions } = await open(edits(), 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    expect(actions.named('node_update_props')[0]!.input).toMatchObject({ props: { items: { $bind: 'products' } } })
    expect(find(indexPage().root, 'n_plain')!.props!.as).toBe('thing')
  })

  it('takes a name the page has not got: the query\'s name, or the next free one', async () => {
    withPlainList()
    indexPage().uses!.queries!.push({ as: 'products', query: 'q_all_posts' })
    const { actions } = await open(edits(), 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    expect(actions.named('page_use_add')[0]!.input).toMatchObject({ as: 'products2' })
    expect(value('list-items')).toBe('products2')
  })

  it('lists a use the page already has among its lists, and picks it as any other (no new use)', async () => {
    withPlainList()
    indexPage().uses!.apis = [{ as: 'catalog', datasource: 'ds_catalog', query: 'products' }]
    const { actions } = await open(edits(), 'pg_index')
    await select('n_plain')
    expect(options('list-items').map(([id]) => id)).toContain('catalog')
    await choose('list-items', 'catalog')
    expect(writes(actions)).toEqual(['node_update_props'])
    expect(actions.named('node_update_props')[0]!.input).toMatchObject({ props: { items: { $bind: 'catalog' } } })
  })

  it('shows a refusal of the module under the Items, and leaves the page as it was', async () => {
    withPlainList()
    const { actions } = await open({ ...edits(), page_use_add: () => new Failure(422, 'invalid', 'The page already uses the name "products"') }, 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    expect(actions.named('node_update_props')).toHaveLength(0)
    expect(text(byTestId('list-condition-error'))).toContain('The page already uses the name "products"')
    expect(byTestId('design-error')).toBeNull()
    expect(indexPage().uses!.apis).toBeUndefined()
  })

  it('takes the use off again when the List is refused', async () => {
    withPlainList()
    const { actions } = await open({ ...edits(), node_update_props: () => new Failure(422, 'invalid', 'The List can\'t read that') }, 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    expect(writes(actions)).toEqual(['page_use_add', 'node_update_props', 'page_use_remove'])
    expect(actions.named('page_use_remove')[0]!.input).toEqual({ page: 'pg_index', as: 'products' })
    expect(indexPage().uses!.apis).toBeUndefined()
    expect(text(byTestId('list-condition-error'))).toContain('The List can\'t read that')
  })

  it('drops the computed value the List read before, when nothing else reads it', async () => {
    // The index's own List shows posts and its card wants a Post, which the module refuses for an API's rows: a plain List reads a condition of its own.
    withPlainList()
    indexPage().uses!.computed!.push({ as: 'extra', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } })
    find(indexPage().root, 'n_plain')!.props!.items = { $bind: 'extra' }
    const { actions } = await open(edits(), 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    expect(writes(actions)).toEqual(['page_use_add', 'node_update_props', 'page_computed_remove'])
  })
})

describe('the uses a List leaves and takes (S2)', () => {
  /** The shop page reads its posts too, and its List of products holds nothing (a List of another collection's rows can't hold what reads a product). */
  const plainShop = () => {
    const shop = page('pg_shop_catalog')
    shop.uses!.queries = [{ as: 'all', query: 'q_all_posts' }]
    find(shop.root, 'n_products')!.children = []
  }
  /** A second List of the shop page, bound to `items`. */
  const second = (items: string) => {
    plainShop()
    page('pg_shop_catalog').root.children!.push({ id: 'n_second', type: 'List', props: { items: { $bind: items }, as: 'item' } })
  }

  it('reuses the page\'s use of the same query with the same values instead of adding another', async () => {
    second('all')
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_second')
    await choose('list-items', 'api:ds_catalog:products')
    expect(writes(actions)).toEqual(['node_update_props'])
    expect(actions.named('node_update_props')[0]!.input).toMatchObject({ nodeId: 'n_second', props: { items: { $bind: 'products' } } })
    expect(page('pg_shop_catalog').uses!.apis).toHaveLength(1)
    expect(value('list-items')).toBe('products')
  })

  it('adds another use when the values differ', async () => {
    second('all')
    page('pg_shop_catalog').uses!.apis![0]!.args = { category: 'books' }
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_second')
    await choose('list-items', 'api:ds_catalog:products')
    expect(actions.named('page_use_add')[0]!.input).toMatchObject({ as: 'products2' })
  })

  it('takes the use off when the List moves to another source and nothing else on the page reads it', async () => {
    plainShop()
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_products')
    await choose('list-items', 'all')
    expect(writes(actions)).toEqual(['node_update_props', 'page_use_remove'])
    expect(actions.named('page_use_remove')[0]!.input).toEqual({ page: 'pg_shop_catalog', as: 'products' })
    expect(page('pg_shop_catalog').uses!.apis).toBeUndefined()
    expect(byTestId('design-error')).toBeNull()
  })

  it('keeps the use while another node of the page reads it, and says nothing of the module\'s refusal', async () => {
    second('products')
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_products')
    await choose('list-items', 'all')
    expect(writes(actions)).toEqual(['node_update_props', 'page_use_remove'])
    expect(page('pg_shop_catalog').uses!.apis).toHaveLength(1)
    expect(byTestId('design-error')).toBeNull()
    expect(text(byTestId('list-condition-error'))).toBe('')
  })

  it('takes the old use off too when the List moves to the same query with other values', async () => {
    plainShop()
    page('pg_shop_catalog').uses!.apis![0]!.args = { category: 'books' }
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_products')
    await choose('list-items', 'api:ds_catalog:products')
    expect(writes(actions)).toEqual(['page_use_add', 'node_update_props', 'page_use_remove'])
    expect(actions.named('page_use_remove')[0]!.input).toEqual({ page: 'pg_shop_catalog', as: 'products' })
    expect(page('pg_shop_catalog').uses!.apis!.map(use => use.as)).toEqual(['products2'])
  })
})

describe('a query that needs a value', () => {
  it('takes a route parameter of the page by itself, in the one page_use_add', async () => {
    requireCategory()
    const shop = page('pg_shop_catalog')
    // The page's own `products` reads the category typed, so a second List reading the query with the route's category is another use.
    shop.uses!.apis![0]!.args = { category: 'books' }
    shop.root.children!.push({ id: 'n_second', type: 'List', props: { items: { $bind: 'products' }, as: 'item' } })
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_second')
    await choose('list-items', 'api:ds_catalog:products')
    expect(actions.named('page_use_add')[0]!.input).toEqual({ page: 'pg_shop_catalog', as: 'products2', api: { datasource: 'ds_catalog', query: 'products' }, args: { category: { $route: 'category' } } })
    expect(byTestId('list-api-pending')).toBeNull()
  })

  it('asks for the other required values first: nothing is written until they are given', async () => {
    withPlainList()
    requireCategory()
    const { actions } = await open(edits(), 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    expect(writes(actions)).toEqual([])
    expect(text(byTestId('list-api-pending'))).toContain('catalog · products')
    expect((byTestId('list-api-add') as HTMLButtonElement).disabled).toBe(true)
    await typeInto(byTestId('list-api-arg-category'), 'books')
    expect((byTestId('list-api-add') as HTMLButtonElement).disabled).toBe(false)
    byTestId('list-api-add')!.click()
    await settle()
    expect(actions.named('page_use_add')[0]!.input).toEqual({ page: 'pg_index', as: 'products', api: { datasource: 'ds_catalog', query: 'products' }, args: { category: 'books' } })
    expect(actions.named('node_update_props')[0]!.input).toMatchObject({ nodeId: 'n_plain', props: { items: { $bind: 'products' } } })
    expect(byTestId('list-api-pending')).toBeNull()
    expect(value('list-items')).toBe('products')
  })

  it('lets the user choose a value of a State the page uses instead of typing one', async () => {
    withPlainList()
    requireCategory()
    stateFields()
    const { actions } = await open(edits(), 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    const from = byTestId('list-api-arg-category-from') as HTMLSelectElement
    expect([...from.options].map(option => option.value)).toContain('bind:preferences.tag')
    await choose('list-api-arg-category-from', 'bind:preferences.tag')
    byTestId('list-api-add')!.click()
    await settle()
    expect(actions.named('page_use_add')[0]!.input).toMatchObject({ args: { category: { $bind: 'preferences.tag' } } })
  })

  it('offers only the fields the parameter takes: its type, never one that can be null, and a required one only a field that is never empty', async () => {
    withPlainList()
    requireCategory()
    stateFields()
    await open(edits(), 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    const offered = () => [...(byTestId('list-api-arg-category-from') as HTMLSelectElement).options].map(option => option.value).filter(option => option.startsWith('bind:'))
    // `showDrafts` is true or false, `count` a number, `maybe` can be null, `note` can be empty and the parameter is required.
    expect(offered()).toEqual(['bind:preferences.tag'])
  })

  it('offers a field that can be empty to a parameter that can be left out', async () => {
    stateFields()
    page('pg_shop_catalog').uses!.state = [{ as: 'preferences', state: 'st_preferences' }]
    await open(edits(), 'pg_shop_catalog')
    await select('n_products')
    const offered = [...(byTestId('source-products-arg-category-from') as HTMLSelectElement).options].map(option => option.value).filter(option => option.startsWith('bind:'))
    expect(offered).toEqual(['bind:preferences.tag', 'bind:preferences.note'])
  })

  it('forgets what was asked when the user cancels', async () => {
    withPlainList()
    requireCategory()
    const { actions } = await open(edits(), 'pg_index')
    await select('n_plain')
    await choose('list-items', 'api:ds_catalog:products')
    byTestId('list-api-cancel')!.click()
    await settle()
    expect(byTestId('list-api-pending')).toBeNull()
    expect(writes(actions)).toEqual([])
  })
})

describe('the source of a List over an API query', () => {
  it('says which query it is and has no sort, filter or limit', async () => {
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_products')
    const source = document.body.querySelector<HTMLElement>('[data-testid="api-source"]')!
    expect(source.dataset.alias).toBe('products')
    expect(text(source)).toContain('catalog · products')
    expect(byTestId('source')).toBeNull()
    expect(byTestId('source-products-sort-field')).toBeNull()
    expect(byTestId('source-products-filter-field')).toBeNull()
    expect(byTestId('source-products-limit')).toBeNull()
    expect(actions.named('query_update')).toHaveLength(0)
  })

  it('shows the parameters, a route one as what it is, and saves a typed one with page_use_update', async () => {
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_products')
    expect(text(byTestId('source-products-arg-category'))).toBe('category')
    // A value typed replaces the route's.
    await choose('source-products-arg-category-from', '')
    expect(actions.named('page_use_update')[0]!.input).toEqual({ page: 'pg_shop_catalog', as: 'products', args: { category: null } })
    await typeInto(byTestId('source-products-arg-category'), 'books')
    expect(actions.named('page_use_update').at(-1)!.input).toEqual({ page: 'pg_shop_catalog', as: 'products', args: { category: 'books' } })
    expect(page('pg_shop_catalog').uses!.apis![0]!.args).toEqual({ category: 'books' })
  })

  it('does not let a required value be removed', async () => {
    requireCategory()
    await open(edits(), 'pg_shop_catalog')
    await select('n_products')
    const from = byTestId('source-products-arg-category-from') as HTMLSelectElement
    expect([...from.options].find(option => option.value === '')!.disabled).toBe(true)
  })
})
