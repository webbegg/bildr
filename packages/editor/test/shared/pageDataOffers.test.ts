import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { Model, PageFile } from '@bildr/codegen/model'
import { pageDataOffers } from '../../src/shared/pageDataOffers.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** The stores and API queries a page's text can show but the page doesn't use yet: the Insert variable menu offers them next to what it reads. */

const fresh = (): Model => {
  const loaded = loadModel(blogModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return loaded.model
}
const pageIn = (model: Model, id: string): PageFile => Object.values(model.modules).flatMap(mod => mod.pages).find(entry => entry.id === id)!

/** The blog with a text field on its store, which only has a true-or-false one (a text doesn't show those). */
const withStoreText = (): Model => {
  const model = fresh()
  model.modules.blog!.state.find(state => state.id === 'st_preferences')!.fields.push({ id: 'fld_app_name', name: 'appName', type: 'text', default: 'Sample app' })
  return model
}

describe('pageDataOffers', () => {
  it('offers a store the page doesn\'t use, with the fields a text shows, under the name the page would read it by', () => {
    const offers = pageDataOffers(withStoreText(), 'pg_new_post')
    expect(offers[0]).toEqual({ label: 'Blog preferences', source: 'store', use: { as: 'preferences', state: 'st_preferences' }, paths: ['preferences.appName'], missing: [] })
  })

  it('leaves out a store the page uses (the menu lists it already), and one with no field a text shows', () => {
    expect(pageDataOffers(withStoreText(), 'pg_index').filter(offer => offer.source === 'store')).toEqual([])
    expect(pageDataOffers(fresh(), 'pg_new_post').filter(offer => offer.source === 'store')).toEqual([])
  })

  it('offers each API query the page doesn\'t use: a list by its length, one record by its fields', () => {
    const offers = pageDataOffers(fresh(), 'pg_new_post').filter(offer => offer.source === 'api')
    expect(offers.map(offer => [offer.label, offer.use.as, offer.missing.map(param => param.name)])).toEqual([
      ['catalog · products', 'products', []],
      ['catalog · product', 'product', ['id']],
      ['weather · forecast', 'forecast', ['city']]
    ])
    expect(offers[0]!.paths).toEqual(['products.length'])
    expect(offers[1]!.paths).toContain('product.name')
    expect(offers[1]!.paths).toContain('product.categories.length')
  })

  it('gives a query the route parameter of the same name, and leaves out the queries the page uses', () => {
    const model = fresh()
    const weather = pageDataOffers(model, 'pg_weather').filter(offer => offer.source === 'api')
    expect(weather.map(offer => offer.label)).toEqual(['catalog · products', 'catalog · product'])
    // The page reads the forecast as `report`: a name another use would take is not offered again.
    const page = pageIn(model, 'pg_new_post')
    page.uses = { ...page.uses, apis: [{ as: 'products', datasource: 'ds_catalog', query: 'product', args: { id: 1 } }] }
    const product = pageDataOffers(model, 'pg_new_post').find(offer => offer.label === 'catalog · products')!
    expect(product.use).toEqual({ as: 'products2', api: { datasource: 'ds_catalog', query: 'products' } })
    expect(product.paths).toEqual(['products2.length'])
  })

  it('offers a query its route parameter, as an argument of the use', () => {
    const model = fresh()
    const page = pageIn(model, 'pg_post_detail')
    page.path = '/catalog/:id'
    const product = pageDataOffers(model, 'pg_post_detail').find(offer => offer.label === 'catalog · product')!
    expect(product.use).toEqual({ as: 'product', api: { datasource: 'ds_catalog', query: 'product' }, args: { id: { $route: 'id' } } })
    expect(product.missing).toEqual([])
  })

  it('has nothing for a component, a layout, an unknown page or no model', () => {
    const model = withStoreText()
    expect(pageDataOffers(model, model.modules.blog!.components[0]!.id)).toEqual([])
    expect(pageDataOffers(model, 'pg_nope')).toEqual([])
    expect(pageDataOffers(null, 'pg_index')).toEqual([])
  })
})
