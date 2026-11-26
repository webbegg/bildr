import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { starterKit } from '../../src/starter/index'
import { fixtureModelFiles } from '../model/fixture'

/**
 * Codegen of the `api` data sources, server runtime (simple data P2, SD-5): one layer `layers/apis/` with the
 * domain (entities, errors), the application (repository port, use-cases), the infrastructure (DTOs, validations, mappers, HTTP
 * repository over the core ApiClient), the server composition root, routes and composables, and the generated tests.
 * The golden fixture's "catalog" source: two models (Product nests Category in a list), a query with a query
 * parameter (remote key `cat`) and an itemsPath, a query with a path parameter, a POST action with a body and a
 * result, and a DELETE action with no result. The "weather" source runs in the browser (P3): see the browser group below.
 */
const PAGES_OF = {
  '.bildr/datasources/catalog.json': '.bildr/modules/blog/pages/shop-catalog.json',
  '.bildr/datasources/weather.json': '.bildr/modules/blog/pages/weather.json'
}
const files = (overrides: Record<string, string | null> = {}) => {
  const input = { ...fixtureModelFiles() }
  // The golden pages that use a source (P7a) go when a test changes or drops the source: they would not load against it.
  for (const [source, page] of Object.entries(PAGES_OF)) if (source in overrides) Reflect.deleteProperty(input, page)
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) Reflect.deleteProperty(input, path)
    else input[path] = content
  }
  const loaded = loadModel(input)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return generate(loaded.model)
}
const CATALOG = '.bildr/datasources/catalog.json'
const WEATHER = '.bildr/datasources/weather.json'
const catalog = () => JSON.parse(fixtureModelFiles()[CATALOG]!) as Record<string, unknown>
const paths = (generated: Array<{ path: string }>) => generated.map(file => file.path).filter(path => path.startsWith('layers/apis/'))
const read = (generated: Array<{ path: string, content: string }>, path: string) => generated.find(file => file.path === path)!.content
const weather = () => JSON.parse(fixtureModelFiles()[WEATHER]!) as Record<string, unknown>

/** The files of the server-runtime source (catalog), and the ones the layer shares for every source that has a client composable. */
const APIS_FILES = [
  'layers/apis/app/composables/apis/useCatalogCreateProduct.ts',
  'layers/apis/app/composables/apis/useCatalogDeleteProduct.ts',
  'layers/apis/app/composables/apis/useCatalogProduct.ts',
  'layers/apis/app/composables/apis/useCatalogProducts.ts',
  'layers/apis/app/data/api-query.ts',
  'layers/apis/nuxt.config.ts',
  'layers/apis/server/api/apis/catalog/create-product.post.ts',
  'layers/apis/server/api/apis/catalog/delete-product.delete.ts',
  'layers/apis/server/api/apis/catalog/product.get.ts',
  'layers/apis/server/api/apis/catalog/products.get.ts',
  'layers/apis/server/utils/catalog.ts',
  'layers/apis/shared/application/catalog/actions/create-product.ts',
  'layers/apis/shared/application/catalog/actions/delete-product.ts',
  'layers/apis/shared/application/catalog/ports/catalog-repository.ts',
  'layers/apis/shared/application/catalog/queries/product.ts',
  'layers/apis/shared/application/catalog/queries/products.ts',
  'layers/apis/shared/contracts/catalog/create-product.ts',
  'layers/apis/shared/contracts/catalog/delete-product.ts',
  'layers/apis/shared/contracts/catalog/product.ts',
  'layers/apis/shared/contracts/catalog/products.ts',
  'layers/apis/shared/domain/catalog/entities/category.ts',
  'layers/apis/shared/domain/catalog/entities/product.ts',
  'layers/apis/shared/domain/catalog/errors.ts',
  'layers/apis/shared/infrastructure/catalog/mappers/category.mapper.ts',
  'layers/apis/shared/infrastructure/catalog/mappers/product.mapper.ts',
  'layers/apis/shared/infrastructure/catalog/models/category.dto.ts',
  'layers/apis/shared/infrastructure/catalog/models/product.dto.ts',
  'layers/apis/shared/infrastructure/catalog/repositories/catalog-repository.http.ts',
  'layers/apis/shared/infrastructure/catalog/validations/category.schema.ts',
  'layers/apis/shared/infrastructure/catalog/validations/product.schema.ts',
  'layers/apis/test/catalog/catalog-repository.http.test.ts',
  'layers/apis/test/catalog/create-product.test.ts',
  'layers/apis/test/catalog/delete-product.test.ts',
  'layers/apis/test/catalog/fake-repository.ts',
  'layers/apis/test/catalog/mappers.mapper.test.ts',
  'layers/apis/test/catalog/product.test.ts',
  'layers/apis/test/catalog/products.test.ts'
]

/** The files of the browser-runtime source (weather): the same domain, data and tests; the browser composition and composables instead of the root and the routes. */
const BROWSER_FILES = [
  'layers/apis/app/composables/apis/useWeatherForecast.ts',
  'layers/apis/app/composables/apis/useWeatherReportForecast.ts',
  'layers/apis/app/data/weather.ts',
  'layers/apis/shared/application/weather/actions/report-forecast.ts',
  'layers/apis/shared/application/weather/ports/weather-repository.ts',
  'layers/apis/shared/application/weather/queries/forecast.ts',
  'layers/apis/shared/domain/weather/entities/forecast.ts',
  'layers/apis/shared/domain/weather/errors.ts',
  'layers/apis/shared/infrastructure/weather/mappers/forecast.mapper.ts',
  'layers/apis/shared/infrastructure/weather/models/forecast.dto.ts',
  'layers/apis/shared/infrastructure/weather/repositories/weather-repository.http.ts',
  'layers/apis/shared/infrastructure/weather/validations/forecast.schema.ts',
  'layers/apis/test/weather/fake-repository.ts',
  'layers/apis/test/weather/forecast.test.ts',
  'layers/apis/test/weather/mappers.mapper.test.ts',
  'layers/apis/test/weather/report-forecast.test.ts',
  'layers/apis/test/weather/weather-repository.http.test.ts'
]

describe('generate: server-runtime api sources', () => {
  const generated = files()

  it('emits the SD-5 files of the source, all managed and pointing at its model file', () => {
    expect(paths(generated)).toEqual([...APIS_FILES, ...BROWSER_FILES].sort())
    for (const file of generated.filter(entry => entry.path.startsWith('layers/apis/') && entry.path.includes('/catalog/') && !entry.path.includes('/server/api/'))) {
      expect(file.owner, file.path).toBe('managed')
      expect(file.content.startsWith('// Generated by bildr'), file.path).toBe(true)
    }
    expect(generated.find(file => file.path === 'layers/apis/shared/domain/catalog/errors.ts')?.source).toBe(CATALOG)
  })

  it('types the entities like the other entities and keeps the DTO on the remote keys', () => {
    expect(read(generated, 'layers/apis/shared/domain/catalog/entities/product.ts')).toContain([
      'export const ProductSchema = z.object({',
      '  id: z.number().int(),',
      '  name: z.string(),',
      '  price: z.number(),',
      '  inStock: z.boolean().optional(),',
      '  createdAt: z.iso.datetime({ offset: true }),',
      '  note: z.string().nullable(),',
      '  categories: z.array(CategorySchema)',
      '})'
    ].join('\n'))
    expect(read(generated, 'layers/apis/shared/infrastructure/catalog/models/product.dto.ts')).toContain([
      'export interface ProductDto {',
      '  id: number',
      '  name: string',
      '  price: number',
      '  in_stock?: boolean',
      '  created_at: string',
      '  note: string | null',
      '  categories: CategoryDto[]',
      '}'
    ].join('\n'))
    const schema = read(generated, 'layers/apis/shared/infrastructure/catalog/validations/product.schema.ts')
    expect(schema).toContain('export const ProductDtoSchema: z.ZodType<ProductDto> = z.object({')
    expect(schema).toContain('  created_at: z.iso.datetime({ offset: true }),')
    expect(schema).toContain('  categories: z.array(CategoryDtoSchema)')
  })

  it('maps both ways between the DTO and the entity, nested models included', () => {
    const mapper = read(generated, 'layers/apis/shared/infrastructure/catalog/mappers/product.mapper.ts')
    expect(mapper).toContain('export const toProduct = (dto: ProductDto): Product => ({')
    expect(mapper).toContain('  inStock: dto.in_stock,')
    expect(mapper).toContain('  createdAt: dto.created_at,')
    expect(mapper).toContain('  categories: dto.categories.map(toCategory)')
    expect(mapper).toContain('export const fromProduct = (entity: Product): ProductDto => ({')
    expect(mapper).toContain('  created_at: entity.createdAt,')
    expect(mapper).toContain('  categories: entity.categories.map(fromCategory)')
  })

  it('has a port with one method per query and action, and one use-case each that validates its input', () => {
    const port = read(generated, 'layers/apis/shared/application/catalog/ports/catalog-repository.ts')
    expect(port).toContain('export interface CatalogRepository {')
    // Result-only (T3b): the port answers the error of a call, it never throws it.
    expect(port).toContain('  products(input: { category?: string, locale?: string }): Promise<KernelResult<Product[], CatalogError>>')
    expect(port).toContain('  product(input: { id: number }): Promise<KernelResult<Product, CatalogError>>')
    expect(port).toContain('  createProduct(input: { body: Product }): Promise<KernelResult<Product, CatalogError>>')
    // An operation that answers nothing answers `undefined`: it is a type argument of its composable, which `void` can't be.
    expect(port).toContain('  deleteProduct(input: { id: number }): Promise<KernelResult<undefined, CatalogError>>')
    const useCase = read(generated, 'layers/apis/shared/application/catalog/queries/products.ts')
    expect(useCase).toContain('export const ProductsInputSchema = z.object({\n  category: z.string().optional(),\n  locale: z.string().optional()\n})')
    expect(useCase).toContain('export const products = (deps: ProductsDeps) =>')
    expect(useCase).toContain('Promise<KernelResult<Product[], CatalogError>>')
    expect(useCase).toContain('ProductsInputSchema.safeParse(input)')
    expect(useCase).toContain('    return deps.catalog.products(parsed.data)\n')
    expect(useCase).not.toContain('catch')
    expect(read(generated, 'layers/apis/shared/application/catalog/actions/create-product.ts')).toContain('  body: ProductSchema')
    expect(read(generated, 'layers/apis/shared/application/catalog/actions/delete-product.ts')).toContain('Promise<KernelResult<undefined, CatalogError>>')
    expect(read(generated, 'layers/apis/shared/domain/catalog/errors.ts')).not.toContain('class')
    // No source's files declare or throw a failure of their own any more (T3b): only the core client's HttpFailure is named.
    // The query helpers are the exception: TanStack Query knows only thrown errors, so a query's error Result travels through it in one (`Answered`).
    const apis = generated.filter(file => file.path.startsWith('layers/apis/') && file.path !== 'layers/apis/app/data/api-query.ts').map(file => file.content).join('\n')
    expect(apis.match(/\b\w*Failure\b/g)?.filter(name => name !== 'HttpFailure') ?? []).toEqual([])
    expect(apis).not.toMatch(/class \w+ extends Error/)
  })

  it('builds the paths (encoded), the query on its remote key, reads itemsPath and validates the answers', () => {
    const http = read(generated, 'layers/apis/shared/infrastructure/catalog/repositories/catalog-repository.http.ts')
    expect(http).toContain('export const httpCatalogRepository = (http: ApiClient<CatalogError>, onInvalidAnswer?: (detail: string) => void): CatalogRepository => ({')
    // A query parameter on its remote key, a list read under data.items.
    expect(http).toContain('http(\'/products\', { method: \'GET\', query: { cat: input.category }, headers: { \'X-Api-Version\': \'2\', \'Accept-Language\': localeHeader.value } })')
    // The client's error is passed on as it is; the answer is read, then mapped.
    expect(http).toContain('    if (!answer.ok) return answer\n    const dtos = read(z.array(ProductDtoSchema), itemsAt(answer.value, [\'data\', \'items\']), onInvalidAnswer)\n    return dtos.ok ? ok(dtos.value.map(toProduct)) : dtos')
    // A path parameter, checked and encoded before the call, and a single model.
    expect(http).toContain('    const idSegment = segment(input.id)\n    if (!idSegment.ok) return idSegment\n    const answer = await http(`/products/${idSegment.value}`, { method: \'GET\' })')
    expect(http).toContain('return ok(encodeURIComponent(text))')
    expect(http).toContain('return dto.ok ? ok(toProduct(dto.value)) : dto')
    // A body mapped to the remote, a call with no result.
    expect(http).toContain('{ method: \'POST\', body: fromProduct(input.body) }')
    expect(http).toContain('const answer = await http(`/products/${idSegment.value}`, { method: \'DELETE\' })\n    return answer.ok ? ok(undefined) : answer')
    // The error has no detail (it reaches the browser): the detail goes to the reporter the composition root gives.
    expect(http).toContain('report?.(parsed.error.message)')
    expect(http).toContain('return err(invalidAnswer())')
    expect(http).not.toMatch(/invalidAnswer\(parsed/)
    // A path parameter is one segment: no "/" or "\\" either.
    expect(http).toContain('if (/[/\\\\]/.test(text)) return err(invalidInput(')
    expect(http).not.toContain('throw')
  })

  it('calls through the core ApiClient, typed by the source\'s error: no client of its own (codegen-architecture T3d)', () => {
    expect(read(generated, 'layers/apis/shared/infrastructure/catalog/repositories/catalog-repository.http.ts')).toContain('import type { ApiClient } from \'#core/http/api-client\'')
    expect(paths(generated).filter(path => path.startsWith('layers/apis/') && path.endsWith('/client.ts'))).toEqual([])
  })

  it('keeps the source in the rings of a module: its domain and use-cases import no adapter', () => {
    for (const file of generated.filter(entry => /^layers\/apis\/shared\/(domain|application)\//.test(entry.path))) {
      expect(file.content, file.path).not.toMatch(/from '[^']*infrastructure/)
    }
  })

  it('wires the server: a client over fetch under the base URL, a route per operation, a composable each', () => {
    const root = read(generated, 'layers/apis/server/utils/catalog.ts')
    expect(root).toContain('useRuntimeConfig().apis.catalog')
    expect(root).toContain('export const useCatalogApi = () => {')
    expect(root).toContain('httpCatalogRepository(catalogClient(), detail => console.error(')
    // Every error type has its status: one added without it does not compile.
    expect(root).toContain('export const catalogErrorStatus = {')
    expect(root).toContain('} satisfies Record<CatalogError[\'type\'], number>')
    // A failed call is the source's error, through the core client (T3a, T3d).
    expect(root).toContain(': remoteFailed(failure.type, failure.status, failure.message, failure.retryAfter))')
    expect(root).toContain('import { type ApiClient, resultClient } from \'#core/http/api-client\'')
    expect(root).toContain('import { createHttpClient } from \'#core/http/client\'')
    const client = read(generated, 'layers/core/shared/http/client.ts')
    expect(client).toContain('redirect: \'manual\'')
    expect(client).toContain('AbortSignal.timeout(')
    expect(client).toContain('url.origin !== base.origin || decoded(url.pathname) !== decoded(`${base.pathname}${written}`)')
    expect(client).toContain('const MAX_BYTES = 1_000_000')
    const route = read(generated, 'layers/apis/server/api/apis/catalog/products.get.ts')
    expect(route).toContain('getValidatedQuery(event, productsContract.query)')
    expect(route).toContain('unwrapOrThrow(await useCatalogApi().products(input), catalogErrorStatus, event)')
    expect(read(generated, 'layers/apis/shared/contracts/catalog/product.ts')).toContain('id: z.coerce.number().int()')
    const post = read(generated, 'layers/apis/server/api/apis/catalog/create-product.post.ts')
    expect(post).toContain('readValidatedBody(event, createProductContract.body)')
    expect(post).toContain('useCatalogApi().createProduct({ body })')
    expect(read(generated, 'layers/apis/server/api/apis/catalog/delete-product.delete.ts')).toContain('setResponseStatus(event, 204)')
    expect(read(generated, 'layers/apis/shared/contracts/catalog/products.ts')).toContain('  path: \'/api/apis/catalog/products\'')
    expect(read(generated, 'layers/apis/app/composables/apis/useCatalogProducts.ts')).toContain('$fetch<ProductsResponse>(productsContract.path')
    expect(read(generated, 'layers/apis/app/composables/apis/useCatalogCreateProduct.ts')).toContain('$fetch<CreateProductResponse>(createProductContract.path')
  })

  it('reads the secret only from the source\'s runtimeConfig: a bearer token', () => {
    const root = read(generated, 'layers/apis/server/utils/catalog.ts')
    expect(root).toContain('const config = useRuntimeConfig().apis.catalog')
    expect(root).toContain('if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`')
    expect(generated.filter(file => file.path.startsWith('layers/apis/')).map(file => file.content).join('\n')).not.toMatch(/https:\/\/catalog\.example\.com|NUXT_DATASOURCES/)
  })

  it('sends a header auth as its own header, and none without auth', () => {
    const source = { ...catalog(), auth: { type: 'header', secret: 'apiKey', header: 'X-Api-Key' } }
    expect(read(files({ [CATALOG]: JSON.stringify(source) }), 'layers/apis/server/utils/catalog.ts')).toContain('if (config.apiKey) headers[\'X-Api-Key\'] = config.apiKey')
    const { auth: _, ...open } = source
    const env = { baseUrl: 'NUXT_APIS_CATALOG_BASE_URL' }
    const root = read(files({ [CATALOG]: JSON.stringify({ ...open, env }) }), 'layers/apis/server/utils/catalog.ts')
    expect(root).toContain('const config = useRuntimeConfig().apis.catalog')
    expect(root).not.toMatch(/authorization|Bearer|config\.apiKey/i)
  })

  it('puts the source in the core runtimeConfig under apis (not datasources), with its base URL and an empty secret', () => {
    const config = read(generated, 'layers/core/nuxt.config.ts')
    expect(config).toContain('apis: {\n      catalog: { baseUrl: \'https://catalog.example.com/v1\', apiKey: \'\' }\n    }')
    expect(config.split('apis: {')[0]).not.toContain('catalog')
    expect(config).toContain('datasources: {\n      quotes:')
  })

  it('runs the generated tests with the unit project, and registers the layer\'s composables', () => {
    expect(read(generated, 'vitest.config.ts')).toContain('\'layers/apis/test/**/*.test.ts\'')
    expect(read(generated, 'layers/apis/nuxt.config.ts')).toContain('imports: { dirs: [here(\'./app/composables/apis\')] }')
  })

  it('tests the repository against a fake ApiClient and every use-case', () => {
    const test = read(generated, 'layers/apis/test/catalog/catalog-repository.http.test.ts')
    expect(test).toContain('httpCatalogRepository(http).products(')
    expect(test).toContain('/products/1')
    expect(test).toContain('invalid_answer')
    expect(read(generated, 'layers/apis/test/catalog/products.test.ts')).toContain('invalid_input')
  })
})

describe('generate: an invalid upstream answer never reaches the browser (verify R1-001)', () => {
  const generated = files()

  it('the domain error is generic: no zod message, no field path, no body', () => {
    const errors = read(generated, 'layers/apis/shared/domain/catalog/errors.ts')
    expect(errors).toContain('export const invalidAnswer = (): CatalogError => ({ type: \'invalid_answer\', message: \'The "catalog" API answered something unexpected\' })')
    expect(errors).not.toMatch(/answered something unexpected: /)
  })

  it('the composition root logs the detail on the server, and the route hands the browser the error as it is', () => {
    const root = read(generated, 'layers/apis/server/utils/catalog.ts')
    expect(root).toContain('httpCatalogRepository(catalogClient(), detail => console.error(\'The "catalog" API answered something unexpected: \' + detail))')
    expect(read(generated, 'layers/apis/server/api/apis/catalog/products.get.ts')).toContain('unwrapOrThrow(await useCatalogApi().products(input), catalogErrorStatus, event)')
  })

  it('the generated repository test asserts the generic message and the report', () => {
    const test = read(generated, 'layers/apis/test/catalog/catalog-repository.http.test.ts')
    expect(test).toContain('message: \'The "catalog" API answered something unexpected\'')
    expect(test).toContain('detail => expect(detail.length).toBeGreaterThan(0)')
  })
})

describe('generate: an API with auth refuses a call when its secret is not set (verify R3-004)', () => {
  const generated = files()
  const root = read(generated, 'layers/apis/server/utils/catalog.ts')

  it('the client is told when the secret is empty, and the root answers a typed not_configured naming the env var (never a value)', () => {
    expect(root).toContain('createHttpClient({ baseUrl: config.baseUrl, headers, unconfigured: String(config.apiKey ?? \'\').trim() === \'\' })')
    expect(root).toContain('return resultClient(call, failure => failure.notConfigured')
    expect(root).toContain('{ type: \'not_configured\', message: \'The "catalog" API is not configured: set NUXT_APIS_CATALOG_API_KEY\' }')
    expect(root).toContain('  not_configured: 503')
    expect(read(generated, 'layers/apis/shared/domain/catalog/errors.ts')).toContain('  | { type: \'not_configured\', message: string }')
  })

  it('a source without auth has none of it', () => {
    const { auth: _, ...open } = catalog()
    const noAuth = files({ [CATALOG]: JSON.stringify({ ...open, env: { baseUrl: 'NUXT_APIS_CATALOG_BASE_URL' } }) })
    expect(read(noAuth, 'layers/apis/server/utils/catalog.ts')).not.toMatch(/not_configured|unconfigured|notConfigured/)
    expect(read(noAuth, 'layers/apis/shared/domain/catalog/errors.ts')).not.toContain('not_configured')
  })

  it('names the runtimeConfig key when a hand-written source maps no env var for its secret', () => {
    const source = { ...catalog(), env: { baseUrl: 'NUXT_APIS_CATALOG_BASE_URL' } }
    const loaded = loadModel({ ...fixtureModelFiles(), [CATALOG]: JSON.stringify(source) })
    // Either the load refuses it, or the message names the key: never an empty "set ".
    if (loaded.ok) expect(read(generate(loaded.model), 'layers/apis/server/utils/catalog.ts')).toContain('set runtimeConfig.apis.catalog.apiKey')
  })

  it('has a generated unit test of the client: unset secret refused before fetch, dot segments refused', () => {
    const test = read(generated, 'layers/core/test/infrastructure/http-client.test.ts')
    expect(test).toContain('unconfigured: true')
    expect(test).toContain('rejects.toMatchObject({ status: 0, notConfigured: true })')
    expect(test).toContain('expect(calls).toEqual([])')
    expect(test).toContain('\'%2e%2e\'')
  })
})

describe('generate: the mapper tests reach the optional, nullable and list branches (verify R3-001)', () => {
  const generated = files()
  const test = read(generated, 'layers/apis/test/catalog/mappers.mapper.test.ts')

  it('maps a Product with its optional key absent, its nullable null and its list empty', () => {
    expect(test).toContain('Product: maps to the domain (optional fields absent, nullable fields null, lists empty)')
    expect(test).toContain([
      '    expect(toProduct({',
      '      id: 1,',
      '      name: \'name 1\',',
      '      price: 1.5,',
      '      created_at: \'2024-01-02T03:04:05.000Z\',',
      '      note: null,',
      '      categories: []',
      '    })).toEqual({',
      '      id: 1,',
      '      name: \'name 1\',',
      '      price: 1.5,',
      '      createdAt: \'2024-01-02T03:04:05.000Z\',',
      '      note: null,',
      '      categories: []',
      '    })'
    ].join('\n'))
  })

  it('also maps every field set', () => {
    expect(test).toContain('Product: maps to the domain (every field has a value)')
    expect(test).toContain('Category: maps to the domain (every field has a value)')
    // Category has nothing optional, nullable or a list: one case.
    expect(test.match(/Category: maps/g)).toHaveLength(1)
  })

  it('takes a body round trip for the body model and what it nests, and none for the rest', () => {
    expect(test).toContain('Product: goes back to what the API sent (optional fields absent, nullable fields null, lists empty)')
    expect(test).toContain('expect(fromProduct(toProduct({')
    expect(test).toContain('Category: goes back to what the API sent (every field has a value)')
    expect(test).toContain('import { fromCategory, toCategory } from')
  })

  it('does not round trip a model that is only read, and has no test file without a model', () => {
    const shape = { ...catalog(), actions: [], queries: (catalog().queries as unknown[]) }
    expect(read(files({ [CATALOG]: JSON.stringify(shape) }), 'layers/apis/test/catalog/mappers.mapper.test.ts')).not.toContain('goes back')
    const ping = { ...catalog(), models: [], queries: [], actions: [{ name: 'ping', method: 'POST', path: '/ping', params: [] }] }
    expect(paths(files({ [CATALOG]: JSON.stringify(ping) }))).not.toContain('layers/apis/test/catalog/mappers.mapper.test.ts')
  })

  it('has a null case apart from the absent one when a field is optional and nullable, and an empty list for an optional list', () => {
    const source = {
      ...catalog(),
      models: [{ name: 'Item', fields: [{ name: 'id', type: 'integer' }, { name: 'tag', type: 'text', optional: true, nullable: true }, { name: 'parts', type: 'integer', list: true, optional: true }] }],
      queries: [{ name: 'items', path: '/items', params: [], result: { model: 'Item', many: true } }],
      actions: []
    }
    const mapper = read(files({ [CATALOG]: JSON.stringify(source) }), 'layers/apis/test/catalog/mappers.mapper.test.ts')
    expect(mapper).toContain('Item: maps to the domain (optional fields absent)')
    expect(mapper).toContain('Item: maps to the domain (nullable fields null, lists empty)')
    expect(mapper).toContain('      tag: null,\n      parts: []')
  })
})

/**
 * Browser runtime (simple data P3, S7/S8): the same domain, data and tests as a server source (the P2 generators), but no composition root and no
 * Nitro route: the composables build the HTTP repository over a browser ApiClient and call the use-case in the page.
 */
describe('generate: browser-runtime api sources', () => {
  const generated = files()
  const fromWeather = (path: string) => read(generated, `layers/apis/${path}`)
  const SOURCE = 'layers/apis/'

  it('emits the domain, data and test files of the source and the browser composition: no server root, route or fetch client', () => {
    const own = paths(generated).filter(path => BROWSER_FILES.includes(path))
    expect(own).toEqual(BROWSER_FILES)
    expect(paths(generated).filter(path => path.includes('weather') && path.includes('/server/'))).toEqual([])
    expect(paths(generated).filter(path => path.includes('/server/api/apis/weather'))).toEqual([])
    for (const file of generated.filter(entry => BROWSER_FILES.includes(entry.path) && entry.path.includes('/weather/'))) {
      expect(file.owner, file.path).toBe('managed')
      expect(file.source, file.path).toBe(WEATHER)
    }
    expect(generated.find(file => file.path === `${SOURCE}app/data/weather.ts`)?.source).toBe(WEATHER)
  })

  it('reuses the P2 generators: the domain, data and tests of a source are the same whether it runs on the server or in the browser', () => {
    const { env: _, ...rest } = weather()
    const asServer = files({ [WEATHER]: JSON.stringify({ ...rest, runtime: 'server', env: { baseUrl: 'NUXT_APIS_WEATHER_BASE_URL' } }) })
    // A server source's HTTP contracts are its routes': a browser source has none.
    const shared = (path: string) => (path.startsWith(`${SOURCE}shared/`) || path.startsWith(`${SOURCE}test/weather/`)) && path.includes('weather')
      && !path.startsWith(`${SOURCE}shared/contracts/`)
    const same = paths(generated).filter(shared)
    expect(same.length).toBeGreaterThan(10)
    expect(paths(asServer).filter(shared)).toEqual(same)
    // Only the error text that says where the detail of an invalid answer goes differs.
    const differing = same.filter(path => read(asServer, path) !== read(generated, path))
    expect(differing).toEqual([`${SOURCE}shared/domain/weather/errors.ts`])
  })

  it('has the entities, the port and the use-cases of the model', () => {
    expect(fromWeather('shared/domain/weather/entities/forecast.ts')).toContain('  observedAt: z.iso.datetime({ offset: true })')
    expect(fromWeather('shared/application/weather/ports/weather-repository.ts')).toContain('  forecast(input: { city: string }): Promise<KernelResult<Forecast, WeatherError>>')
    expect(fromWeather('shared/application/weather/actions/report-forecast.ts')).toContain('deps.weather.reportForecast(parsed.data)')
  })

  it('composes in app/: a browser client over the base URL of runtimeConfig.public.apis.weather, nothing else', () => {
    const root = fromWeather('app/data/weather.ts')
    expect(root).toContain('useRuntimeConfig().public.apis.weather.baseUrl')
    expect(root).toContain('export const useWeatherApi = () => {')
    // The use-cases are bound to the signal of the call (verify R3-003: a cancelled query cancels its request).
    expect(root).toContain('return (signal?: AbortSignal) => {')
    expect(root).toContain('httpWeatherRepository(weatherClient(baseUrl, signal), detail => console.warn(')
    expect(root).toContain('forecast: forecast({ weather: repository })')
    expect(root).toContain('reportForecast: reportForecast({ weather: repository })')
    // It reads no other setting: no secret, no server config.
    expect(root.match(/useRuntimeConfig\(\)/g)).toHaveLength(1)
    expect(root).not.toContain('ErrorStatusMap')
    expect(root).not.toContain('console.error')
    expect(root).not.toContain('nuxt/server')
  })

  it('calls through the core client, as the server does, with no credentials: only `accept` and the query\'s signal', () => {
    expect(fromWeather('app/data/weather.ts')).toContain('createHttpClient({ baseUrl, headers: { accept: \'application/json\' }, signal })')
    const client = read(generated, 'layers/core/shared/http/client.ts')
    expect(client).toContain('redirect: \'manual\'')
    expect(client).toContain('anyOf([cancel, timeout])')
    expect(client).toContain('opaqueredirect')
    expect(client).toContain('credentials: \'omit\'')
    expect(client).toContain('AbortSignal.timeout(')
    expect(client).toContain('const MAX_BYTES = 1_000_000')
    expect(client).toContain('url.origin !== base.origin || decoded(url.pathname) !== decoded(`${base.pathname}${written}`)')
    expect(client).toContain('/^(?:\\.|%2e){1,2}$/i')
    // It reads no setting and sets no credential: what it sends is what its caller gives it.
    expect(client).not.toMatch(/useRuntimeConfig|authorization|bearer/i)
  })

  it('has composables with the signature of the server ones, calling the use-case directly (no $fetch, no route)', () => {
    const query = fromWeather('app/composables/apis/useWeatherForecast.ts')
    expect(query).toContain('export const useWeatherForecast = (input: MaybeRefOrGetter<ForecastInput>) => {')
    expect(query).toContain('const api = useWeatherApi()')
    // The source's error is the query's (T3c): the use-case's Result is handed over as it is.
    expect(query).toContain('useApiQuery<ForecastInput, Forecast, WeatherError>({')
    expect(query).toContain('key: [\'apis\', \'weather\', \'forecast\'],')
    // The query passes the AbortSignal of its fetch on, as the server composables give it to $fetch.
    expect(query).toContain('fetch: (query, signal) => api(signal).forecast(query)')
    const action = fromWeather('app/composables/apis/useWeatherReportForecast.ts')
    expect(action).toContain('export const useWeatherReportForecast = () => {')
    expect(action).toContain('useApiAction<ReportForecastInput, Forecast, WeatherError>(')
    expect(action).toContain('input => api().reportForecast(input)')
    expect(action).toContain('[\'apis\', \'weather\']')
    for (const text of [query, action]) expect(text).not.toMatch(/\$fetch|\/api\/apis/)
  })

  it('keeps the use-case in charge of the error the UI sees: generic for an invalid answer, the detail goes to console.warn', () => {
    const errors = fromWeather('shared/domain/weather/errors.ts')
    expect(errors).toContain('export const invalidAnswer = (): WeatherError => ({ type: \'invalid_answer\', message: \'The "weather" API answered something unexpected\' })')
    expect(errors).toContain('console.warn')
    expect(fromWeather('app/data/weather.ts')).toContain('console.warn(\'The "weather" API answered something unexpected: \' + detail)')
    // The query hands the use-case's error on as it is: no message is rewritten on the way.
    expect(fromWeather('app/data/api-query.ts')).toContain('if (!result.ok) throw new Answered(result.error)')
  })

  it('has no auth at all: nothing reads a secret, nothing sets a credential header', () => {
    const text = BROWSER_FILES.filter(path => path.includes('weather')).map(path => fromWeather(path.replace(SOURCE, ''))).join('\n')
    expect(text).not.toMatch(/authorization|bearer|api[-_ ]?key|secret|not_configured|unconfigured|cookie/i)
    expect(fromWeather('app/data/weather.ts')).toContain('no auth')
  })

  it('refuses an auth for a browser source (the model does, so nothing is generated for it)', () => {
    const loaded = loadModel({ ...fixtureModelFiles(), [WEATHER]: JSON.stringify({ ...weather(), auth: { type: 'bearer', secret: 'apiKey' } }) })
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) expect(JSON.stringify(loaded.problems)).toContain('can\'t use a secret')
  })

  it('puts the base URL in runtimeConfig.public.apis (env NUXT_PUBLIC_APIS_WEATHER_BASE_URL), and nothing of it under the server apis', () => {
    const config = read(generated, 'layers/core/nuxt.config.ts')
    expect(config).toContain('public: {\n      apis: {\n        weather: { baseUrl: \'https://weather.example.com/v1\' }\n      }\n    }')
    expect(config).toContain('apis: {\n      catalog: { baseUrl: \'https://catalog.example.com/v1\', apiKey: \'\' }\n    },')
    expect(config.slice(0, config.indexOf('public: {'))).not.toContain('weather')
    expect(JSON.parse(fixtureModelFiles()[WEATHER]!).env).toEqual({ baseUrl: 'NUXT_PUBLIC_APIS_WEATHER_BASE_URL' })
  })

  it('has a generated unit test of the client, and the unit project runs the tests of a browser-only project', () => {
    const test = read(generated, 'layers/core/test/infrastructure/http-client.test.ts')
    expect(test).toContain('credentials: \'omit\'')
    expect(test).toContain('expect(calls).toEqual([])')
    expect(test).toContain('\'%2e%2e\'')
    const browserOnly = files({ [CATALOG]: null })
    expect(read(browserOnly, 'vitest.config.ts')).toContain('\'layers/apis/test/**/*.test.ts\'')
    expect(paths(browserOnly)).toEqual([...BROWSER_FILES, 'layers/apis/app/data/api-query.ts', 'layers/apis/nuxt.config.ts'].sort())
    expect(read(browserOnly, 'layers/core/nuxt.config.ts')).toContain('datasources: {\n      quotes:')
    expect(read(browserOnly, 'layers/core/nuxt.config.ts')).not.toContain('apis: {\n      catalog')
  })

  it('a server source next to it is unchanged: no public config without a browser source', () => {
    const serverOnly = files({ [WEATHER]: null })
    expect(paths(serverOnly)).toEqual(APIS_FILES)
    const config = read(serverOnly, 'layers/core/nuxt.config.ts')
    expect(config).not.toContain('public')
    expect(config).toContain('apis: {\n      catalog: { baseUrl: \'https://catalog.example.com/v1\', apiKey: \'\' }\n    }\n')
  })

  it('a catalog turned to the browser runtime generates the same kinds of files, with its composables named as the server ones', () => {
    const { auth: _, ...source } = catalog()
    const browser = { ...source, runtime: 'browser', env: { baseUrl: 'NUXT_PUBLIC_APIS_CATALOG_BASE_URL' } }
    const turned = files({ [CATALOG]: JSON.stringify(browser) })
    const names = (list: string[]) => list.filter(path => path.includes('/composables/')).map(path => path.split('/').pop())
    expect(names(paths(turned))).toEqual(names([...APIS_FILES, ...BROWSER_FILES].sort()))
    expect(paths(turned).some(path => path.includes('/server/'))).toBe(false)
    expect(paths(turned)).toContain('layers/apis/app/data/catalog.ts')
    expect(read(turned, 'layers/core/nuxt.config.ts')).toContain('weather: { baseUrl: \'https://weather.example.com/v1\' }')
    expect(read(turned, 'layers/core/nuxt.config.ts')).toContain('catalog: { baseUrl: \'https://catalog.example.com/v1\' }')
    expect(read(turned, 'layers/core/nuxt.config.ts')).not.toContain('apis: {\n      catalog')
  })

  it('two sources whose composables would have one name: the generator throws, for a browser source too', () => {
    const { env: _, ...rest } = weather()
    const clash = { ...rest, name: 'weather-forecast', id: 'ds_wf', env: { baseUrl: 'NUXT_PUBLIC_APIS_WEATHER_FORECAST_BASE_URL' }, queries: [], actions: [{ name: 'x', method: 'POST', path: '/x', params: [] }] }
    const a = { ...clash, name: 'a-b', id: 'ds_ab', env: { baseUrl: 'NUXT_PUBLIC_APIS_A_B_BASE_URL' }, actions: [{ name: 'c', method: 'POST', path: '/c', params: [] }] }
    const b = { ...clash, name: 'a', id: 'ds_a', env: { baseUrl: 'NUXT_PUBLIC_APIS_A_BASE_URL' }, actions: [{ name: 'bC', method: 'POST', path: '/c', params: [] }] }
    expect(() => files({ '.bildr/datasources/a-b.json': JSON.stringify(a), '.bildr/datasources/a.json': JSON.stringify(b) })).toThrow(/would both generate the composable useABC/)
  })
})

describe('generate: api sources it leaves out', () => {
  it('generates no layers/apis file without an api source, and the same project otherwise', () => {
    const generated = files({ [CATALOG]: null, [WEATHER]: null })
    expect(paths(generated)).toEqual([])
    expect(read(generated, 'vitest.config.ts')).not.toContain('apis')
    expect(read(generated, 'layers/core/nuxt.config.ts')).not.toContain('catalog')
    const withApi = files()
    const same = (path: string) => generated.find(file => file.path === path)?.content === withApi.find(file => file.path === path)?.content
    expect(generated.filter(file => !file.path.startsWith('layers/apis/') && !['vitest.config.ts', 'layers/core/nuxt.config.ts'].includes(file.path)).every(file => same(file.path))).toBe(true)
  })

  it('generates nothing for a source with no query and no action (it has nothing to call)', () => {
    const empty = { ...catalog(), models: [], queries: [], actions: [] }
    expect(paths(files({ [CATALOG]: JSON.stringify(empty) }))).toEqual(paths(files({ [CATALOG]: null })))
    expect(paths(files({ [CATALOG]: JSON.stringify(empty) }))).toEqual(expect.arrayContaining(BROWSER_FILES))
    const quiet = { ...weather(), models: [], queries: [], actions: [] }
    const generated = files({ [CATALOG]: null, [WEATHER]: JSON.stringify(quiet) })
    expect(paths(generated)).toEqual([])
    // Its base URL is still in the public runtimeConfig.
    expect(read(generated, 'layers/core/nuxt.config.ts')).toContain('weather: { baseUrl: \'https://weather.example.com/v1\' }')
  })
})

describe('generate: the module name "apis" is reserved', () => {
  it('refuses a module named apis, whose layer the API data sources use', () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const { blog, ...others } = loaded.model.modules
    expect(() => generate({ ...loaded.model, modules: { ...others, apis: blog! } })).toThrow('Module name "apis" is reserved')
  })

  it('the starter kit refuses it as the first module', () => {
    expect(() => starterKit({ name: 'Shop', module: 'apis' })).toThrow('Module name "apis" is reserved')
  })
})
