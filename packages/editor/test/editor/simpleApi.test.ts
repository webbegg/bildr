import { afterEach, describe, expect, it } from 'vitest'
import { applyEdit } from '@bildr/codegen/edit'
import type { EditName } from '@bildr/codegen/edit'
import { loadModel, serializeModel } from '@bildr/codegen/model'
import { Failure, click, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import { takeStart } from '../../src/editor/views.ts'
import { clearTryValues } from '../../src/editor/tryRequest.ts'
import SimpleDataView from '../../src/views/SimpleDataView.vue'
import { FakeEventSource, baseHandlers, combo, inputOf, optionLabels, selectOption, setupHarness, toggle, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'
import { apiModule, confirmText, inputs, q, qa, text } from './dataKit.ts'

/**
 * The simple Data section's API flows (simple data, S4, S5, S6): the New API dialog, the API's panel (its settings and its queries,
 * actions and models), the query, action and model editors, and Try it with Use this answer. The module's `api_*` edits are the real
 * ones over the mocked model (`apiModule`), so what is refused is refused in the module's own words; `api_try` answers what the test says.
 */

setupHarness()

afterEach(() => {
  takeStart()
  clearTryValues()
})

const seed = (name: EditName, input: Record<string, unknown>) => {
  const files = serializeModel(world.model)
  const outcome = applyEdit(files, name, input)
  if (!outcome.ok) throw new Error(outcome.message)
  const next = { ...files }
  for (const change of outcome.changes) {
    if (change.content === null) Reflect.deleteProperty(next, change.path)
    else next[change.path] = change.content
  }
  const loaded = loadModel(next)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  world.model = loaded.model
  return outcome.result as Record<string, unknown>
}

const ID = 'ds_shop_api'
/** An API with a model, two queries and an action. */
const shop = (input: Record<string, unknown> = {}) => {
  seed('api_create', { name: 'Shop API', baseUrl: 'https://api.example.com/v1', ...input })
  seed('api_model_set', { datasource: ID, model: { name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }] } })
  seed('api_query_set', { datasource: ID, query: { name: 'products', path: '/products', params: [], result: { model: 'Product', many: true, itemsPath: 'items' } } })
  seed('api_query_set', { datasource: ID, query: { name: 'productById', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Product', many: false } } })
  seed('api_action_set', { datasource: ID, action: { name: 'addProduct', method: 'POST', path: '/products', params: [], body: { model: 'Product' }, result: { model: 'Product', many: false } } })
}
const source = () => world.model.datasources.find(entry => entry.id === ID)! as unknown as { name: string, baseUrl: string, runtime: string, auth?: { type: string, header?: string, secret: string }, env: Record<string, string>, models: Array<{ name: string, fields: Array<Record<string, unknown>> }>, queries: Array<Record<string, unknown>>, actions: Array<Record<string, unknown>> }

/** What `env_status` says: the variables the model's APIs read, set when the test said so. */
const setVars = new Set<string>()
const envStatus = () => ({
  variables: world.model.datasources.filter(entry => entry.kind === 'api').flatMap(entry => Object.values((entry as { env?: Record<string, string> }).env ?? {}).map(name => ({ name, datasource: entry.name, set: setVars.has(name), from: setVars.has(name) ? '.env' : null })))
})

type Tried = Record<string, unknown> | ((input: Record<string, unknown>) => unknown)
const mounted = async (tried: Tried = {}, extra: Handlers = {}, path = `/data?item=api:${ID}`) => {
  setVars.clear()
  const actions = mockActions({ ...baseHandlers(), env_status: envStatus, ...apiModule(), api_try: typeof tried === 'function' ? tried : () => tried, ...extra })
  const screen = await mountWithApp(SimpleDataView, path)
  return { actions, ...screen }
}
const calls = (actions: Awaited<ReturnType<typeof mounted>>['actions'], name: string) => inputs(actions, name)

const button = (label: string) => qa('button').find(candidate => candidate.textContent?.trim() === label) ?? null
const field = (hook: string) => inputOf(`[${hook}]`)
const type = (hook: string, value: string) => typeInto(field(hook), value)
const choose = (hook: string, label: string) => selectOption(combo(`[${hook}]`), label)
const open = (what: string) => click(q(`[data-api-item="${what}"] [data-api-open]`))
const save = () => click(q('[data-simple-op-save]'))
const unsaved = () => q('[data-simple-op-unsaved]') !== null
const dialog = () => q('[data-artifact-dialog]')
/** The select trigger of a kit select found by the element that carries its hook (the trigger itself, or the wrapper). */
const comboOf = (element: Element | null): HTMLElement => (element?.matches('[role="combobox"]') ? element : element?.querySelector('[role="combobox"]') ?? element) as HTMLElement

const LIST = {
  status: 200,
  url: 'https://api.example.com/v1/products',
  json: { items: [{ id: 1, title: 'Lamp' }, { id: 2, title: 'Desk' }], total: 2 },
  items: { path: 'items', count: 2 },
  proposal: {
    result: { model: 'Gadget', many: true, itemsPath: 'items' },
    models: [{ name: 'Maker', fields: [{ name: 'name', type: 'text' }] }, { name: 'Gadget', fields: [{ name: 'id', type: 'integer' }, { name: 'maker', type: 'model', model: 'Maker' }] }]
  }
}

describe('creating an API', () => {
  it('has a + on the APIs section, even when there are no APIs, that opens a dialog with its name, base URL, where it runs and its sign-in', async () => {
    await mounted({}, {}, '/data')
    await click(q('[data-simple-section="apis"] [data-simple-new-api]'))
    const box = dialog()!
    expect(box.getAttribute('data-artifact-dialog')).toBe('create')
    expect(text(q('[role="dialog"] [data-slot="title"]'))).toBe('New API')
    expect(q('[data-api-new-name]')).not.toBeNull()
    expect(q('[data-api-new-url]')).not.toBeNull()
    const runtimes = qa('[data-api-new-runtime]').map(card => text(card))
    expect(runtimes).toHaveLength(2)
    expect(runtimes[0]).toContain('On the server (can use a secret key)')
    expect(runtimes[1]).toContain('In the visitor\'s browser (no secret key)')
    expect(q('[data-api-new-runtime="server"]')?.getAttribute('aria-checked')).toBe('true')
    expect(qa('[data-api-new-signin]').map(card => card.getAttribute('data-api-new-signin'))).toEqual(['none', 'bearer', 'header'])
    expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(true)
  })

  it('checks the base URL as you type, with the module\'s rules and words, and offers Create only for a good one', async () => {
    await mounted({}, {}, '/data')
    await click(q('[data-simple-new-api]'))
    await type('data-api-new-name', 'Shop')
    expect(q('[data-api-new-url-error]')).toBeNull()
    await type('data-api-new-url', 'api.example.com')
    expect(text(q('[data-api-new-url-error]'))).toContain('is not an absolute URL')
    expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(true)
    await type('data-api-new-url', 'ftp://api.example.com')
    expect(text(q('[data-api-new-url-error]'))).toBe('A base URL is http or https')
    await type('data-api-new-url', 'https://me:pw@api.example.com')
    expect(text(q('[data-api-new-url-error]'))).toContain('can\'t hold a user name or password')
    await type('data-api-new-url', 'https://api.example.com/v1?x=1')
    expect(text(q('[data-api-new-url-error]'))).toBe('A base URL has no query or fragment')
    await type('data-api-new-url', 'https://api.example.com/v1')
    expect(q('[data-api-new-url-error]')).toBeNull()
    expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(false)
  })

  it('says under the name what it will be called, as the dialogs of the items do', async () => {
    await mounted({}, {}, '/data')
    await click(q('[data-simple-new-api]'))
    const help = () => text(q('[data-artifact-dialog] [data-form-row="Name"]'))
    expect(help()).toContain('Any words')
    await type('data-api-new-name', 'Shop API')
    expect(help()).toContain('It will be called \u201cshop-api\u201d')
    await type('data-api-new-name', 'shop')
    expect(help()).not.toContain('It will be called')
    await type('data-api-new-name', 'Caf\u00e9 des Pr\u00e9s 2')
    expect(help()).toContain('It will be called \u201ccafe-des-pres-2\u201d')
  })

  it('makes it with api_create, opens it, and shows the env var of its secret and whether it is set, never a value', async () => {
    const { actions, router } = await mounted({}, {}, '/data')
    await click(q('[data-simple-new-api]'))
    await type('data-api-new-name', 'Shop API')
    await type('data-api-new-url', ' https://api.example.com/v1 ')
    await click(q('[data-api-new-signin="header"]'))
    await type('data-api-new-header', 'X-Api-Key')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_create')).toEqual([{ name: 'Shop API', baseUrl: 'https://api.example.com/v1', runtime: 'server', auth: { type: 'header', header: 'X-Api-Key' } }])
    expect(dialog()).toBeNull()
    expect(q('[data-simple-api-panel]')?.getAttribute('data-simple-api-panel')).toBe(ID)
    expect(router.currentRoute.value.query).toEqual({ item: `api:${ID}` })
    const secret = source().env.apiKey!
    expect(secret).toMatch(/^NUXT_APIS_/)
    expect(text(q('[data-api-secret-var]'))).toBe(secret)
    expect(text(q('[data-api-secret-status]'))).toBe('Not set')
    expect(text(q('[data-api-secret]'))).toContain('.env')
    expect(qa('input').some(input => input.getAttribute('type') === 'password')).toBe(false)
    expect(q('[data-simple-section="apis"] [data-simple-api]')).not.toBeNull()
  })

  it('says a secret is set when the environment has it', async () => {
    shop({ auth: { type: 'bearer' } })
    await mounted()
    expect(text(q('[data-api-secret-status]'))).toBe('Not set')
    setVars.add(source().env.apiKey!)
    await click(q('[data-api-secret-refresh]'))
    expect(text(q('[data-api-secret-status]'))).toBe('Set')
  })

  it('runs in the browser without a sign-in: the sign-in choices are off and nothing is sent for them', async () => {
    const { actions } = await mounted({}, {}, '/data')
    await click(q('[data-simple-new-api]'))
    await type('data-api-new-name', 'Open')
    await type('data-api-new-url', 'https://api.example.com')
    await click(q('[data-api-new-signin="bearer"]'))
    await click(q('[data-api-new-runtime="browser"]'))
    expect(q('[data-api-new-signin="none"]')?.getAttribute('aria-checked')).toBe('true')
    expect(qa('[data-api-new-signin]').every(card => card.hasAttribute('disabled'))).toBe(true)
    expect(text(q('[data-api-new-signin-note]'))).toContain('no secret key')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_create')).toEqual([{ name: 'Open', baseUrl: 'https://api.example.com', runtime: 'browser' }])
  })

  it('shows what the module refuses in the dialog and keeps what was typed', async () => {
    shop()
    const { actions } = await mounted({}, {}, '/data')
    await click(q('[data-simple-new-api]'))
    await type('data-api-new-name', 'Shop API')
    await type('data-api-new-url', 'https://other.example.com')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_create')).toHaveLength(1)
    expect(text(q('[data-artifact-error]'))).not.toBe('')
    expect(field('data-api-new-url').value).toBe('https://other.example.com')
    expect(dialog()).not.toBeNull()
  })
})

describe('an API\'s panel', () => {
  it('has its settings and three lists: Queries, Actions and Models', async () => {
    shop()
    await mounted()
    expect(field('data-api-name').value).toBe('shop-api')
    expect(field('data-api-baseurl').value).toBe('https://api.example.com/v1')
    expect(q('[data-api-runtime="server"]')?.getAttribute('aria-checked')).toBe('true')
    expect(q('[data-api-signin="none"]')?.getAttribute('aria-checked')).toBe('true')
    expect(q('[data-api-secret]')).toBeNull()
    expect(qa('[data-api-section] h3').map(heading => text(heading))).toEqual(['Queries', 'Actions', 'Models'])
    expect(qa('[data-api-section="queries"] [data-api-item]').map(row => row.getAttribute('data-api-item'))).toEqual(['query:products', 'query:productById'])
    expect(qa('[data-api-section="actions"] [data-api-item]').map(row => row.getAttribute('data-api-item'))).toEqual(['action:addProduct'])
    expect(qa('[data-api-section="models"] [data-api-item]').map(row => row.getAttribute('data-api-item'))).toEqual(['model:Product'])
    expect(text(q('[data-api-item="query:productById"]'))).toContain('/products/:id')
    expect(q('[data-api-new="query"]')).not.toBeNull()
    expect(q('[data-api-new="action"]')).not.toBeNull()
    expect(q('[data-api-new="model"]')).not.toBeNull()
  })

  it('saves only the settings that changed with api_update, and Discard puts the saved ones back', async () => {
    shop()
    const { actions } = await mounted()
    expect(q('[data-simple-api-unsaved]')).toBeNull()
    await type('data-api-baseurl', 'https://api.example.com/v2')
    expect(text(q('[data-simple-api-unsaved]'))).toBe('Unsaved changes')
    await click(q('[data-simple-api-discard]'))
    expect(field('data-api-baseurl').value).toBe('https://api.example.com/v1')
    await type('data-api-baseurl', 'https://api.example.com/v2')
    await click(q('[data-api-runtime="browser"]'))
    await click(q('[data-simple-api-save]'))
    expect(calls(actions, 'api_update')).toEqual([{ datasource: ID, baseUrl: 'https://api.example.com/v2', runtime: 'browser' }])
    expect(source().baseUrl).toBe('https://api.example.com/v2')
    expect(q('[data-simple-api-unsaved]')).toBeNull()
  })

  it('changes the sign-in, and sends the header name only for an API key header', async () => {
    shop()
    const { actions } = await mounted()
    await click(q('[data-api-signin="header"]'))
    expect(q('[data-simple-api-save]')?.hasAttribute('disabled')).toBe(true)
    await type('data-api-header', 'X-Key')
    await click(q('[data-simple-api-save]'))
    expect(calls(actions, 'api_update')).toEqual([{ datasource: ID, auth: { type: 'header', header: 'X-Key' } }])
    expect(text(q('[data-api-secret-var]'))).toBe(source().env.apiKey)
    await click(q('[data-api-signin="none"]'))
    await click(q('[data-simple-api-save]'))
    expect(calls(actions, 'api_update').at(-1)).toEqual({ datasource: ID, auth: null })
    expect(q('[data-api-secret]')).toBeNull()
  })

  it('checks the base URL while it is typed and does not offer Save for a bad one', async () => {
    shop()
    const { actions } = await mounted()
    await type('data-api-baseurl', 'ftp://api.example.com')
    expect(text(q('[data-api-baseurl-error]'))).toBe('A base URL is http or https')
    expect(q('[data-simple-api-save]')?.hasAttribute('disabled')).toBe(true)
    expect(calls(actions, 'api_update')).toEqual([])
  })

  it('shows what the module refuses in the footer, in plain words, and keeps the edits', async () => {
    shop()
    const refusal = 'An API that runs in the browser can\'t use a secret: the browser would see it. Run it on the server, or remove the auth'
    await mounted({}, { api_update: () => new Failure(422, 'invalid', refusal) })
    await type('data-api-baseurl', 'https://api.example.com/v2')
    await click(q('[data-simple-api-save]'))
    expect(text(q('[data-simple-api-error]'))).toBe(refusal)
    expect(field('data-api-baseurl').value).toBe('https://api.example.com/v2')
    expect(q('[data-simple-api-unsaved]')).not.toBeNull()
  })

  it('asks before leaving unsaved settings for something else, and keeps them when told to', async () => {
    shop()
    await mounted()
    await type('data-api-baseurl', 'https://api.example.com/v2')
    await open('query:products')
    expect(confirmText()).toContain('Discard unsaved changes to shop-api?')
    await click(q('[data-confirm-cancel]'))
    expect(q('[data-api-editor]')).toBeNull()
    expect(field('data-api-baseurl').value).toBe('https://api.example.com/v2')
    await open('query:products')
    await click(q('[data-confirm-ok]'))
    expect(q('[data-api-editor="query:products"]')).not.toBeNull()
  })

  it('says it changed elsewhere while it has edits, and asks which version to keep', async () => {
    shop()
    await mounted()
    await type('data-api-baseurl', 'https://api.example.com/v2')
    source().baseUrl = 'https://api.example.com/v3'
    FakeEventSource.instances.at(-1)!.send({ type: 'model', version: 300, files: ['.bildr/datasources/shop-api.json'], source: 'disk' })
    await settle()
    expect(text(q('[data-simple-api-changed]'))).toContain('This API changed since you started editing')
    expect(q('[data-simple-api-save]')?.hasAttribute('disabled')).toBe(true)
    await click(q('[data-simple-api-load-new]'))
    expect(field('data-api-baseurl').value).toBe('https://api.example.com/v3')
  })

  it('renames a query, an action and a model from the lists, and shows the module\'s refusal', async () => {
    shop()
    const { actions } = await mounted()
    await click(q('[data-api-item="query:products"] [data-api-rename]'))
    expect(dialog()?.getAttribute('data-artifact-dialog')).toBe('rename')
    await type('data-api-item-name', 'addProduct')
    await click(q('[data-artifact-submit]'))
    expect(text(q('[data-artifact-error]'))).toContain('already has this name')
    await type('data-api-item-name', 'all products')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_query_rename')).toEqual([{ datasource: ID, query: 'products', name: 'addProduct' }, { datasource: ID, query: 'products', name: 'allProducts' }])
    expect(q('[data-api-item="query:allProducts"]')).not.toBeNull()
    await click(q('[data-api-item="model:Product"] [data-api-rename]'))
    await type('data-api-item-name', 'catalog item')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_model_rename')).toEqual([{ datasource: ID, model: 'Product', name: 'CatalogItem' }])
    expect(source().queries.map(query => (query.result as { model: string }).model)).toEqual(['CatalogItem', 'CatalogItem'])
    await click(q('[data-api-item="action:addProduct"] [data-api-rename]'))
    await type('data-api-item-name', 'create product')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_action_rename')).toEqual([{ datasource: ID, action: 'addProduct', name: 'createProduct' }])
  })

  it('refuses to delete a model a query uses, in the module\'s words, and deletes one nothing uses', async () => {
    shop()
    seed('api_model_set', { datasource: ID, model: { name: 'Spare', fields: [{ name: 'id', type: 'integer' }] } })
    const { actions } = await mounted()
    await click(q('[data-api-item="model:Product"] [data-api-delete]'))
    expect(dialog()?.getAttribute('data-artifact-dialog')).toBe('delete')
    expect(text(q('[role="dialog"]'))).toContain('Delete Product')
    await click(q('[data-artifact-submit]'))
    expect(text(q('[data-artifact-error]'))).toBe('Product is used by the queries products and productById and the action addProduct')
    expect(q('[data-api-item="model:Product"]')).not.toBeNull()
    await click(button('Cancel'))
    await click(q('[data-api-item="model:Spare"] [data-api-delete]'))
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_model_delete')).toEqual([{ datasource: ID, model: 'Product' }, { datasource: ID, model: 'Spare' }])
    expect(q('[data-api-item="model:Spare"]')).toBeNull()
  })

  it('deletes a query and an action', async () => {
    shop()
    const { actions } = await mounted()
    await click(q('[data-api-item="query:productById"] [data-api-delete]'))
    await click(q('[data-artifact-submit]'))
    await click(q('[data-api-item="action:addProduct"] [data-api-delete]'))
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_query_delete')).toEqual([{ datasource: ID, query: 'productById' }])
    expect(calls(actions, 'api_action_delete')).toEqual([{ datasource: ID, action: 'addProduct' }])
    expect(q('[data-api-item="query:productById"]')).toBeNull()
    expect(q('[data-api-item="action:addProduct"]')).toBeNull()
  })

  it('deletes the API after asking, and goes back to the list', async () => {
    shop()
    const { actions, router } = await mounted()
    await click(q('[data-simple-api-delete]'))
    expect(text(q('[role="dialog"]'))).toContain('Delete shop-api')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'datasource_delete')).toEqual([{ datasource: ID }])
    expect(q('[data-simple-api-panel]')).toBeNull()
    expect(q(`[data-simple-api="${ID}"]`)).toBeNull()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('opens the editor of a new query from the +, named as the module names it', async () => {
    shop()
    await mounted()
    await click(q('[data-api-new="query"]'))
    await type('data-api-item-name', 'search items')
    await click(q('[data-artifact-submit]'))
    expect(q('[data-api-editor="query:searchItems"]')).not.toBeNull()
    expect(unsaved()).toBe(false)
    expect(q('[data-simple-op-save]')?.hasAttribute('disabled')).toBe(true)
  })

  it('does not take a name a query or an action has already, nor a model\'s', async () => {
    shop()
    await mounted()
    await click(q('[data-api-new="action"]'))
    await type('data-api-item-name', 'products')
    expect(text(q('[data-artifact-error]'))).toContain('already')
    expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(true)
    await click(button('Cancel'))
    await click(q('[data-api-new="model"]'))
    await type('data-api-item-name', 'product')
    expect(text(q('[data-artifact-error]'))).toContain('already')
  })
})

describe('the query editor', () => {
  it('suggests the parameters from the :name segments of the path', async () => {
    shop()
    await mounted()
    await open('query:productById')
    expect(qa('[data-op-param]').map(row => row.getAttribute('data-op-param'))).toEqual(['path:id'])
    expect(text(q('[data-op-param="path:id"] [data-op-param-name]'))).toBe('id')
    expect(text(q('[data-op-path-help]'))).toContain('/products/:id')
    await type('data-op-path', '/categories/:category/items/:item')
    expect(qa('[data-op-param]').map(row => row.getAttribute('data-op-param'))).toEqual(['path:category', 'path:item'])
    expect(unsaved()).toBe(true)
  })

  it('adds and removes query parameters, with a type, whether it is required and the key the API calls it', async () => {
    shop()
    const { actions } = await mounted()
    await open('query:products')
    await click(q('[data-op-param-add]'))
    const row = qa('[data-op-param^="query:"]')[0]!
    await typeInto(row.querySelector('[data-op-param-name]'), 'pageSize')
    await selectOption(comboOf(row.querySelector('[data-op-param-type]')), 'Whole number')
    await click(row.querySelector('[data-op-param-required]'))
    await typeInto(row.querySelector('[data-op-param-remote]'), 'page_size')
    await click(q('[data-op-param-add]'))
    expect(qa('[data-op-param^="query:"]')).toHaveLength(2)
    await click(qa('[data-op-param^="query:"]')[1]!.querySelector('[data-op-param-remove]'))
    expect(qa('[data-op-param^="query:"]')).toHaveLength(1)
    await save()
    expect(calls(actions, 'api_query_set')).toEqual([{
      datasource: ID,
      query: { name: 'products', path: '/products', params: [{ name: 'pageSize', in: 'query', type: 'integer', required: true, key: 'page_size' }], result: { model: 'Product', many: true, itemsPath: 'items' } }
    }])
    expect(source().queries[0]!.params).toHaveLength(1)
    expect(unsaved()).toBe(false)
  })

  it('picks what it answers: a model, one or a list, and where the list is', async () => {
    shop()
    seed('api_model_set', { datasource: ID, model: { name: 'Review', fields: [{ name: 'stars', type: 'integer' }] } })
    const { actions } = await mounted()
    await open('query:productById')
    expect(q('[data-op-result-items]')).toBeNull()
    await choose('data-op-result-model', 'Review')
    await toggle('[data-op-result-many]')
    await type('data-op-result-items', 'data.reviews')
    await save()
    expect(calls(actions, 'api_query_set')).toEqual([{
      datasource: ID,
      query: { name: 'productById', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Review', many: true, itemsPath: 'data.reviews' } }
    }])
  })

  it('shows the module\'s refusal in plain words and keeps the edits', async () => {
    shop()
    await mounted()
    await open('query:products')
    await type('data-op-path', '/a/../b')
    await save()
    expect(text(q('[data-simple-op-error]'))).toContain('can\'t be a path')
    expect(unsaved()).toBe(true)
    expect(field('data-op-path').value).toBe('/a/../b')
  })

  it('asks for the answer\'s model before it saves a new query', async () => {
    shop()
    const { actions } = await mounted()
    await click(q('[data-api-new="query"]'))
    await type('data-api-item-name', 'featured')
    await click(q('[data-artifact-submit]'))
    await type('data-op-path', '/featured')
    expect(q('[data-simple-op-save]')?.hasAttribute('disabled')).toBe(false)
    await save()
    expect(text(q('[data-simple-op-error]'))).toContain('pick a model')
    expect(calls(actions, 'api_query_set')).toEqual([])
  })

  it('goes back to the API, asking first when there are edits', async () => {
    shop()
    await mounted()
    await open('query:products')
    await click(q('[data-api-back]'))
    expect(q('[data-api-editor]')).toBeNull()
    expect(q('[data-api-settings]')).not.toBeNull()
    await open('query:products')
    await type('data-op-path', '/items')
    await click(q('[data-api-back]'))
    expect(confirmText()).toContain('Discard unsaved changes to products?')
    await click(q('[data-confirm-ok]'))
    expect(q('[data-api-editor]')).toBeNull()
  })
})

describe('Try it', () => {
  it('asks for each parameter, calls api_try with the path and what was given, and shows the status, the answer and the list found', async () => {
    shop()
    const { actions } = await mounted(LIST)
    await open('query:productById')
    await click(q('[data-try-run]'))
    expect(calls(actions, 'api_try')).toEqual([])
    expect(text(q('[data-try-error]'))).toContain('Give')
    await type('data-try-input="id"', '7')
    await click(q('[data-try-run]'))
    expect(calls(actions, 'api_try')).toEqual([{ datasource: ID, path: '/products/:id', params: { id: 7 } }])
    expect(text(q('[data-try-status]'))).toContain('200')
    expect(text(q('[data-try-url]'))).toBe('https://api.example.com/v1/products')
    expect(q('[data-answer-row="items"]')).not.toBeNull()
    await click(answerTab('Raw'))
    expect(q('[data-answer-raw]')?.textContent).toContain('Lamp')
    expect(text(q('[data-try-items]'))).toContain('2 items')
    expect(text(q('[data-try-items]'))).toContain('items')
    expect(q('[data-try-use]')).not.toBeNull()
  })

  it('sends a query parameter by the key the API calls it, and leaves an empty one out', async () => {
    shop()
    seed('api_query_set', { datasource: ID, query: { name: 'search', path: '/search', params: [{ name: 'term', in: 'query', type: 'text', required: true, key: 'q' }, { name: 'limit', in: 'query', type: 'integer' }], result: { model: 'Product', many: true } } })
    const { actions } = await mounted(LIST)
    await open('query:search')
    await type('data-try-input="term"', 'lamp')
    await click(q('[data-try-run]'))
    expect(calls(actions, 'api_try')).toEqual([{ datasource: ID, path: '/search', params: { q: 'lamp' } }])
  })

  it('shows what the API answered when it is not a success, and what the module refused', async () => {
    shop()
    const { actions } = await mounted({ status: 404, url: 'https://api.example.com/v1/products', json: { message: 'not found' } })
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(text(q('[data-try-status]'))).toContain('404')
    expect(q('[data-try-use]')).toBeNull()
    expect(calls(actions, 'api_try')).toHaveLength(1)
  })

  it('shows a refusal of the module in plain words', async () => {
    shop()
    await mounted(() => new Failure(502, 'upstream', 'The API did not answer: timed out after 10 s'))
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(text(q('[data-try-error]'))).toBe('The API did not answer: timed out after 10 s')
  })

  it('"Use this answer" sets the proposed models one by one in the listed order and fills the result', async () => {
    shop()
    const { actions } = await mounted(LIST)
    await open('query:products')
    await click(q('[data-try-run]'))
    await click(q('[data-try-use]'))
    expect(calls(actions, 'api_model_set').map(call => (call.model as { name: string }).name)).toEqual(['Maker', 'Gadget'])
    expect(source().models.map(model => model.name)).toEqual(['Product', 'Maker', 'Gadget'])
    expect(combo('[data-op-result-model]').textContent).toContain('Gadget')
    expect(field('data-op-result-items').value).toBe('items')
    expect(unsaved()).toBe(true)
    await save()
    expect(calls(actions, 'api_query_set')[0]!.query).toMatchObject({ name: 'products', result: { model: 'Gadget', many: true, itemsPath: 'items' } })
  })

  it('asks to replace a model that already has the name, or to keep both under a new name', async () => {
    shop()
    const clash = { ...LIST, proposal: { result: { model: 'Product', many: true, itemsPath: 'items' }, models: [{ name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'price', type: 'number' }] }] } }
    const { actions } = await mounted(clash)
    await open('query:products')
    await click(q('[data-try-run]'))
    await click(q('[data-try-use]'))
    expect(calls(actions, 'api_model_set')).toEqual([])
    expect(text(q('[data-proposal-conflict="Product"]'))).toContain('already')
    await click(q('[data-proposal-choice="rename"]'))
    await type('data-proposal-rename', 'Product v2')
    await click(q('[data-proposal-apply]'))
    expect(calls(actions, 'api_model_set')).toEqual([{ datasource: ID, model: { name: 'ProductV2', fields: [{ name: 'id', type: 'integer' }, { name: 'price', type: 'number' }] } }])
    expect(source().models.map(model => model.name)).toEqual(['Product', 'ProductV2'])
    expect(combo('[data-op-result-model]').textContent).toContain('ProductV2')
  })

  it('replaces the model when the user says so', async () => {
    shop()
    const clash = { ...LIST, proposal: { result: { model: 'Product', many: true }, models: [{ name: 'Product', fields: [{ name: 'price', type: 'number' }] }] } }
    const { actions } = await mounted(clash)
    await open('query:products')
    await click(q('[data-try-run]'))
    await click(q('[data-try-use]'))
    await click(q('[data-proposal-choice="replace"]'))
    await click(q('[data-proposal-apply]'))
    expect(calls(actions, 'api_model_set')).toEqual([{ datasource: ID, model: { name: 'Product', fields: [{ name: 'price', type: 'number' }] } }])
    expect(source().models.find(model => model.name === 'Product')!.fields.map(entry => entry.name)).toEqual(['price'])
  })

  it('does not ask, and does not set it again, for a model that says what the existing one says', async () => {
    shop()
    const same = { ...LIST, proposal: { result: { model: 'Product', many: true, itemsPath: 'items' }, models: [{ name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }] }] } }
    const { actions } = await mounted(same)
    await open('query:productById')
    await type('data-try-input="id"', '1')
    await click(q('[data-try-run]'))
    await click(q('[data-try-use]'))
    expect(q('[data-proposal-conflict]')).toBeNull()
    expect(calls(actions, 'api_model_set')).toEqual([])
    expect(field('data-op-result-items').value).toBe('items')
  })

  it('stops at what the module refuses, shows it, and does not fill the result', async () => {
    shop()
    const { actions } = await mounted(LIST, { api_model_set: () => new Failure(422, 'invalid', 'A model is already named "Maker"') })
    await open('query:products')
    await click(q('[data-try-run]'))
    await click(q('[data-try-use]'))
    expect(calls(actions, 'api_model_set')).toHaveLength(1)
    expect(text(q('[data-proposal-error]'))).toBe('A model is already named "Maker"')
    expect(combo('[data-op-result-model]').textContent).toContain('Product')
    expect(unsaved()).toBe(false)
  })
})

describe('the action editor', () => {
  const BODY = '{"title":"Lamp","price":3.5}'

  it('has a method with what each does, a path and its parameters like a query, a body model and an optional result', async () => {
    shop()
    await mounted()
    await open('action:addProduct')
    expect(await optionLabels(combo('[data-op-method]'))).toEqual(['POST', 'PUT', 'PATCH', 'DELETE'])
    expect(text(q('[data-op-method-hint]'))).toContain('Adds something new')
    await selectOption(combo('[data-op-method]'), 'POST')
    expect(field('data-op-path').value).toBe('/products')
    expect(combo('[data-op-body-model]').textContent).toContain('Product')
    expect(combo('[data-op-result-model]').textContent).toContain('Product')
    expect(q('[data-op-param-add]')).not.toBeNull()
  })

  it('saves with api_action_set: the method, the path with its parameters, the body and no result when it has none', async () => {
    shop()
    const { actions } = await mounted()
    await open('action:addProduct')
    await choose('data-op-method', 'PUT')
    await type('data-op-path', '/products/:id')
    await choose('data-op-result-model', 'Nothing (an empty answer)')
    await save()
    expect(calls(actions, 'api_action_set')).toEqual([{
      datasource: ID,
      action: { name: 'addProduct', method: 'PUT', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'text' }], body: { model: 'Product' } }
    }])
    expect(unsaved()).toBe(false)
  })

  it('makes the body model from a sample: paste JSON, and the module\'s models are set like Use this answer', async () => {
    shop()
    seed('api_action_set', { datasource: ID, action: { name: 'addReview', method: 'POST', path: '/reviews', params: [] } })
    const { actions } = await mounted()
    await open('action:addReview')
    await click(q('[data-op-body-sample-toggle]'))
    await type('data-op-body-sample', BODY)
    await click(q('[data-op-body-sample-use]'))
    const sent = calls(actions, 'api_model_set').map(call => call.model as { name: string, fields: unknown[] })
    expect(sent.at(-1)!.name).toBe('Review')
    expect(sent.at(-1)!.fields).toEqual([{ name: 'title', type: 'text' }, { name: 'price', type: 'number' }])
    expect(combo('[data-op-body-model]').textContent).toContain('Review')
    expect(unsaved()).toBe(true)
  })

  it('says a sample that is not JSON is not, and sets nothing', async () => {
    shop()
    const { actions } = await mounted()
    await open('action:addProduct')
    await click(q('[data-op-body-sample-toggle]'))
    await type('data-op-body-sample', '{"title": ')
    await click(q('[data-op-body-sample-use]'))
    expect(text(q('[data-op-body-sample-error]'))).toContain('not JSON')
    expect(calls(actions, 'api_model_set')).toEqual([])
  })

  it('asks before a real write is sent, naming the method and the host, and sends it with confirm', async () => {
    shop()
    const { actions } = await mounted({ status: 201, url: 'https://api.example.com/v1/products', json: { id: 9, title: 'Lamp' } })
    await open('action:addProduct')
    await type('data-try-body', BODY)
    await click(q('[data-try-run]'))
    expect(confirmText()).toContain('This sends a real POST to api.example.com: it can change data there')
    await click(q('[data-confirm-cancel]'))
    expect(calls(actions, 'api_try')).toEqual([])
    await click(q('[data-try-run]'))
    await click(q('[data-confirm-ok]'))
    expect(calls(actions, 'api_try')).toEqual([{ datasource: ID, path: '/products', method: 'POST', body: { title: 'Lamp', price: 3.5 }, confirm: true }])
    expect(text(q('[data-try-status]'))).toContain('201')
  })

  it('does not call api_try with a body that is not JSON', async () => {
    shop()
    const { actions } = await mounted({})
    await open('action:addProduct')
    await type('data-try-body', '{"title": ')
    await click(q('[data-try-run]'))
    expect(text(q('[data-try-error]'))).toContain('not JSON')
    expect(q('[data-confirm]')).toBeNull()
    expect(calls(actions, 'api_try')).toEqual([])
  })

  it('a new action starts as a POST with no result', async () => {
    shop()
    const { actions } = await mounted()
    await click(q('[data-api-new="action"]'))
    await type('data-api-item-name', 'remove product')
    await click(q('[data-artifact-submit]'))
    await type('data-op-path', '/products/:id')
    await save()
    expect(calls(actions, 'api_action_set')).toEqual([{ datasource: ID, action: { name: 'removeProduct', method: 'POST', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'text' }] } }])
  })
})

describe('the model editor', () => {
  it('has a table of fields with name, type, list, optional, can be empty and the key the API calls it, and saves with api_model_set', async () => {
    shop()
    seed('api_model_set', { datasource: ID, model: { name: 'Maker', fields: [{ name: 'name', type: 'text' }] } })
    const { actions } = await mounted()
    await open('model:Product')
    expect(qa('[data-model-field]')).toHaveLength(2)
    await click(q('[data-model-field-add]'))
    const row = qa('[data-model-field]').at(-1)!
    await typeInto(row.querySelector('[data-model-field-name]'), 'madeBy')
    await selectOption(comboOf(row.querySelector('[data-model-field-type]')), 'Another model')
    await selectOption(comboOf(row.querySelector('[data-model-field-model]')), 'Maker')
    await click(row.querySelector('[data-model-field-optional]'))
    await click(row.querySelector('[data-model-field-nullable]'))
    await typeInto(row.querySelector('[data-model-field-remote]'), 'made_by')
    await click(qa('[data-model-field]')[0]!.querySelector('[data-model-field-list]'))
    await click(qa('[data-model-field]')[1]!.querySelector('[data-model-field-remove]'))
    await click(q('[data-simple-model-save]'))
    expect(calls(actions, 'api_model_set')).toEqual([{
      datasource: ID,
      model: { name: 'Product', fields: [{ name: 'id', type: 'integer', list: true }, { name: 'madeBy', type: 'model', model: 'Maker', optional: true, nullable: true, key: 'made_by' }] }
    }])
    expect(q('[data-simple-model-unsaved]')).toBeNull()
  })

  it('reorders the fields', async () => {
    shop()
    const { actions } = await mounted()
    await open('model:Product')
    await click(qa('[data-model-field]')[1]!.querySelector('[data-model-field-up]'))
    await click(q('[data-simple-model-save]'))
    expect((calls(actions, 'api_model_set')[0]!.model as { fields: Array<{ name: string }> }).fields.map(entry => entry.name)).toEqual(['title', 'id'])
  })

  it('does not offer the model itself as the model of one of its fields', async () => {
    shop()
    seed('api_model_set', { datasource: ID, model: { name: 'Maker', fields: [{ name: 'name', type: 'text' }] } })
    await mounted()
    await open('model:Product')
    await click(q('[data-model-field-add]'))
    const row = qa('[data-model-field]').at(-1)!
    await selectOption(comboOf(row.querySelector('[data-model-field-type]')), 'Another model')
    expect(await optionLabels(comboOf(row.querySelector('[data-model-field-model]')))).toEqual(['Maker'])
  })

  it('shows what the module refuses (a cycle, a duplicate field) in the footer', async () => {
    shop()
    await mounted()
    await open('model:Product')
    await click(q('[data-model-field-add]'))
    await typeInto(qa('[data-model-field]').at(-1)!.querySelector('[data-model-field-name]'), 'title')
    await click(q('[data-simple-model-save]'))
    expect(text(q('[data-simple-model-error]'))).toContain('Two fields of Product are named "title"')
    expect(q('[data-simple-model-unsaved]')).not.toBeNull()
  })

  it('renames the model from its editor', async () => {
    shop()
    const { actions } = await mounted()
    await open('model:Product')
    await click(q('[data-api-editor-rename]'))
    await type('data-api-item-name', 'Item')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_model_rename')).toEqual([{ datasource: ID, model: 'Product', name: 'Item' }])
    expect(q('[data-api-editor="model:Item"]')).not.toBeNull()
  })

  it('makes a new model from the +, with one empty field, and does not save it without a field name', async () => {
    shop()
    const { actions } = await mounted()
    await click(q('[data-api-new="model"]'))
    await type('data-api-item-name', 'order line')
    await click(q('[data-artifact-submit]'))
    expect(q('[data-api-editor="model:OrderLine"]')).not.toBeNull()
    expect(qa('[data-model-field]')).toHaveLength(1)
    await typeInto(q('[data-model-field-name]'), 'sku')
    await click(q('[data-simple-model-save]'))
    expect(calls(actions, 'api_model_set')).toEqual([{ datasource: ID, model: { name: 'OrderLine', fields: [{ name: 'sku', type: 'text' }] } }])
    expect(q('[data-api-item="model:OrderLine"]')).toBeNull()
    await click(q('[data-api-back]'))
    expect(q('[data-api-item="model:OrderLine"]')).not.toBeNull()
  })
})

/** The model's answer to a change made by someone else (the disk, an agent): the editor reads the model again. */
let version = 300
const changedElsewhere = async (change: () => void, file = '.bildr/datasources/shop-api.json') => {
  change()
  FakeEventSource.instances.at(-1)!.send({ type: 'model', version: ++version, files: [file], source: 'disk' })
  await settle()
}
/** The model-set action of the module, but the calls whose turn (1, 2…) is listed are refused. */
const refusing = (turns: number[], message = 'The API refused the model'): Handlers => {
  const real = apiModule().api_model_set!
  let turn = 0
  return { api_model_set: input => turns.includes(++turn) ? new Failure(422, 'invalid', message) : real(input) }
}
const names = (actions: Awaited<ReturnType<typeof mounted>>['actions']) => calls(actions, 'api_model_set').map(call => (call.model as { name: string }).name)
const tryAndUse = async () => {
  await click(q('[data-try-run]'))
  // An action asks before a real write is sent.
  if (q('[data-confirm-ok]')) await click(q('[data-confirm-ok]'))
  await click(q('[data-try-use]'))
}

describe('"Use this answer" when it stops half way', () => {
  it('says which models were added and that the query was not filled in, reads the models again and offers to try again', async () => {
    shop()
    const { actions } = await mounted(LIST, refusing([2]))
    await open('query:products')
    await click(q('[data-try-run]'))
    const before = actions.named('model_get').length
    await click(q('[data-try-use]'))
    expect(names(actions)).toEqual(['Maker', 'Gadget'])
    const said = text(q('[data-proposal-error]'))
    expect(said).toContain('Already added to the API: Maker')
    expect(said).toContain('Could not add Gadget: The API refused the model')
    expect(said).toContain('The query was not filled in')
    expect(actions.named('model_get').length).toBeGreaterThan(before + 1)
    expect(await optionLabels(combo('[data-op-result-model]'))).toContain('Maker')
    expect(combo('[data-op-result-model]').textContent).toContain('Product')
    expect(q('[data-proposal-retry]')).not.toBeNull()
    expect(unsaved()).toBe(false)
  })

  it('names the action when it is an action', async () => {
    shop()
    await mounted(LIST, refusing([2]))
    await open('action:addProduct')
    await tryAndUse()
    expect(text(q('[data-proposal-error]'))).toContain('The action was not filled in')
  })

  it('says only what the module refused when none of the models was added', async () => {
    shop()
    const { actions } = await mounted(LIST, refusing([1]))
    await open('action:addProduct')
    await tryAndUse()
    expect(names(actions)).toEqual(['Maker'])
    expect(text(q('[data-proposal-error]'))).toBe('The API refused the model')
    expect(q('[data-proposal-retry]')).toBeNull()
  })

  it('tries again with the models that are not there yet, and fills the query in when they are', async () => {
    shop()
    const { actions } = await mounted(LIST, refusing([2]))
    await open('query:products')
    await tryAndUse()
    await click(q('[data-proposal-retry]'))
    expect(names(actions)).toEqual(['Maker', 'Gadget', 'Gadget'])
    expect(q('[data-proposal-error]')).toBeNull()
    expect(source().models.map(model => model.name)).toEqual(['Product', 'Maker', 'Gadget'])
    expect(combo('[data-op-result-model]').textContent).toContain('Gadget')
    expect(field('data-op-result-items').value).toBe('items')
    expect(unsaved()).toBe(true)
  })

  it('tries again with the user\'s choices: a model kept under a new name is not asked about again, nor refused for its name', async () => {
    shop()
    seed('api_model_set', { datasource: ID, model: { name: 'Maker', fields: [{ name: 'title', type: 'text' }] } })
    seed('api_model_set', { datasource: ID, model: { name: 'Tag', fields: [{ name: 'label', type: 'text' }] } })
    const proposal = {
      result: { model: 'Gadget', many: true, itemsPath: 'items' },
      models: [
        { name: 'Maker', fields: [{ name: 'name', type: 'text' }] },
        { name: 'Tag', fields: [{ name: 'value', type: 'text' }] },
        { name: 'Gadget', fields: [{ name: 'maker', type: 'model', model: 'Maker' }, { name: 'tag', type: 'model', model: 'Tag' }] }
      ]
    }
    const { actions } = await mounted({ ...LIST, proposal }, refusing([2]))
    await open('query:products')
    await tryAndUse()
    expect(qa('[data-proposal-conflict]').map(row => row.getAttribute('data-proposal-conflict'))).toEqual(['Maker', 'Tag'])
    await click(q('[data-proposal-conflict="Tag"] [data-proposal-choice="replace"]'))
    await click(q('[data-proposal-apply]'))
    expect(names(actions)).toEqual(['Maker2', 'Tag'])
    expect(text(q('[data-proposal-error]'))).toContain('Already added to the API: Maker2')
    await click(q('[data-proposal-retry]'))
    expect(qa('[data-proposal-conflict]').map(row => row.getAttribute('data-proposal-conflict'))).toEqual(['Tag'])
    expect(q('[data-proposal-conflict="Tag"] [data-proposal-choice="replace"]')?.getAttribute('aria-pressed')).toBe('true')
    await click(q('[data-proposal-apply]'))
    expect(text(q('[data-proposal-error]'))).toBe('')
    expect(names(actions)).toEqual(['Maker2', 'Tag', 'Tag', 'Gadget'])
    const gadget = calls(actions, 'api_model_set').at(-1)!.model as { fields: Array<{ model: string }> }
    expect(gadget.fields.map(entry => entry.model)).toEqual(['Maker2', 'Tag'])
    expect(combo('[data-op-result-model]').textContent).toContain('Gadget')
  })

  it('does not fail on a clash that appears while the question is open: it keeps both, as the others do by default', async () => {
    shop()
    seed('api_model_set', { datasource: ID, model: { name: 'Gadget', fields: [{ name: 'sku', type: 'text' }] } })
    const { actions } = await mounted(LIST)
    await open('query:products')
    await tryAndUse()
    expect(qa('[data-proposal-conflict]').map(row => row.getAttribute('data-proposal-conflict'))).toEqual(['Gadget'])
    await changedElsewhere(() => {
      seed('api_model_set', { datasource: ID, model: { name: 'Maker', fields: [{ name: 'title', type: 'text' }] } })
    })
    expect(qa('[data-proposal-conflict]').map(row => row.getAttribute('data-proposal-conflict'))).toEqual(['Maker', 'Gadget'])
    expect(q('[data-proposal-conflict="Maker"] [data-proposal-choice="rename"]')?.getAttribute('aria-pressed')).toBe('true')
    await click(q('[data-proposal-apply]'))
    expect(names(actions)).toEqual(['Maker2', 'Gadget2'])
    expect(text(q('[data-proposal-error]'))).toBe('')
    expect(combo('[data-op-result-model]').textContent).toContain('Gadget2')
  })

  it('does not fail either when the new clash is there when Continue is pressed with nothing chosen for it', async () => {
    shop()
    seed('api_model_set', { datasource: ID, model: { name: 'Gadget', fields: [{ name: 'sku', type: 'text' }] } })
    const { actions } = await mounted(LIST)
    await open('query:products')
    await tryAndUse()
    await changedElsewhere(() => {
      seed('api_model_set', { datasource: ID, model: { name: 'Maker', fields: [{ name: 'title', type: 'text' }] } })
    })
    await typeInto(q('[data-proposal-conflict="Gadget"] [data-proposal-rename]'), 'Gadget Two')
    await click(q('[data-proposal-apply]'))
    expect(names(actions)).toEqual(['Maker2', 'GadgetTwo'])
  })
})

describe('an item that changed elsewhere while it has edits', () => {
  it('a query says so, waits for the choice, and "Keep my edits" keeps the draft and saves it', async () => {
    shop()
    const { actions } = await mounted()
    await open('query:products')
    await type('data-op-path', '/mine')
    await changedElsewhere(() => {
      source().queries[0]!.path = '/theirs'
    })
    expect(text(q('[data-simple-op-changed]'))).toContain('This query changed since you started editing')
    expect(q('[data-simple-op-save]')?.hasAttribute('disabled')).toBe(true)
    await click(q('[data-simple-op-keep-mine]'))
    expect(q('[data-simple-op-changed]')).toBeNull()
    expect(field('data-op-path').value).toBe('/mine')
    expect(unsaved()).toBe(true)
    await save()
    expect(calls(actions, 'api_query_set')).toEqual([{ datasource: ID, query: { name: 'products', path: '/mine', params: [], result: { model: 'Product', many: true, itemsPath: 'items' } } }])
    expect(source().queries[0]!.path).toBe('/mine')
  })

  it('a query: "Load the new version" drops the edits', async () => {
    shop()
    await mounted()
    await open('query:products')
    await type('data-op-path', '/mine')
    await changedElsewhere(() => {
      source().queries[0]!.path = '/theirs'
    })
    await click(q('[data-simple-op-load-new]'))
    expect(field('data-op-path').value).toBe('/theirs')
    expect(unsaved()).toBe(false)
    expect(q('[data-simple-op-changed]')).toBeNull()
  })

  it('an action says so, and "Keep my edits" keeps the draft and saves it', async () => {
    shop()
    const { actions } = await mounted()
    await open('action:addProduct')
    await choose('data-op-method', 'PUT')
    await changedElsewhere(() => {
      source().actions[0]!.path = '/theirs'
    })
    expect(text(q('[data-simple-op-changed]'))).toContain('This action changed since you started editing')
    expect(q('[data-simple-op-save]')?.hasAttribute('disabled')).toBe(true)
    await click(q('[data-simple-op-keep-mine]'))
    expect(q('[data-simple-op-changed]')).toBeNull()
    expect(unsaved()).toBe(true)
    await save()
    expect(calls(actions, 'api_action_set')).toEqual([{ datasource: ID, action: { name: 'addProduct', method: 'PUT', path: '/products', params: [], body: { model: 'Product' }, result: { model: 'Product', many: false } } }])
  })

  it('a model says so, waits for the choice, and "Keep my edits" keeps the fields and saves them', async () => {
    shop()
    const { actions } = await mounted()
    await open('model:Product')
    await click(q('[data-model-field-add]'))
    await typeInto(qa('[data-model-field]').at(-1)!.querySelector('[data-model-field-name]'), 'price')
    await changedElsewhere(() => {
      source().models[0]!.fields.splice(1, 1)
    })
    expect(text(q('[data-simple-model-changed]'))).toContain('This model changed since you started editing')
    expect(q('[data-simple-model-save]')?.hasAttribute('disabled')).toBe(true)
    await click(q('[data-simple-model-keep-mine]'))
    expect(q('[data-simple-model-changed]')).toBeNull()
    expect(qa('[data-model-field]')).toHaveLength(3)
    await click(q('[data-simple-model-save]'))
    expect((calls(actions, 'api_model_set')[0]!.model as { fields: Array<{ name: string }> }).fields.map(entry => entry.name)).toEqual(['id', 'title', 'price'])
  })

  it('a model: "Load the new version" drops the edits', async () => {
    shop()
    await mounted()
    await open('model:Product')
    await click(q('[data-model-field-add]'))
    await typeInto(qa('[data-model-field]').at(-1)!.querySelector('[data-model-field-name]'), 'price')
    await changedElsewhere(() => {
      source().models[0]!.fields.splice(1, 1)
    })
    await click(q('[data-simple-model-load-new]'))
    expect(qa('[data-model-field]')).toHaveLength(1)
    expect(q('[data-simple-model-unsaved]')).toBeNull()
  })
})

describe('renaming with edits that are not saved', () => {
  it('a query keeps its form and its edits, and saves them under the new name', async () => {
    shop()
    const { actions } = await mounted()
    await open('query:products')
    await type('data-op-path', '/items')
    await click(q('[data-api-editor-rename]'))
    await type('data-api-item-name', 'all products')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_query_rename')).toEqual([{ datasource: ID, query: 'products', name: 'allProducts' }])
    expect(q('[data-api-editor="query:allProducts"]')).not.toBeNull()
    expect(text(q('[data-api-editor-title]'))).toBe('allProducts')
    expect(field('data-op-path').value).toBe('/items')
    expect(unsaved()).toBe(true)
    expect(q('[data-simple-op-changed]')).toBeNull()
    await save()
    expect(calls(actions, 'api_query_set')).toEqual([{ datasource: ID, query: { name: 'allProducts', path: '/items', params: [], result: { model: 'Product', many: true, itemsPath: 'items' } } }])
  })

  it('an action keeps its form and its edits, and saves them under the new name', async () => {
    shop()
    const { actions } = await mounted()
    await open('action:addProduct')
    await choose('data-op-method', 'PUT')
    await click(q('[data-api-editor-rename]'))
    await type('data-api-item-name', 'create product')
    await click(q('[data-artifact-submit]'))
    expect(q('[data-api-editor="action:createProduct"]')).not.toBeNull()
    expect(combo('[data-op-method]').textContent).toContain('PUT')
    expect(unsaved()).toBe(true)
    expect(q('[data-simple-op-changed]')).toBeNull()
    await save()
    expect(calls(actions, 'api_action_set')).toEqual([{ datasource: ID, action: { name: 'createProduct', method: 'PUT', path: '/products', params: [], body: { model: 'Product' }, result: { model: 'Product', many: false } } }])
  })

  it('a model keeps its form and its edits, and saves them under the new name', async () => {
    shop()
    const { actions } = await mounted()
    await open('model:Product')
    await click(q('[data-model-field-add]'))
    await typeInto(qa('[data-model-field]').at(-1)!.querySelector('[data-model-field-name]'), 'price')
    await click(q('[data-api-editor-rename]'))
    await type('data-api-item-name', 'Item')
    await click(q('[data-artifact-submit]'))
    expect(q('[data-api-editor="model:Item"]')).not.toBeNull()
    expect(qa('[data-model-field]')).toHaveLength(3)
    expect(q('[data-simple-model-unsaved]')).not.toBeNull()
    expect(q('[data-simple-model-changed]')).toBeNull()
    await click(q('[data-simple-model-save]'))
    expect(calls(actions, 'api_model_set')).toEqual([{ datasource: ID, model: { name: 'Item', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }, { name: 'price', type: 'text' }] } }])
  })

  it('the API, from the settings\' Name field, says before Save what its secret\'s variable becomes, and shows it after', async () => {
    shop({ auth: { type: 'bearer' } })
    const { actions } = await mounted()
    const before = source().env.apiKey!
    expect(before).toBe('NUXT_APIS_SHOP_API_API_KEY')
    expect(q('[data-api-secret-rename]')).toBeNull()
    await type('data-api-name', 'Shop Two')
    expect(text(q('[data-api-secret-rename]'))).toContain('The secret\'s variable becomes NUXT_APIS_SHOP_TWO_API_KEY')
    expect(text(q('[data-api-secret-var]'))).toBe(before)
    await type('data-api-name', 'shop-api')
    expect(q('[data-api-secret-rename]')).toBeNull()
    await type('data-api-name', 'Shop Two')
    await click(q('[data-simple-api-save]'))
    expect(calls(actions, 'api_update')).toEqual([{ datasource: ID, name: 'Shop Two' }])
    expect(source().name).toBe('shop-two')
    expect(source().env.apiKey).toBe('NUXT_APIS_SHOP_TWO_API_KEY')
    expect(text(q('[data-api-secret-var]'))).toBe('NUXT_APIS_SHOP_TWO_API_KEY')
    expect(q('[data-api-secret-rename]')).toBeNull()
  })

  it('the API says nothing of a secret when it has none, or when the sign-in is being taken off', async () => {
    shop()
    await mounted()
    await type('data-api-name', 'Shop Two')
    expect(q('[data-api-secret-rename]')).toBeNull()
    await click(q('[data-api-signin="bearer"]'))
    expect(q('[data-api-secret-rename]')).toBeNull()
  })
})

describe('the fields of a model', () => {
  const grow = () => seed('api_model_set', { datasource: ID, model: { name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }, { name: 'price', type: 'number' }] } })
  const order = () => qa('[data-model-field]').map(row => (row.querySelector('[data-model-field-name]') as HTMLInputElement).value)
  const row = (at: number) => qa('[data-model-field]')[at]!

  it('moves a field down, and the middle one both ways, and the first can\'t go up nor the last down', async () => {
    shop()
    grow()
    const { actions } = await mounted()
    await open('model:Product')
    expect(row(0).querySelector('[data-model-field-up]')?.hasAttribute('disabled')).toBe(true)
    expect(row(2).querySelector('[data-model-field-down]')?.hasAttribute('disabled')).toBe(true)
    await click(row(0).querySelector('[data-model-field-down]') as HTMLElement)
    expect(order()).toEqual(['title', 'id', 'price'])
    await click(row(1).querySelector('[data-model-field-down]') as HTMLElement)
    expect(order()).toEqual(['title', 'price', 'id'])
    await click(row(1).querySelector('[data-model-field-up]') as HTMLElement)
    expect(order()).toEqual(['price', 'title', 'id'])
    await click(row(1).querySelector('[data-model-field-down]') as HTMLElement)
    expect(order()).toEqual(['price', 'id', 'title'])
    await click(q('[data-simple-model-save]'))
    expect((calls(actions, 'api_model_set')[0]!.model as { fields: Array<{ name: string }> }).fields.map(entry => entry.name)).toEqual(['price', 'id', 'title'])
  })

  it('refuses to delete a model another model\'s field holds, in the module\'s words, and keeps it', async () => {
    seed('api_create', { name: 'Shop API', baseUrl: 'https://api.example.com/v1' })
    seed('api_model_set', { datasource: ID, model: { name: 'Product', fields: [{ name: 'id', type: 'integer' }] } })
    seed('api_model_set', { datasource: ID, model: { name: 'Wrapper', fields: [{ name: 'product', type: 'model', model: 'Product' }] } })
    const { actions } = await mounted()
    await click(q('[data-api-item="model:Product"] [data-api-delete]'))
    await click(q('[data-artifact-submit]'))
    expect(text(q('[data-artifact-error]'))).toBe('Product is used by the model Wrapper')
    expect(calls(actions, 'api_model_delete')).toEqual([{ datasource: ID, model: 'Product' }])
    expect(q('[data-api-item="model:Product"]')).not.toBeNull()
    expect(source().models.map(model => model.name)).toEqual(['Product', 'Wrapper'])
  })
})

/** Pastes `text` into `target` as the browser does: a paste event with the text on its clipboard data. */
/** The input (or textarea) of an element: itself, or the one inside it. */
const ownInput = (element: Element | null) => (element?.matches('input, textarea') ? element : element?.querySelector('input, textarea')) as HTMLInputElement
const paste = async (target: Element | null, text: string) => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: (kind: string) => kind === 'text/plain' || kind === 'text' ? text : '' } })
  target!.dispatchEvent(event)
  await settle()
  return event
}

describe('pasting a request into the path (api-calls R1)', () => {
  it('fills the path and the query parameters from a full URL, with the values ready in Try it', async () => {
    shop()
    const { actions } = await mounted(LIST)
    await open('query:products')
    const event = await paste(field('data-op-path'), 'https://api.example.com/v1/catalog?per_page=20&q=lamp')
    expect(event.defaultPrevented).toBe(true)
    expect(field('data-op-path').value).toBe('/catalog')
    const rows = qa('[data-op-param^="query:"]')
    expect(rows.map(row => ownInput(row.querySelector('[data-op-param-name]')).value)).toEqual(['perPage', 'q'])
    expect(ownInput(rows[0]!.querySelector('[data-op-param-remote]')).value).toBe('per_page')
    expect(comboOf(rows[0]!.querySelector('[data-op-param-type]')).textContent).toContain('Whole number')
    expect(text(q('[data-op-paste-note]'))).toContain('Filled in from the URL: the path and 2 query parameters.')
    expect(field('data-try-input="perPage"').value).toBe('20')
    expect(field('data-try-input="q"').value).toBe('lamp')
    await click(q('[data-try-run]'))
    expect(calls(actions, 'api_try')).toEqual([{ datasource: ID, path: '/catalog', params: { per_page: 20, q: 'lamp' } }])
    expect(unsaved()).toBe(true)
  })

  it('fills an action\'s method, path and body to try from a cURL command, and says what it left out', async () => {
    shop({ auth: { type: 'header', header: 'X-Api-Key' } })
    await mounted()
    await open('action:addProduct')
    await paste(field('data-op-path'), `curl -X PUT 'https://api.example.com/v1/products/9' -H 'X-Api-Key: k-1' -H 'X-Trace: t' --data-raw '{"title":"Desk"}'`)
    expect(field('data-op-path').value).toBe('/products/9')
    expect(combo('[data-op-method]').textContent).toContain('PUT')
    expect(field('data-try-body').value).toBe('{\n  "title": "Desk"\n}')
    const note = text(q('[data-op-paste-note]'))
    expect(note).toContain('Filled in from the cURL command')
    expect(note).toContain('Left out the sign-in (X-Api-Key)')
    expect(note).toContain('Left out the header “X-Trace”')
    expect(document.body.innerHTML).not.toContain('k-1')
    await click(q('[data-op-paste-dismiss]'))
    expect(q('[data-op-paste-note]')).toBeNull()
  })

  it('refuses a URL that is not under the API\'s base URL, and leaves the path as it was', async () => {
    shop()
    await mounted()
    await open('query:products')
    await paste(field('data-op-path'), 'https://elsewhere.example.com/products')
    expect(field('data-op-path').value).toBe('/products')
    expect(text(q('[data-op-paste-error]'))).toBe('That URL is not under the API\'s base URL, https://api.example.com/v1')
    expect(unsaved()).toBe(false)
  })

  it('lets a path or words paste as usual, and says the path takes a URL or a cURL command', async () => {
    shop()
    await mounted()
    await open('query:products')
    const event = await paste(field('data-op-path'), '/products/:id')
    expect(event.defaultPrevented).toBe(false)
    expect(q('[data-op-paste-note]')).toBeNull()
    expect(text(q('[data-op-path-help]'))).toContain('Paste a full URL or a cURL command')
  })
})

describe('the editor\'s two columns (api-calls R1)', () => {
  it('has the definition and Try it side by side: Try it is in its own column', async () => {
    shop()
    await mounted()
    await open('query:products')
    const definition = q('[data-op-definition]')
    const test = q('[data-op-test]')
    expect(definition?.querySelector('[data-op-path]')).not.toBeNull()
    expect(definition?.querySelector('[data-api-try]')).toBeNull()
    expect(test?.querySelector('[data-api-try]')).not.toBeNull()
    expect(definition?.parentElement).toBe(test?.parentElement)
  })
})

describe('Try it shows the request and how the answer was (api-calls T1)', () => {
  it('shows the request as it will be sent, following the values, with the sign-in masked', async () => {
    shop({ auth: { type: 'bearer' } })
    await mounted(LIST)
    await open('query:productById')
    expect(text(q('[data-try-request-method]'))).toBe('GET')
    expect(text(q('[data-try-request-url]'))).toBe('https://api.example.com/v1/products/:id')
    expect(text(q('[data-try-request-missing]'))).toContain('id')
    await type('data-try-input="id"', '7')
    expect(text(q('[data-try-request-url]'))).toBe('https://api.example.com/v1/products/7')
    expect(q('[data-try-request-missing]')).toBeNull()
    expect(text(q('[data-try-request-header="Authorization"]'))).toContain('Bearer ••••')
    expect(text(q('[data-try-request-signin]'))).toContain('from the env')
  })

  it('shows the body an action sends', async () => {
    shop()
    await mounted()
    await open('action:addProduct')
    await type('data-try-body', '{"title":"Lamp"}')
    expect(text(q('[data-try-request-method]'))).toBe('POST')
    expect(text(q('[data-try-request-header="Content-Type"]'))).toContain('application/json')
    expect(text(q('[data-try-request-body]'))).toBe('{"title":"Lamp"}')
  })

  it('says how long the answer took and how big it was', async () => {
    shop()
    await mounted({ ...LIST, durationMs: 87, size: 1234, headers: { 'content-type': 'application/json' } })
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(text(q('[data-try-time]'))).toBe('87 ms')
    expect(text(q('[data-try-size]'))).toBe('1.2 KB')
  })

  it('keeps the values to try with when the query is closed and opened again, writing nothing to the project', async () => {
    shop()
    const { actions } = await mounted(LIST)
    await open('query:productById')
    await type('data-try-input="id"', '7')
    await click(q('[data-api-back]'))
    expect(q('[data-confirm-ok]')).toBeNull()
    await open('query:productById')
    expect(field('data-try-input="id"').value).toBe('7')
    expect(calls(actions, 'api_query_set')).toEqual([])
  })
})

describe('Try it\'s answer', () => {
  it('goes when the path changes, and so does Use this answer', async () => {
    shop()
    await mounted(LIST)
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(q('[data-try-answer]')).not.toBeNull()
    expect(q('[data-try-use]')).not.toBeNull()
    await type('data-op-path', '/products?x=1')
    expect(q('[data-try-answer]')).toBeNull()
    expect(q('[data-try-use]')).toBeNull()
  })

  it('goes when a parameter is named, and when the method changes', async () => {
    shop()
    await mounted(LIST)
    await open('action:addProduct')
    await click(q('[data-try-run]'))
    await click(q('[data-confirm-ok]'))
    expect(q('[data-try-answer]')).not.toBeNull()
    await click(q('[data-op-param-add]'))
    expect(q('[data-try-answer]')).not.toBeNull()
    await typeInto(q('[data-op-param^="query:"] [data-op-param-name]'), 'page')
    expect(q('[data-try-answer]')).toBeNull()
    await click(q('[data-try-run]'))
    await click(q('[data-confirm-ok]'))
    expect(q('[data-try-answer]')).not.toBeNull()
    await choose('data-op-method', 'PUT')
    expect(q('[data-try-answer]')).toBeNull()
  })

  it('stays when what the call answers is filled in', async () => {
    shop()
    await mounted(LIST)
    await open('query:products')
    await click(q('[data-try-run]'))
    await choose('data-op-result-model', 'Product')
    expect(q('[data-try-answer]')).not.toBeNull()
  })

  it('goes while a new run is in flight', async () => {
    shop()
    let release: (answer: unknown) => void = () => {}
    let first = true
    await mounted(() => {
      if (first) {
        first = false
        return LIST
      }
      return new Promise((resolve) => {
        release = resolve
      })
    })
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(q('[data-try-answer]')).not.toBeNull()
    await click(q('[data-try-run]'))
    expect(q('[data-try-answer]')).toBeNull()
    expect(q('[data-try-use]')).toBeNull()
    release({ ...LIST, status: 201 })
    await settle()
    expect(text(q('[data-try-status]'))).toContain('201')
  })

  it('says the first N of M when the list was cut', async () => {
    shop()
    const cut = { ...LIST, json: { items: Array.from({ length: 10 }, (_, at) => ({ id: at })), total: 25 }, items: { path: 'items', count: 25 } }
    await mounted(cut)
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(text(q('[data-try-items]'))).toBe('Found a list at “items”: first 10 of 25 items')
  })

  it('says the whole count when nothing was cut', async () => {
    shop()
    await mounted(LIST)
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(text(q('[data-try-items]'))).toBe('Found a list of 2 items at “items”')
  })
})

/** A tab of Try it's answer: Tree, Raw or Headers. */
const answerTab = (label: string) => q(`[data-answer-tabs] button[aria-label="${label}"]`)

describe('Try it\'s answer viewer (api-calls T2)', () => {
  const NESTED = {
    status: 200,
    url: 'https://api.example.com/v1/products',
    json: { meta: { total: 2 }, others: [{ x: 1 }], data: { items: [{ id: 1, title: 'Lamp' }, { id: 2, title: 'Desk' }] } },
    items: { path: 'others', count: 1 },
    headers: { 'content-type': 'application/json', 'x-request-id': 'r-1' },
    durationMs: 12,
    size: 140
  }

  it('shows the answer as a tree, open on the way to the recommended list, with Raw and Headers beside it', async () => {
    shop()
    await mounted(NESTED)
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(answerTab('Tree')?.getAttribute('aria-pressed')).toBe('true')
    expect(qa('[data-answer-row]').map(row => row.getAttribute('data-answer-row'))).toEqual(['meta', 'others', 'others.0', 'data'])
    expect(text(q('[data-answer-row="others"] [data-answer-recommended]'))).toBe('Recommended')
    expect(q('[data-answer-row="data"] [data-answer-recommended]')).toBeNull()
    await click(q('[data-answer-row="data"] [data-answer-toggle]'))
    expect(text(q('[data-answer-row="data.items"]'))).toContain('2 items')
    expect(q('[data-answer-row="data.items"] [data-answer-use-list]')).not.toBeNull()
    await click(answerTab('Raw'))
    expect(q('[data-answer-raw]')?.textContent).toContain('"Lamp"')
    expect(q('[data-answer-row]')).toBeNull()
    await click(answerTab('Headers'))
    expect(text(q('[data-answer-header="x-request-id"]'))).toBe('r-1')
  })

  it('takes the list a query answers from a click on one: it answers a list, and that is where the list is', async () => {
    shop()
    const { actions } = await mounted(NESTED)
    await open('query:productById')
    await type('data-try-input="id"', '1')
    await click(q('[data-try-run]'))
    await click(q('[data-answer-row="data"] [data-answer-toggle]'))
    await click(q('[data-answer-row="data.items"] [data-answer-use-list]'))
    expect(field('data-op-result-items').value).toBe('data.items')
    expect(q('[data-op-result-many]')?.getAttribute('aria-checked') ?? q('[data-op-result-many] [role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    expect(text(q('[data-answer-row="data.items"] [data-answer-current]'))).toBe('The list')
    expect(q('[data-answer-row="data.items"] [data-answer-use-list]')).toBeNull()
    expect(unsaved()).toBe(true)
    expect(calls(actions, 'api_query_set')).toEqual([])
    await save()
    expect(calls(actions, 'api_query_set')[0]!.query).toMatchObject({ name: 'productById', result: { model: 'Product', many: true, itemsPath: 'data.items' } })
  })

  it('offers no list to an action that answers nothing, and no Headers tab when the answer has none', async () => {
    shop()
    seed('api_action_set', { datasource: ID, action: { name: 'ping', method: 'POST', path: '/ping', params: [] } })
    await mounted({ ...NESTED, headers: undefined })
    await open('action:ping')
    await click(q('[data-try-run]'))
    await click(q('[data-confirm-ok]'))
    expect(q('[data-answer-row="others"]')).not.toBeNull()
    expect(q('[data-answer-use-list]')).toBeNull()
    expect(answerTab('Headers')).toBeNull()
  })

  it('shows an answer that is not JSON as it is, with no tree', async () => {
    shop()
    await mounted({ status: 500, url: 'https://api.example.com/v1/products', text: 'Server error', headers: {} })
    await open('query:products')
    await click(q('[data-try-run]'))
    expect(answerTab('Tree')).toBeNull()
    expect(q('[data-answer-raw]')?.textContent).toBe('Server error')
  })
})

describe('the body a pasted sample made', () => {
  const SAMPLE = '{"title":"Lamp","price":3.5}'

  it('is the body Try it sends, without typing it again', async () => {
    shop()
    seed('api_action_set', { datasource: ID, action: { name: 'addReview', method: 'POST', path: '/reviews', params: [] } })
    const { actions } = await mounted({ status: 201, url: 'https://api.example.com/v1/reviews', json: {} })
    await open('action:addReview')
    expect(field('data-try-body').value).toBe('')
    await click(q('[data-op-body-sample-toggle]'))
    await type('data-op-body-sample', SAMPLE)
    await click(q('[data-op-body-sample-use]'))
    expect(field('data-try-body').value).toBe(SAMPLE)
    await click(q('[data-try-run]'))
    await click(q('[data-confirm-ok]'))
    expect(calls(actions, 'api_try')).toEqual([{ datasource: ID, path: '/reviews', method: 'POST', body: { title: 'Lamp', price: 3.5 }, confirm: true }])
  })

  it('does not replace a body that was typed', async () => {
    shop()
    seed('api_action_set', { datasource: ID, action: { name: 'addReview', method: 'POST', path: '/reviews', params: [] } })
    await mounted()
    await open('action:addReview')
    await type('data-try-body', '{"title":"Mine"}')
    await click(q('[data-op-body-sample-toggle]'))
    await type('data-op-body-sample', SAMPLE)
    await click(q('[data-op-body-sample-use]'))
    expect(field('data-try-body').value).toBe('{"title":"Mine"}')
  })
})

describe('the footer after Use this answer', () => {
  it('says the models were added and that Save keeps the query, and Discard says the models stay', async () => {
    shop()
    await mounted(LIST)
    await open('query:products')
    expect(q('[data-simple-op-blocked]')).toBeNull()
    await tryAndUse()
    expect(text(q('[data-simple-op-blocked]'))).toBe('Models added. Save to keep the query.')
    expect(q('[data-simple-op-discard]')?.getAttribute('title')).toBe('Drops your edits to this query. The models you added stay.')
    await click(q('[data-simple-op-discard]'))
    expect(q('[data-simple-op-blocked]')).toBeNull()
    expect(source().models.map(model => model.name)).toEqual(['Product', 'Maker', 'Gadget'])
  })

  it('goes with Save', async () => {
    shop()
    await mounted(LIST)
    await open('query:products')
    await tryAndUse()
    await save()
    expect(q('[data-simple-op-blocked]')).toBeNull()
    expect(unsaved()).toBe(false)
  })

  it('says nothing when no model was added (the same model was already there)', async () => {
    shop()
    const same = { ...LIST, proposal: { result: { model: 'Product', many: true, itemsPath: 'items' }, models: [{ name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }] }] } }
    await mounted(same)
    await open('query:productById')
    await type('data-try-input="id"', '1')
    await tryAndUse()
    expect(q('[data-simple-op-blocked]')).toBeNull()
  })

  it('says the action for an action, after a model is made from a sample', async () => {
    shop()
    seed('api_action_set', { datasource: ID, action: { name: 'addReview', method: 'POST', path: '/reviews', params: [] } })
    await mounted()
    await open('action:addReview')
    await click(q('[data-op-body-sample-toggle]'))
    await type('data-op-body-sample', '{"stars": 5}')
    await click(q('[data-op-body-sample-use]'))
    expect(text(q('[data-simple-op-blocked]'))).toBe('Models added. Save to keep the action.')
  })
})

/** What the section says in words, wherever the user reads it. */
const said = () => [
  document.body.textContent ?? '',
  ...qa('[aria-label], [title], [placeholder]').flatMap(element => ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name) ?? ''))
].join(' ')
const JARGON = /\b(state|composable|collection|entity|artifact|datasource|data source)\b/i
const COMPOSABLE = /\buse[A-Z][A-Za-z0-9]+/

describe('the words of the API screens', () => {
  it('are plain everywhere: the dialogs, the panel, the editors, Try it and the refusals', async () => {
    shop({ auth: { type: 'bearer' } })
    await mounted(LIST)
    const seen: Array<[string, string]> = []
    const note = (what: string) => seen.push([what, said()])
    note('the panel')
    await click(q('[data-simple-api-delete]'))
    note('the Delete API dialog')
    await click(button('Cancel'))
    await click(q('[data-api-item="model:Product"] [data-api-delete]'))
    await click(q('[data-artifact-submit]'))
    note('a refused delete')
    await click(button('Cancel'))
    await open('query:products')
    await click(q('[data-try-run]'))
    note('the query editor after Try it')
    await click(q('[data-api-back]'))
    await open('action:addProduct')
    note('the action editor')
    await click(q('[data-try-run]'))
    note('the confirmation of a real write')
    await click(q('[data-confirm-cancel]'))
    await click(q('[data-api-back]'))
    await open('model:Product')
    note('the model editor')
    await click(q('[data-api-back]'))
    await click(q('[data-simple-new-api]'))
    note('the New API dialog')
    for (const [what, words] of seen) {
      expect(words, what).not.toMatch(JARGON)
      expect(words, what).not.toMatch(COMPOSABLE)
    }
  })
})

describe('the pages that use a query (simple data P7b, B5)', () => {
  /** Two pages read `products` of the API; nothing reads `productById`. */
  const used = () => {
    shop()
    seed('page_use_add', { page: 'pg_index', as: 'shopProducts', api: { datasource: ID, query: 'products' } })
    seed('page_use_add', { page: 'pg_new_post', as: 'shopItems', api: { datasource: ID, query: 'products' } })
  }

  it('shows under a query the pages that read it, and nothing under one no page reads', async () => {
    used()
    await mounted()
    expect(text(q('[data-api-item="query:products"]'))).toContain('Used in index, posts-new')
    expect(q('[data-api-item="query:products"] [data-api-used]')).not.toBeNull()
    expect(q('[data-api-item="query:productById"] [data-api-used]')).toBeNull()
    expect(q('[data-api-item="action:addProduct"] [data-api-used]')).toBeNull()
  })

  it('says in the Delete dialog which pages read the query, and the refusal names them too', async () => {
    used()
    const { actions } = await mounted()
    await click(q('[data-api-item="query:products"] [data-api-delete]'))
    expect(text(q('[data-api-item-delete-used]'))).toContain('Used in index, posts-new')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'api_query_delete')).toEqual([{ datasource: ID, query: 'products' }])
    const refusal = text(q('[data-artifact-error]'))
    expect(refusal).toContain('still used')
    expect(refusal).toContain('page "index"')
    expect(refusal).toContain('page "posts-new"')
    // The ids of the module's words are not the user's.
    expect(refusal).not.toMatch(/pg_/)
    expect(q('[data-api-item="query:products"]')).not.toBeNull()
  })

  it('deletes a query no page reads without a note', async () => {
    used()
    await mounted()
    await click(q('[data-api-item="query:productById"] [data-api-delete]'))
    expect(q('[data-api-item-delete-used]')).toBeNull()
    await click(q('[data-artifact-submit]'))
    expect(q('[data-api-item="query:productById"]')).toBeNull()
  })
})
