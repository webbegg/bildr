import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from './fixture'

/** Simple data P7a (SD-6, A1/A2): `uses.apis` loads, and what it names is checked. */

const IDX = '.bildr/modules/blog/pages/index.json'

type Use = Record<string, unknown>

/** The golden blog with the page's `uses.apis` set. */
const withApis = (apis: Use[] | undefined, extra: (page: Record<string, any>) => void = () => {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const files = fixtureModelFiles()
  const page = JSON.parse(files[IDX]!)
  if (apis) page.uses.apis = apis
  extra(page)
  files[IDX] = JSON.stringify(page)
  return files
}
const problems = (files: Record<string, string>) => {
  const result = loadModel(files)
  return result.ok ? [] : result.problems.map(problem => `${problem.path}: ${problem.message}`)
}

const products = { as: 'catalogue', datasource: 'ds_catalog', query: 'products' }

describe('uses.apis', () => {
  it('loads a page that uses a server and a browser API query, with and without args', () => {
    const files = withApis([{ ...products, args: { category: 'books' } }, { as: 'city', datasource: 'ds_weather', query: 'forecast', args: { city: { $route: 'city' } } }])
    expect(problems(files)).toEqual([])
    const result = loadModel(files)
    expect(result.ok && result.model.modules.blog!.pages.find(page => page.id === 'pg_index')!.uses!.apis).toHaveLength(2)
    expect(problems(withApis([products]))).toEqual([])
  })

  it('a page without apis is untouched, and the golden pages that use them are loaded', () => {
    const result = loadModel(fixtureModelFiles())
    expect(result.ok && result.model.modules.blog!.pages.filter(page => page.uses?.apis === undefined).map(page => page.id)).toEqual(['pg_index', 'pg_new_post', 'pg_post_detail'])
    expect(result.ok && result.model.modules.blog!.pages.filter(page => page.uses?.apis).map(page => `${page.id}:${page.uses!.apis![0]!.datasource}`)).toEqual(['pg_shop_catalog:ds_catalog', 'pg_weather:ds_weather'])
  })

  it('names the source, the query, the args and the alias when they are wrong', () => {
    expect(problems(withApis([{ ...products, datasource: 'ds_nope' }]))).toEqual([`${IDX}: uses.apis.0.datasource: Unknown data source "ds_nope"`])
    expect(problems(withApis([{ ...products, datasource: 'ds_main' }]))).toEqual([`${IDX}: uses.apis.0.datasource: "ds_main" is not an API data source`])
    expect(problems(withApis([{ ...products, query: 'nope' }]))).toEqual([`${IDX}: uses.apis.0.query: The API "catalog" has no query "nope" (products, product)`])
    expect(problems(withApis([{ ...products, args: { nope: 1 } }]))).toEqual([`${IDX}: uses.apis.0.args.nope: The query "products" of the API "catalog" has no parameter "nope" (category)`])
    // A path parameter is always required, a query parameter when it says so.
    expect(problems(withApis([{ as: 'one', datasource: 'ds_catalog', query: 'product' }]))).toEqual([`${IDX}: uses.apis.0.args: The query "product" of the API "catalog" needs "id"`])
    expect(problems(withApis([{ as: 'city', datasource: 'ds_weather', query: 'forecast' }]))).toEqual([`${IDX}: uses.apis.0.args: The query "forecast" of the API "weather" needs "city"`])
  })

  it('aliases are unique across all the page\'s uses', () => {
    expect(problems(withApis([{ ...products, as: 'featured' }]))).toEqual([`${IDX}: uses.apis.0.as: The name "featured" is used twice by this page's uses`])
    expect(problems(withApis([products, { ...products, query: 'products' }]))).toEqual([`${IDX}: uses.apis.1.as: The name "catalogue" is used twice by this page's uses`])
    expect(problems(withApis([{ ...products, as: 'preferences' }]))[0]).toMatch(/uses.apis.0.as: The name "preferences" is used twice/)
  })

  // A2 (verify): the edits refuse these aliases (`pageNameProblem`), so a hand-written file does too, with the same words.
  it('refuses an alias the page script declares itself or derives from another use', () => {
    const names = (as: string, more: Use[] = []) => problems(withApis([{ ...products, as }, ...more]))
    expect(names('layout')).toEqual([`${IDX}: uses.apis: "layout" is a name the page's script uses itself: pick another`])
    expect(names('route')).toEqual([`${IDX}: uses.apis: "route" is a name the page's script uses itself: pick another`])
    expect(names('catalogueLoading', [{ ...products, as: 'catalogue' }])[0]).toMatch(/^.*uses.apis: The page's script would declare "catalogueLoading" twice/)
    expect(names('catalogueError', [{ ...products, as: 'catalogue' }])[0]).toMatch(/would declare "catalogueError" twice/)
    expect(names('useCatalogProducts')).toEqual([`${IDX}: uses.apis: The page's script would declare "useCatalogProducts" twice: as "useCatalogProducts" and as the name the query products of the API catalog generates`])
  })

  // A1 (verify): the arguments follow the rules of the edits: a value of the parameter's type, a route parameter only for text, no null for a required one.
  it('refuses args the generated call would not compile', () => {
    const one = (args: Use) => problems(withApis([{ as: 'one', datasource: 'ds_catalog', query: 'product', args }]))
    expect(one({ id: 'abc' })).toEqual([`${IDX}: uses.apis.0.args: The query "product" of the API "catalog" takes "id" as integer, but the page passes "abc"`])
    expect(one({ id: { $route: 'slug' } })).toEqual([`${IDX}: uses.apis.0.args: The query "product" of the API "catalog" takes "id" as integer, but the page passes {"$route":"slug"}`])
    expect(one({ id: null })).toEqual([`${IDX}: uses.apis.0.args: The query "product" of the API "catalog" needs "id"`])
    expect(one({ id: 3 })).toEqual([])
    // What a value reads: its own answer, another answer, a name the page doesn't have.
    expect(one({ id: { $bind: 'one.id' } })[0]).toMatch(/"id" reads "one", the answer of this very use/)
    expect(one({ id: { $bind: 'nope.id' } })[0]).toMatch(/"id" reads "nope", which doesn't refer to anything this page uses/)
    expect(one({ id: { $bind: 'preferences.showDrafts' } })[0]).toMatch(/takes "id" as integer, but "preferences.showDrafts" is boolean/)
  })

  it('refuses a nullable state field into a parameter unless a fallback covers it', () => {
    const nullable = (args: Use) => {
      const files = withApis([{ as: 'one', datasource: 'ds_catalog', query: 'product', args }])
      const state = JSON.parse(files['.bildr/modules/blog/state/preferences.json']!)
      state.fields.push({ id: 'fld_note', name: 'note', type: 'integer', nullable: true })
      files['.bildr/modules/blog/state/preferences.json'] = JSON.stringify(state)
      return problems(files)
    }
    expect(nullable({ id: { $bind: 'preferences.note' } })[0]).toMatch(/"id" reads "preferences.note", which can be null/)
    expect(nullable({ id: { $bind: 'preferences.note', fallback: 1 } })).toEqual([])
  })

  it('refuses two uses that read each other\'s answers', () => {
    const cycle = problems(withApis([
      { as: 'a', datasource: 'ds_catalog', query: 'product', args: { id: { $bind: 'b.id' } } },
      { as: 'b', datasource: 'ds_catalog', query: 'product', args: { id: { $bind: 'a.id' } } }
    ]))
    expect(cycle).toHaveLength(2)
    expect(cycle.every(problem => /the answer of another API query/.test(problem))).toBe(true)
  })
})
