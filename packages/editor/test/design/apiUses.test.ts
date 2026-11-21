import { describe, expect, it } from 'vitest'
import type { PageFile } from '@bildr/codegen/model'
import { Failure, allByTestId, byTestId, click, settle, typeInto } from '../helpers.ts'
import { moduleEdits } from '../editor/dataKit.ts'
import { caretAtEnd, choose, menuLabels, open, propRow, select, setupHarness, variablePicker, world } from './harness.ts'

/**
 * What a page uses, with API queries (simple data P7b, B2, B3), mounted as the Design screen over the module's own edits: the page's
 * panel lists an API query's use with its parameters, adds any query of any API (one record or many) and removes it; the pickers of a
 * binding show the fields of what an API query answers, nested ones as `address.city`, for the use and for the List's item.
 */

setupHarness()

const edits = () => moduleEdits(['node_update_props', 'page_use_add', 'page_use_remove', 'page_use_update'])
const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const page = (id: string): PageFile => Object.values(world.model.modules).flatMap(mod => mod.pages).find(entry => entry.id === id)!
const aliases = () => allByTestId('use-row').map(row => row.dataset.alias)
const sourceOptions = () => [...(byTestId('use-add-source') as HTMLSelectElement).options].map((option): [string, string] => [option.value, text(option)])

describe('the page\'s API uses', () => {
  it('lists the use with the API and the query it reads, and its parameters', async () => {
    await open(edits(), 'pg_shop_catalog')
    await select('n_catalog')
    expect(aliases()).toEqual(['products'])
    expect(text(allByTestId('use-row')[0])).toContain('API · catalog · products')
    // The route's category is what it reads: shown as that, not as code.
    expect(text(byTestId('use-arg-products-category'))).toBe('category')
  })

  it('saves a typed parameter with page_use_update, as for a query', async () => {
    const { actions } = await open(edits(), 'pg_shop_catalog')
    await select('n_catalog')
    await choose('use-arg-products-category-from', '')
    await typeInto(byTestId('use-arg-products-category'), 'books')
    expect(actions.named('page_use_update').map(call => call.input)).toEqual([
      { page: 'pg_shop_catalog', as: 'products', args: { category: null } },
      { page: 'pg_shop_catalog', as: 'products', args: { category: 'books' } }
    ])
    expect(page('pg_shop_catalog').uses!.apis![0]!.args).toEqual({ category: 'books' })
  })

  it('offers every query of every API, one record or many, with its parameters', async () => {
    await open(edits(), 'pg_index')
    await select('n_page')
    const options = sourceOptions()
    expect(options.filter(([id]) => id.startsWith('api:'))).toEqual([
      ['api:ds_catalog:products', 'catalog · products (category, locale)'],
      ['api:ds_catalog:product', 'catalog · product (id)'],
      ['api:ds_weather:forecast', 'weather · forecast (city)']
    ])
    // The page's own module's queries and actions are still there.
    expect(options.map(([id]) => id)).toEqual(expect.arrayContaining(['q_all_posts', 'act_create_post']))
  })

  it('adds a query that needs nothing under its own name, or the one typed', async () => {
    const { actions } = await open(edits(), 'pg_index')
    await select('n_page')
    await choose('use-add-source', 'api:ds_catalog:products')
    await click(byTestId('use-add'))
    expect(actions.named('page_use_add').map(call => call.input)).toEqual([{ page: 'pg_index', as: 'products', api: { datasource: 'ds_catalog', query: 'products' } }])
    expect(aliases()).toContain('products')
    await choose('use-add-source', 'api:ds_catalog:products')
    await typeInto(byTestId('use-add-alias'), 'sale')
    await click(byTestId('use-add'))
    expect(actions.named('page_use_add').at(-1)!.input).toMatchObject({ as: 'sale' })
    // Without a name typed, the next free one: `products` is taken.
    await choose('use-add-source', 'api:ds_catalog:products')
    await click(byTestId('use-add'))
    expect(actions.named('page_use_add').at(-1)!.input).toMatchObject({ as: 'products2' })
  })

  it('asks for the values a query needs before adding it, taking the page\'s route parameter by itself', async () => {
    const { actions } = await open(edits(), 'pg_index')
    await select('n_page')
    await choose('use-add-source', 'api:ds_weather:forecast')
    expect((byTestId('use-add') as HTMLButtonElement).disabled).toBe(true)
    await typeInto(byTestId('use-add-arg-city'), 'Oslo')
    expect((byTestId('use-add') as HTMLButtonElement).disabled).toBe(false)
    await click(byTestId('use-add'))
    expect(actions.named('page_use_add').map(call => call.input)).toEqual([{ page: 'pg_index', as: 'forecast', api: { datasource: 'ds_weather', query: 'forecast' }, args: { city: 'Oslo' } }])
    expect(byTestId('use-add-arg-city')).toBeNull()
    expect((byTestId('use-add-source') as HTMLSelectElement).value).toBe('')
  })

  it('asks for nothing the page\'s route gives', async () => {
    const { actions } = await open(edits(), 'pg_weather')
    await select('n_forecast')
    await choose('use-add-source', 'api:ds_weather:forecast')
    expect(byTestId('use-add-arg-city')).toBeNull()
    await click(byTestId('use-add'))
    expect(actions.named('page_use_add').at(-1)!.input).toEqual({ page: 'pg_weather', as: 'forecast', api: { datasource: 'ds_weather', query: 'forecast' }, args: { city: { $route: 'city' } } })
  })

  it('takes the route\'s parameter for an integer parameter too, and shows it as what it reads', async () => {
    page('pg_index').path = '/things/:id'
    const { actions } = await open(edits(), 'pg_index')
    await select('n_page')
    await choose('use-add-source', 'api:ds_catalog:product')
    expect(byTestId('use-add-arg-id')).toBeNull()
    await click(byTestId('use-add'))
    expect(actions.named('page_use_add').at(-1)!.input).toEqual({ page: 'pg_index', as: 'product', api: { datasource: 'ds_catalog', query: 'product' }, args: { id: { $route: 'id' } } })
    // The use it made reads the route's id: shown as that.
    expect(text(byTestId('use-arg-product-id'))).toBe('id')
    const from = byTestId('use-arg-product-id-from') as HTMLSelectElement
    expect([...from.options].map(option => option.value)).toContain('route:id')
  })

  it('says what the module refuses, and keeps what was chosen', async () => {
    await open({ ...edits(), page_use_add: () => new Failure(422, 'invalid', 'The page already uses the name "products"') }, 'pg_index')
    await select('n_page')
    await choose('use-add-source', 'api:ds_catalog:products')
    await click(byTestId('use-add'))
    expect(text(byTestId('design-error'))).toContain('The page already uses the name "products"')
    expect((byTestId('use-add-source') as HTMLSelectElement).value).toBe('api:ds_catalog:products')
  })

  it('removes a use, by the name it reads it under', async () => {
    page('pg_index').uses!.apis = [{ as: 'catalog', datasource: 'ds_catalog', query: 'products' }]
    const { actions } = await open(edits(), 'pg_index')
    await select('n_page')
    expect(aliases()).toContain('catalog')
    await click(byTestId('use-remove-catalog'))
    await settle()
    expect(actions.named('page_use_remove').map(call => call.input)).toEqual([{ page: 'pg_index', as: 'catalog' }])
    expect(page('pg_index').uses!.apis).toBeUndefined()
  })

  it('keeps the page\'s other uses working next to an API use', async () => {
    page('pg_index').uses!.apis = [{ as: 'catalog', datasource: 'ds_catalog', query: 'products' }]
    const { actions } = await open(edits(), 'pg_index')
    await select('n_page')
    expect(aliases()).toEqual(['featured', 'all', 'quotes', 'catalog', 'preferences'])
    await typeInto(byTestId('use-arg-featured-limit'), '8')
    expect(actions.named('page_use_update').map(call => call.input)).toEqual([{ page: 'pg_index', as: 'featured', args: { limit: 8 } }])
  })
})

describe('the binding pickers over an API query\'s fields (B3)', () => {
  it('offer the fields of the item of a List over it, nested paths included, and the list\'s length', async () => {
    await open(edits(), 'pg_shop_catalog')
    await select('n_product')
    caretAtEnd('text')
    const labels = await menuLabels(variablePicker('text'))
    expect(labels).toEqual(expect.arrayContaining(['product.id', 'product.name', 'product.price', 'product.inStock', 'product.createdAt', 'product.note', 'product.categories.length', 'products.length']))
    expect(labels).not.toContain('products')
  })

  it('offer a record\'s fields, and the nested ones of a model, for a query that answers one', async () => {
    const shop = page('pg_shop_catalog')
    shop.uses!.apis!.push({ as: 'featured', datasource: 'ds_catalog', query: 'product', args: { id: 1 } })
    const root = shop.root.children!
    root.push({ id: 'n_note', type: 'Text', props: { text: 'Hello' } })
    await open(edits(), 'pg_shop_catalog')
    await select('n_note')
    caretAtEnd('text')
    const labels = await menuLabels(variablePicker('text'))
    expect(labels).toEqual(expect.arrayContaining(['featured.id', 'featured.name', 'featured.categories.length']))
    // The list of a many query reads by its length, a record by its fields.
    expect(labels).not.toContain('featured.length')
    expect(labels).toContain('products.length')
  })

  it('show them for the binding dot too', async () => {
    await open(edits(), 'pg_shop_catalog')
    await select('n_product')
    const labels = await menuLabels(propRow('text')!.querySelector('[data-binding-dot]'))
    expect(labels.join('|')).toContain('Bind to data')
  })
})
