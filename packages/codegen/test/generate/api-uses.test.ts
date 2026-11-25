import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { findNode, project } from '../edit/helpers'

/** Simple data P7a (SD-6): pages that use API queries (`uses.apis`) generate the composable call, the list over its data and the error line. */

const SHOP = 'ds_shop'

/** The golden blog (its "weather" API runs in the browser) with a "shop" API (server): a model with an id, one without, a nested one, and the queries. */
const shop = () => {
  const p = project()
  p.edit('api_create', { name: 'shop', baseUrl: 'https://shop.example.com/v1' })
  p.edit('api_model_set', { datasource: SHOP, model: { name: 'Address', fields: [{ name: 'city', type: 'text' }] } })
  p.edit('api_model_set', {
    datasource: SHOP,
    model: { name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }, { name: 'address', type: 'model', model: 'Address', optional: true }] }
  })
  p.edit('api_model_set', { datasource: SHOP, model: { name: 'Note', fields: [{ name: 'text', type: 'text' }] } })
  p.edit('api_query_set', {
    datasource: SHOP,
    query: { name: 'products', path: '/products', params: [{ name: 'category', in: 'query', type: 'text' }, { name: 'page', in: 'query', type: 'integer', required: true }], result: { model: 'Product', many: true } }
  })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'product', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Product', many: false } } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'notes', path: '/notes', params: [], result: { model: 'Note', many: true } } })
  return p
}

type Project = ReturnType<typeof shop>

const pageOf = (p: Project, name: string) => generate(p.model()).find(file => file.path === `layers/blog/app/pages/${name}.vue`)!.content

/** A page `name` using `api`, with a List over it. */
const listPage = (p: Project, name: string, use: Record<string, unknown>, list: Record<string, unknown> = {}, text = '{item.title}') => {
  const { pageId, nodeId } = p.edit('page_create', { name })
  p.edit('page_use_add', { page: pageId, ...use })
  p.edit('node_insert', {
    file: pageId,
    parentId: nodeId,
    type: 'List',
    props: { items: { $bind: use.as }, as: 'item', ...list },
    children: [{ type: 'Text', props: { text: { $template: text } } }]
  })
  return pageId as string
}

const PRODUCTS = { as: 'products', api: { datasource: SHOP, query: 'products' }, args: { page: 1 } }

describe('a page that uses an API query', () => {
  it('calls the composable with the literal args as a constant, and lists data (empty when null) with the id as key', () => {
    const p = shop()
    listPage(p, 'listing', PRODUCTS, { loading: 'Loading…', empty: 'Nothing here.' })
    const content = pageOf(p, 'listing')
    // codegen-architecture T3c: the contract of Nuxt's useAsyncData, its `status` read as it is.
    expect(content).toContain('const { data: products, status: productsStatus } = useShopProducts({ page: 1 })')
    expect(content).toContain('<p v-if="productsStatus === \'pending\'" class="text-muted">Loading…</p>')
    expect(content).toContain('<p v-else-if="productsStatus === \'error\'" class="text-error">Couldn\'t load this.</p>')
    expect(content).toContain('<p v-else-if="!(products ?? []).length" class="text-muted">Nothing here.</p>')
    expect(content).toContain('<p v-for="item in (products ?? [])" :key="item.id"')
  })

  // A4 (verify): the error line makes the wrapper a v-else, which must not make `hideWhenEmpty` a no-op.
  it('hides the wrapper of an empty list over an API answer when hideWhenEmpty is set', () => {
    const p = shop()
    listPage(p, 'hidden', { as: 'notes', api: { datasource: SHOP, query: 'notes' } }, { hideWhenEmpty: true }, '{item.text}')
    const content = pageOf(p, 'hidden')
    expect(content).toContain('<p v-if="notesStatus === \'error\'" class="text-error">Couldn\'t load this.</p>')
    expect(content).toMatch(/<div v-else-if="\(notes \?\? \[\]\)\.length"/)
    // With the loading and empty lines the wrapper is already the last branch.
    listPage(p, 'shown', { as: 'notes', api: { datasource: SHOP, query: 'notes' } }, { hideWhenEmpty: true, empty: 'None', loading: 'Wait' }, '{item.text}')
    expect(pageOf(p, 'shown')).toMatch(/<div v-else/)
    expect(pageOf(p, 'shown')).not.toMatch(/<div v-else-if/)
  })

  it('keys by the index when the model has no id', () => {
    const p = shop()
    listPage(p, 'notes', { as: 'notes', api: { datasource: SHOP, query: 'notes' } }, { loading: 'Loading…' }, '{item.text}')
    const content = pageOf(p, 'notes')
    expect(content).toContain('const { data: notes, status: notesStatus } = useShopNotes()')
    expect(content).toContain('<p v-for="(item, itemIndex) in (notes ?? [])" :key="itemIndex"')
    expect(content).not.toContain('item.id')
  })

  it('wraps the args in a getter when one is not a literal, and keeps the literal ones inside it', () => {
    const p = shop()
    const { pageId } = p.edit('page_create', { name: 'category', path: '/category/:slug' })
    p.edit('page_use_add', { page: pageId, as: 'products', api: { datasource: SHOP, query: 'products' }, args: { page: 2, category: { $route: 'slug' } } })
    p.edit('node_insert', { file: pageId, type: 'Text', props: { text: { $template: '{products.length} products' } } })
    const content = pageOf(p, 'category/[slug]')
    expect(content).toContain('const { data: products } = useShopProducts(() => ({ category: route.params.slug, page: 2 }))')
    expect(content).toContain('const route = useRoute(\'category\')')
    expect(content).toContain('{{ (products ?? []).length }} products')
  })

  it('reads a one result with optional chaining, guards a Page on it, and shows the error line before it', () => {
    const p = shop()
    const { pageId, nodeId } = p.edit('page_create', { name: 'weather-now' })
    p.edit('page_use_add', { page: pageId, as: 'now', api: { datasource: 'ds_weather', query: 'forecast' }, args: { city: 'Lisbon' } })
    p.edit('node_update_props', { file: pageId, nodeId, props: { when: { $bind: 'now' }, loading: 'Loading…', empty: 'No forecast.' } })
    p.edit('node_insert', { file: pageId, parentId: nodeId, type: 'Text', props: { text: { $template: '{now.city}: {now.celsius}' } } })
    p.edit('node_insert', { file: pageId, parentId: nodeId, type: 'Text', props: { text: { $bind: 'now.city' } } })
    const content = pageOf(p, 'weather-now')
    expect(content).toContain('const { data: now, status: nowStatus } = useWeatherForecast({ city: \'Lisbon\' })')
    const lines = content.split('\n').map(line => line.trim())
    const at = (text: string) => lines.findIndex(line => line.startsWith(text))
    expect(at('<p v-if="nowStatus === \'pending\'"')).toBeGreaterThan(-1)
    expect(at('<p v-else-if="nowStatus === \'error\'" class="text-error">Couldn\'t load this.</p>')).toBe(at('<p v-if="nowStatus === \'pending\'"') + 1)
    expect(lines[at('<p v-else-if="nowStatus === \'error\'"') + 1]).toMatch(/^<div v-else-if="now"/)
    expect(content).toContain('{{ now?.city }}: {{ now?.celsius }}')
    expect(content).toContain('>{{ now?.city }}<')
    // No forecast once it has loaded without failing: a 404.
    // Only an answer that came back without it is a 404: not while it loads, nor when it failed.
    expect(content).toContain('if (nowStatus.value === \'success\' && !now.value) showError({ status: 404, message: \'No forecast.\' })')
    expect(content).not.toContain('<p v-else class="text-muted">No forecast.</p>')
  })

  it('reads nested fields of a row with optional chaining', () => {
    const p = shop()
    listPage(p, 'cities', PRODUCTS, {}, '{item.title} in {item.address.city}')
    expect(pageOf(p, 'cities')).toContain('{{ item.title }} in {{ item.address?.city }}')
  })

  it('lets a handler read a row, typed from the data', () => {
    const p = shop()
    const pageId = listPage(p, 'rows', PRODUCTS, { loading: 'Loading…' })
    p.edit('node_insert', {
      file: pageId,
      parentId: 'n_list_1',
      type: 'Button',
      props: { text: 'Open' },
      interactions: [{ on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'item.title' } } } }] }]
    })
    const content = pageOf(p, 'rows')
    expect(content).toContain('const onButton1Click = async (itemItem: NonNullable<typeof products.value>[number]) => {')
    expect(content).toContain('params: { slug: itemItem.title }')
    expect(content).toContain('@click="onButton1Click(item)"')
  })

  it('shows the error line without a loading text too, ahead of the empty text, which waits for the answer', () => {
    const p = shop()
    listPage(p, 'plain', PRODUCTS, { empty: 'Nothing here.' })
    const content = pageOf(p, 'plain')
    expect(content).toContain('<template v-if="productsStatus === \'pending\'" />')
    expect(content).toContain('<p v-else-if="productsStatus === \'error\'" class="text-error">Couldn\'t load this.</p>')
    expect(content).toContain('<p v-else-if="!(products ?? []).length" class="text-muted">Nothing here.</p>')
  })

  it('declares only what the template reads, and nothing for an unused use', () => {
    const p = shop()
    const { pageId } = p.edit('page_create', { name: 'unused' })
    p.edit('page_use_add', { page: pageId, ...PRODUCTS })
    expect(pageOf(p, 'unused')).not.toContain('useShopProducts')
  })

  it('generates pages without API uses exactly as before', () => {
    const p = shop()
    const plain = generate(project().model()).filter(file => file.path.startsWith('layers/blog/app/'))
    const withApis = generate(p.model()).filter(file => file.path.startsWith('layers/blog/app/'))
    expect(withApis).toEqual(plain)
  })

  it('is the generated page a binding edit checks: node_update_props binds an API alias', () => {
    const p = shop()
    p.edit('page_use_add', { page: 'pg_index', as: 'shopProducts', api: { datasource: SHOP, query: 'products' }, args: { page: 1 } })
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_quotes', props: { items: { $bind: 'shopProducts' } } })
    expect(findNode(p.json('.bildr/modules/blog/pages/index.json').root, 'n_quotes')!.props.items).toEqual({ $bind: 'shopProducts' })
  })
})
