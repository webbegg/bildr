import { describe, expect, it } from 'vitest'
import { valueFormats } from '../../src/edit/formats'
import { loadModel } from '../../src/model/load'
import type { Model, ModelNode } from '../../src/model/schemas'
import { fixtureModelFiles } from '../model/fixture'

/** Which money and percent fields a file's text shows (field types: formatting): the map the generator and the canvas both read. */

const EUR = { kind: 'money', currency: 'EUR' } as const
const PERCENT = { kind: 'percent' } as const

const fixture = (): Model => {
  const loaded = loadModel(fixtureModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  const model = loaded.model
  const blog = model.modules.blog!
  blog.entities.find(entity => entity.id === 'ent_post')!.fields.push({ id: 'fld_price', name: 'price', type: 'money', currency: 'EUR' })
  blog.state.find(state => state.id === 'st_preferences')!.fields.push({ id: 'fld_budget', name: 'budget', type: 'money', currency: 'EUR' }, { id: 'fld_tax', name: 'tax', type: 'percent' })
  return model
}
const pageOf = (model: Model, id: string) => model.modules.blog!.pages.find(page => page.id === id)!
const text = (id: string, value: unknown): ModelNode => ({ id, type: 'Text', props: { text: value as never } })
const list = (id: string, items: string, as: string, children: ModelNode[]): ModelNode => ({ id, type: 'List', props: { items: { $bind: items }, as }, children })

describe('valueFormats', () => {
  it('formats a single store\'s money and percent fields, in a $bind and in $template parts', () => {
    const model = fixture()
    pageOf(model, 'pg_index').root.children!.push(text('n_budget', { $bind: 'preferences.budget' }), text('n_both', { $template: '{preferences.budget} plus {preferences.tax}' }))
    const formats = valueFormats(model, 'pg_index')
    expect(formats.n_budget).toEqual({ 'preferences.budget': EUR })
    expect(formats.n_both).toEqual({ 'preferences.budget': EUR, 'preferences.tax': PERCENT })
  })

  it('leaves a store of many records, a non-money field and a path one level too deep unformatted', () => {
    const model = fixture()
    pageOf(model, 'pg_index').root.children!.push(text('n_drafts', { $bind: 'preferences.showDrafts' }), text('n_deep', { $bind: 'preferences.budget.amount' }))
    expect(valueFormats(model, 'pg_index')).toEqual({})
    model.modules.blog!.state.find(state => state.id === 'st_preferences')!.shape = 'many'
    pageOf(model, 'pg_index').root.children!.push(text('n_budget', { $bind: 'preferences.budget' }))
    expect(valueFormats(model, 'pg_index')).toEqual({})
  })

  it('reads a List item\'s fields from its own entity when its name hides a page alias', () => {
    const model = fixture()
    pageOf(model, 'pg_index').root.children!.push(list('n_shadow', 'posts', 'preferences', [text('n_item_price', { $bind: 'preferences.price' }), text('n_item_budget', { $bind: 'preferences.budget' })]))
    expect(valueFormats(model, 'pg_index')).toEqual({ n_item_price: { 'preferences.price': EUR } })
  })

  it('formats an API model\'s field, down a nested model, but not one in a list', () => {
    const model = fixture()
    const catalog = model.datasources.find(source => source.id === 'ds_catalog')!
    const product = catalog.models!.find(entry => entry.name === 'Product')!
    product.fields.find(field => field.name === 'price')!.type = 'money'
    product.fields.find(field => field.name === 'price')!.currency = 'USD'
    catalog.models!.find(entry => entry.name === 'Category')!.fields.push({ name: 'share', type: 'percent' })
    product.fields.push({ name: 'main', type: 'model', model: 'Category' })
    const root = pageOf(model, 'pg_shop_catalog').root
    const items = root.children!.find(child => child.id === 'n_products')!
    items.children!.push(text('n_main', { $bind: 'product.main.share' }), text('n_listed', { $bind: 'product.categories.share' }))
    const formats = valueFormats(model, 'pg_shop_catalog')
    expect(formats.n_product).toEqual({ 'product.price': { kind: 'money', currency: 'USD' } })
    expect(formats.n_main).toEqual({ 'product.main.share': PERCENT })
    expect(formats.n_listed).toBeUndefined()
  })

  it('formats a component\'s entity property, keyed by the component\'s own node ids', () => {
    const model = fixture()
    const card = model.modules.blog!.components.find(component => component.id === 'cmp_post_card')!
    card.root.children!.push(text('n_card_price', { $bind: 'post.price' }))
    expect(valueFormats(model, 'cmp_post_card')).toEqual({ n_card_price: { 'post.price': EUR } })
    expect(valueFormats(model, 'pg_index')).toEqual({})
  })
})
