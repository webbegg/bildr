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

  it('a page without apis is untouched', () => {
    const result = loadModel(fixtureModelFiles())
    expect(result.ok && result.model.modules.blog!.pages.every(page => page.uses?.apis === undefined)).toBe(true)
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

  it('an alias named layout reads as the page\'s own: a layout binding stays allowed in the tree', () => {
    const files = withApis([{ ...products, as: 'layout' }], (page) => {
      page.root.children[0].children[0].props = { level: 1, text: { $bind: 'layout.title' } }
    })
    expect(problems(files)).toEqual([])
  })
})
