import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { project } from '../edit/helpers'

/**
 * Review P7 (R3), generated pages: W2 an argument that reads a state field or a template, W4 the key of a row, S1 a route parameter for a
 * number, S3 the empty text of a list that is still pending.
 */
const SHOP = 'ds_shop'

const shop = (model = [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }] as Array<Record<string, unknown>>) => {
  const p = project()
  p.edit('api_create', { name: 'shop', baseUrl: 'https://shop.example.com/v1' })
  p.edit('api_model_set', { datasource: SHOP, model: { name: 'Product', fields: model } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'products', path: '/products', params: [{ name: 'category', in: 'query', type: 'text' }, { name: 'page', in: 'query', type: 'integer', required: true }], result: { model: 'Product', many: true } } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'product', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }, { name: 'ratio', in: 'query', type: 'number' }], result: { model: 'Product', many: false } } })
  return p
}

type Project = ReturnType<typeof shop>

const pageOf = (p: Project, name: string) => generate(p.model()).find(file => file.path === `layers/blog/app/pages/${name}.vue`)!.content

const listPage = (p: Project, name: string, list: Record<string, unknown> = {}) => {
  const { pageId, nodeId } = p.edit('page_create', { name })
  p.edit('page_use_add', { page: pageId, as: 'products', api: { datasource: SHOP, query: 'products' }, args: { page: 1 } })
  p.edit('node_insert', { file: pageId, parentId: nodeId, type: 'List', props: { items: { $bind: 'products' }, as: 'item', ...list }, children: [{ type: 'Text', props: { text: { $template: '{item.title}' } } }] })
}

describe('W2: an argument that reads a state field or a template', () => {
  it('declares the state before the call, and reads its fields as a getter that unwraps them', () => {
    const p = shop()
    p.edit('state_create', { name: 'filters', fields: [{ name: 'category', type: 'text', default: 'books' }, { name: 'page', type: 'integer', default: 1 }] })
    const { pageId, nodeId } = p.edit('page_create', { name: 'filtered' })
    p.edit('page_use_add', { page: pageId, as: 'filters', state: 'st_filters' })
    p.edit('page_use_add', { page: pageId, as: 'products', api: { datasource: SHOP, query: 'products' }, args: { category: { $template: 'all-{filters.category}' }, page: { $bind: 'filters.page' } } })
    p.edit('node_insert', { file: pageId, parentId: nodeId, type: 'Text', props: { text: { $template: '{products.length} products' } } })
    const lines = pageOf(p, 'filtered').split('\n').map(line => line.trim())
    const state = lines.findIndex(line => /^const \{ filters \} = use/.test(line))
    const call = lines.findIndex(line => line.includes('= useShopProducts('))
    expect(state).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(state)
    expect(lines[call]).toContain('useShopProducts(() => ({ category: `all-${filters.value.category}`, page: filters.value.page }))')
  })
})

describe('W4: a row is keyed by its id only when the id is always there', () => {
  const key = (id: Record<string, unknown>) => {
    const p = shop([{ name: 'title', type: 'text' }, { name: 'id', ...id }])
    listPage(p, 'rows')
    return pageOf(p, 'rows').match(/v-for="([^"]+)" :key="([^"]+)"/)!.slice(1)
  }

  it('keys by id for a required text, integer or number', () => {
    for (const type of ['text', 'integer', 'number']) expect(key({ type })).toEqual(['item in (products ?? [])', 'item.id'])
  })

  it('keys by position for an optional, nullable or list id, or one that is not a plain scalar', () => {
    for (const id of [{ type: 'integer', optional: true }, { type: 'text', nullable: true }, { type: 'text', list: true }, { type: 'boolean' }, { type: 'datetime' }]) {
      expect(key(id), JSON.stringify(id)).toEqual(['(item, itemIndex) in (products ?? [])', 'itemIndex'])
    }
  })
})

describe('S1: a route parameter fills a number parameter', () => {
  it('converts it in the call, and the use-case checks the number the call gives', () => {
    const p = shop()
    const { pageId, nodeId } = p.edit('page_create', { name: 'detail', path: '/detail/:id/:ratio' })
    p.edit('page_use_add', { page: pageId, as: 'found', api: { datasource: SHOP, query: 'product' }, args: { id: { $route: 'id' }, ratio: { $route: 'ratio' } } })
    p.edit('node_update_props', { file: pageId, nodeId, props: { when: { $bind: 'found' }, loading: 'Loading…' } })
    p.edit('node_insert', { file: pageId, parentId: nodeId, type: 'Heading', props: { text: { $bind: 'found.title' } } })
    const files = generate(p.model())
    expect(files.find(file => file.path === 'layers/blog/app/pages/detail/[id]/[ratio].vue')!.content).toContain('useShopProduct(() => ({ id: Number(route.params.id), ratio: Number(route.params.ratio) }))')
    // A route value that isn't a number reaches the use-case as NaN, which its schema refuses: the page shows its error line.
    const useCase = files.find(file => file.path.endsWith('/use-cases/product.ts'))!.content
    expect(useCase).toContain('z.number().int()')
    expect(useCase).toContain('if (!parsed.success) return err(invalidInput(parsed.error.message))')
    expect(files.find(file => file.path === 'layers/blog/app/pages/detail/[id]/[ratio].vue')!.content).toContain('<p v-else-if="foundError" class="text-error">')
  })

  it('leaves a text parameter as it was', () => {
    const p = shop()
    const { pageId, nodeId } = p.edit('page_create', { name: 'cat', path: '/cat/:category' })
    p.edit('page_use_add', { page: pageId, as: 'products', api: { datasource: SHOP, query: 'products' }, args: { category: { $route: 'category' }, page: 1 } })
    p.edit('node_insert', { file: pageId, parentId: nodeId, type: 'Text', props: { text: { $template: '{products.length}' } } })
    expect(pageOf(p, 'cat/[category]')).toContain('useShopProducts(() => ({ category: route.params.category, page: 1 }))')
  })
})

describe('S3: the empty text of an API list waits for the answer', () => {
  it('chains a loading branch that renders nothing, then the error, the empty text and the items', () => {
    const p = shop()
    listPage(p, 'quiet', { empty: 'Nothing here.' })
    const lines = pageOf(p, 'quiet').split('\n').map(line => line.trim())
    const at = lines.findIndex(line => line.startsWith('<template v-if="productsLoading"'))
    expect(lines[at]).toBe('<template v-if="productsLoading" />')
    expect(lines[at + 1]).toBe('<p v-else-if="productsError" class="text-error">Couldn\'t load this.</p>')
    expect(lines[at + 2]).toBe('<p v-else-if="!(products ?? []).length" class="text-muted">Nothing here.</p>')
    expect(lines[at + 3]).toMatch(/^<div v-else/)
    expect(lines[at + 4]).toContain('v-for="item in (products ?? [])"')
  })

  it('keeps the loading text, and adds no branch without an empty text', () => {
    const p = shop()
    listPage(p, 'texted', { empty: 'Nothing here.', loading: 'Loading…' })
    expect(pageOf(p, 'texted')).not.toContain('<template v-if')
    listPage(p, 'bare')
    expect(pageOf(p, 'bare')).not.toContain('productsLoading')
  })
})
