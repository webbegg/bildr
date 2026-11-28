import { describe, expect, it } from 'vitest'
import type { ScopeName } from '@bildr/codegen/edit'
import { fieldTree, pickerSources } from '../../src/shared/dataPicker.ts'
import type { ApiParam } from '../../src/shared/apiPageUse.ts'
import type { PageDataOffer } from '../../src/shared/pageDataOffers.ts'

/** The Insert variable popover's two levels: the sources a text reads, then each one's fields, nested models and lists as levels of their own. */

describe('fieldTree', () => {
  it('nests a model\'s fields under it, and opens a list by its length instead of inserting the list', () => {
    expect(fieldTree('product', ['product.id', 'product.address', 'product.address.city', 'product.tags', 'product.tags.length'])).toEqual([
      { label: 'id', path: 'product.id' },
      { label: 'address', children: [{ label: 'city', path: 'product.address.city' }] },
      { label: 'tags', children: [{ label: 'length', path: 'product.tags.length' }] }
    ])
  })

  it('keeps a lone value as one field, and leaves out what is not under the name', () => {
    expect(fieldTree('title', ['title'])).toEqual([{ label: 'title', path: 'title' }])
    expect(fieldTree('post', ['other.x'])).toEqual([])
  })
})

describe('pickerSources', () => {
  const scope: ScopeName[] = [
    { name: 'featured', source: 'query', fields: ['id', 'title'], many: true },
    { name: 'post', source: 'item', fields: ['id', 'title'], many: false },
    { name: 'title', source: 'prop', fields: [], many: false },
    { name: 'site', source: 'site', fields: ['name'], many: false }
  ]
  const offers: PageDataOffer[] = [
    { label: 'Blog preferences', source: 'store', use: { as: 'preferences', state: 'st_preferences' }, paths: ['preferences.appName'], missing: [] },
    { label: 'catalog · product', source: 'api', use: { as: 'product', api: { datasource: 'ds_catalog', query: 'product' } }, paths: ['product.name'], missing: [{ name: 'id', in: 'path', type: 'integer' } as ApiParam] }
  ]

  it('lists what the page reads, then the stores and APIs it would add, each with what it is and its fields', () => {
    const sources = pickerSources(scope, offers)
    expect(sources.map(source => [source.id, source.group, source.label, source.description, source.leaves])).toEqual([
      ['page:featured', 'page', 'featured', 'Query', ['featured.length']],
      ['page:post', 'page', 'post', 'Item of a List', ['post.id', 'post.title']],
      ['page:title', 'page', 'title', 'Property', ['title']],
      ['page:site', 'page', 'site', 'The site', ['site.name']],
      ['store:st_preferences', 'store', 'Blog preferences', 'Store, added to this page', ['preferences.appName']],
      ['api:ds_catalog:product', 'api', 'catalog · product', 'API, added to this page', ['product.name']]
    ])
    expect(sources[4]!.offer).toBe(offers[0])
    expect(sources[5]!.missing).toEqual(['id'])
  })

  it('leaves out an offer with nothing a text shows', () => {
    expect(pickerSources([], [{ ...offers[0]!, paths: [] }])).toEqual([])
  })
})
