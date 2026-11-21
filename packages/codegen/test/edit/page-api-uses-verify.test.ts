import { describe, expect, it } from 'vitest'
import { project } from './helpers'

/**
 * Verify P7a (SD-6) repros. B1: a `$bind` argument of an API page use must fit the parameter it fills (the generated call is typed by
 * the query's input), and can't read the use's own answer. B2: a refusal an API source's edit gives because of a page names that page.
 */
const SHOP = 'ds_shop'
const shop = () => {
  const p = project()
  p.edit('api_create', { name: 'shop', baseUrl: 'https://shop.example.com/v1' })
  p.edit('api_model_set', { datasource: SHOP, model: { name: 'Item', fields: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }] } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'item', path: '/items/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Item', many: false } } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'items', path: '/items', params: [{ name: 'category', in: 'query', type: 'text', required: true }, { name: 'page', in: 'query', type: 'integer' }], result: { model: 'Item', many: true } } })
  return p
}

describe('B1: bound args of an API use fit their parameter', () => {
  it('refuses a use whose arg reads its own answer', () => {
    const p = shop()
    p.refuse('page_use_add', { page: 'pg_index', as: 'me', api: { datasource: SHOP, query: 'item' }, args: { id: { $bind: 'me.id' } } }, 'invalid')
  })

  it('refuses a boolean state field into a text parameter', () => {
    const p = shop()
    // pg_index uses st_preferences as "preferences" (showDrafts: boolean).
    expect(p.refuse('page_use_add', { page: 'pg_index', as: 'found', api: { datasource: SHOP, query: 'items' }, args: { category: { $bind: 'preferences.showDrafts' } } }, 'invalid').message).toMatch(/category/)
  })

  it('refuses a text field of another answer into an integer parameter', () => {
    const p = shop()
    p.edit('page_use_add', { page: 'pg_index', as: 'first', api: { datasource: SHOP, query: 'item' }, args: { id: 1 } })
    expect(p.refuse('page_use_add', { page: 'pg_index', as: 'found', api: { datasource: SHOP, query: 'items' }, args: { category: 'books', page: { $bind: 'first.name' } } }, 'invalid').message).toMatch(/page/)
  })

  // An argument can't read another API answer (it is undefined until it loads), so two uses can never read each other: the first
  // edit that would chain them is refused, with a plain message, and the cycle can't be built.
  it('refuses an arg that reads another API answer, so two uses can\'t read each other', () => {
    const p = shop()
    p.edit('page_use_add', { page: 'pg_index', as: 'first', api: { datasource: SHOP, query: 'item' }, args: { id: 1 } })
    const chained = p.refuse('page_use_add', { page: 'pg_index', as: 'second', api: { datasource: SHOP, query: 'item' }, args: { id: { $bind: 'first.id' } } }, 'invalid').message
    expect(chained).toMatch(/"id" reads "first", the answer of another API query/)
    p.edit('page_use_add', { page: 'pg_index', as: 'second', api: { datasource: SHOP, query: 'item' }, args: { id: 2 } })
    expect(p.refuse('page_use_update', { page: 'pg_index', as: 'first', args: { id: { $bind: 'second.id' } } }, 'invalid').message).toMatch(/another API query/)
    expect(p.refuse('page_use_update', { page: 'pg_index', as: 'second', args: { id: { $bind: 'second.id' } } }, 'invalid').message).toMatch(/this very use/)
  })
})

describe('B2: refusals from the source\'s edits name the page', () => {
  const PAGE = /page "index" \(pg_index\)/
  it('api_query_set changing a param type a page passes a literal for', () => {
    const p = project()
    p.edit('page_use_add', { page: 'pg_index', as: 'now', api: { datasource: 'ds_weather', query: 'forecast' }, args: { city: 'Lisbon' } })
    const query = { name: 'forecast', path: '/forecast', params: [{ name: 'city', in: 'query', type: 'integer', required: true, key: 'q' }], result: { model: 'Forecast', many: false } }
    expect(p.refuse('api_query_set', { datasource: 'ds_weather', query }, 'invalid').message).toMatch(PAGE)
  })

  it('api_query_rename whose composable meets a name a page declares', () => {
    const p = project()
    p.edit('page_use_add', { page: 'pg_index', as: 'useWeatherNow', api: { datasource: 'ds_weather', query: 'forecast' }, args: { city: 'Lisbon' } })
    expect(p.refuse('api_query_rename', { datasource: 'ds_weather', query: 'forecast', name: 'now' }, 'invalid').message).toMatch(PAGE)
  })

  it('api_update renaming the source whose composable meets a name a page declares', () => {
    const p = project()
    p.edit('page_use_add', { page: 'pg_index', as: 'useClimaForecast', api: { datasource: 'ds_weather', query: 'forecast' }, args: { city: 'Porto' } })
    expect(p.refuse('api_update', { datasource: 'ds_weather', name: 'clima' }, 'invalid').message).toMatch(PAGE)
  })
})

describe('B1/A3: what a bound arg may read', () => {
  const add = (p: ReturnType<typeof shop>, query: string, args: Record<string, unknown>, as = 'found') =>
    ({ page: 'pg_index', as, api: { datasource: SHOP, query }, args })

  it('refuses a name the page doesn\'t have, and what can\'t fill a parameter (another kind of use, the whole state)', () => {
    const p = shop()
    expect(p.refuse('page_use_add', add(p, 'item', { id: { $bind: 'nope.id' } }), 'invalid').message).toMatch(/"id" reads "nope", which doesn't refer to anything this page uses/)
    expect(p.refuse('page_use_add', add(p, 'item', { id: { $bind: 'featured.length' } }), 'invalid').message).toMatch(/"id" reads "featured", which can't fill an API parameter/)
    expect(p.refuse('page_use_add', add(p, 'item', { id: { $bind: 'preferences' } }), 'invalid').message).toMatch(/isn't a field of the state "preferences"/)
    expect(p.refuse('page_use_add', add(p, 'items', { category: { $template: '{nope.id}' } }), 'invalid').message).toMatch(/reads "nope"/)
  })

  it('accepts a state field of the right type, a template for text, and a fallback for a possibly empty value', () => {
    const p = shop()
    p.edit('api_query_set', { datasource: SHOP, query: { name: 'drafts', path: '/drafts', params: [{ name: 'on', in: 'query', type: 'boolean', required: true }, { name: 'tag', in: 'query', type: 'text', required: true }], result: { model: 'Item', many: true } } })
    // showDrafts is a boolean with a default: always defined.
    p.edit('page_use_add', add(p, 'drafts', { on: { $bind: 'preferences.showDrafts' }, tag: { $template: 'x-{preferences.showDrafts}' } }))
    expect(p.refuse('page_use_add', add(p, 'item', { id: { $template: 'n{preferences.showDrafts}' } }, 'other'), 'invalid').message).toMatch(/takes "id" as integer/)
    expect(p.refuse('page_use_add', add(p, 'drafts', { on: { not: { $bind: 'preferences.showDrafts' } }, tag: { not: true } }, 'other'), 'invalid').message).toMatch(/takes "tag" as text/)
  })

  it('refuses a state field that can be empty into a required parameter unless a fallback covers it', () => {
    const p = shop()
    p.edit('state_create', { name: 'filters', fields: [{ name: 'term', type: 'text' }, { name: 'min', type: 'integer' }, { name: 'tag', type: 'text', required: true, default: 'new' }] })
    const state = p.model().modules.blog!.state.find(entry => entry.name === 'filters')!.id
    p.edit('page_use_add', { page: 'pg_index', as: 'filters', state })
    expect(p.refuse('page_use_add', add(p, 'items', { category: { $bind: 'filters.term' } }), 'invalid').message).toMatch(/can be empty/)
    p.edit('page_use_add', add(p, 'items', { category: { $bind: 'filters.term', fallback: 'all' } }))
    // A required text field is defined; an optional parameter takes a value that can be empty, not null.
    p.edit('page_use_update', { page: 'pg_index', as: 'found', args: { category: { $bind: 'filters.tag' }, page: { $bind: 'filters.min', fallback: 1 } } })
    // An optional parameter takes a value that can be empty.
    p.edit('page_use_update', { page: 'pg_index', as: 'found', args: { page: { $bind: 'filters.min' } } })
    expect(p.refuse('page_use_update', { page: 'pg_index', as: 'found', args: { category: { $bind: 'filters.min' } } }, 'invalid').message).toMatch(/takes "category" as text, but "filters.min" is integer/)
    expect(p.refuse('page_use_update', { page: 'pg_index', as: 'found', args: { page: { $bind: 'filters.min', fallback: 'one' } } }, 'invalid').message).toMatch(/its fallback "one" isn't/)
  })
})
