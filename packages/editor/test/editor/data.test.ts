import { afterEach, describe, expect, it, vi } from 'vitest'
import { click, Failure, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import type { AppRoutes } from '../helpers.ts'
import DataView from '../../src/views/DataView.vue'
import App from '../../src/App.vue'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { baseHandlers, byLabel, menuItem, selectOption, setupHarness, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'

/**
 * The hosted Data view over the module (U7), mounted as the Data screen over the mocked actions
 * (which check every call against the real action schemas): the sidebar of collections and
 * connections, the read-only rows table, the right panel and the dialogs. Collections are entities,
 * connections REST data sources; each edit is one module action.
 */

setupHarness()

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })

const post = (slug: string) => ({ id: `id-${slug}`, title: `Post ${slug}`, slug, body: `Body of ${slug}`, published: slug !== 'draft', publishedAt: null, createdAt: '2026-11-10T09:00:00.000Z', updatedAt: '2026-11-10T09:00:00.000Z' })
const quotes = [{ id: 1, text: 'Q one', author: 'Ann' }, { id: 2, text: 'Q two', author: 'Bob' }]

/** Mounts the Data screen with the base handlers plus `extra`. */
const open = async (extra: Handlers = {}, routes: AppRoutes = {}) => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...extra }, routes)
  const mounted = await mountWithApp(DataView, '/data')
  return { actions, ...mounted }
}

const inputs = (actions: Awaited<ReturnType<typeof open>>['actions'], name: string) => actions.named(name).map(call => call.input)
const collection = (plural: string) => q(`[data-collection="${plural}"]`)

afterEach(() => {
  takeStart()
  localStorage.removeItem('bildr:panel-width')
})

describe('the Data screen', () => {
  it('lays out the sidebar of collections and connections, the rows table and the right panel, on the dark chrome', async () => {
    await open()
    expect(q('[data-view-menu]')?.textContent?.trim()).toBe('Data')
    expect(q('[data-testid="data"]')).not.toBeNull()
    expect(document.documentElement.classList.contains('bildr-editor')).toBe(true)
    expect(text(q('[data-collections-internal]'))).toContain('Post')
    expect(text(q('[data-collections-synced]'))).toContain('quotes')
    expect(text(q('[data-connection="ds_quotes"]'))).toContain('Quote')
    expect(q('[data-records]')).not.toBeNull()
    expect(q('[data-data-panel] [data-collection-panel]')).not.toBeNull()
    expect(q('[data-data-panel]')?.style.width).toBe('320px')
  })

  it('counts a collection\'s rows from its fixtures, and a REST collection\'s once they are read', async () => {
    await open()
    expect(text(collection('posts')?.querySelector('[data-collection-count]') ?? null)).toBe('2')
    expect(text(collection('quotes')?.querySelector('[data-collection-count]') ?? null)).toBe('')
  })

  it('shows a model with problems as the list of them, and links to the Model screen', async () => {
    const { actions } = await open({ model_get: () => ({ ok: false, problems: [{ path: '.bildr/modules/blog/entities/post.json', message: 'bad entity' }], files: {}, database: false }) })
    expect(q('[data-testid="data-problems"]')?.textContent).toContain('bad entity')
    expect(actions.named('model_get').length).toBeGreaterThan(0)
    expect(q('[data-records]')).toBeNull()
  })

  it('links to the raw model files on the Model screen', async () => {
    const { router } = await open()
    await click(q('[data-raw-model]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/model'))
  })

  it('opens the other screen for a view the Data screen does not show, through the view menu', async () => {
    const open_ = vi.fn()
    const off = registerScreens(open_)
    try {
      await open()
      await menuItem(q('[data-view-menu]'), 'Settings')
      expect(open_).toHaveBeenCalledWith('design')
      expect(takeStart().view).toBe('settings')
    } finally {
      off()
    }
  })

  it('is reached from the app\'s navigation, and the Design screen\'s view menu offers Data', async () => {
    mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }) })
    const { router } = await mountWithApp(App, '/design')
    expect(text(q('nav'))).toContain('Data')
    await menuItem(q('[data-view-menu]'), 'Data')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    await settle()
    expect(q('[data-view-menu]')?.textContent?.trim()).toBe('Data')
    expect(q('[data-collections-internal]')).not.toBeNull()
  })
})

describe('the rows table', () => {
  it('shows the entity\'s fixtures as read-only rows, badged Fixtures, with why the app\'s rows are not shown', async () => {
    await open()
    expect(qa('[data-records-header]').map(header => text(header))).toEqual(['Title', 'Slug', 'Body', 'Published', 'Published at'])
    expect(qa('[data-record]')).toHaveLength(2)
    expect(text(q('[data-record] [data-cell="0-0"]'))).toBe('Hello bildr')
    expect(text(q('[data-live-badge]'))).toBe('Fixtures')
    expect(text(q('[data-records-error]'))).toContain('Showing the model\'s fixtures')
    expect(text(q('[data-records-error]'))).toContain('The app\'s list route for posts could not be reached.')
    expect(text(q('[data-records-count]'))).toBe('2 items')
    expect(q('[data-cell-toggle]')?.getAttribute('aria-checked')).toBe('true')
    // Read-only: no add row, no cell editors, no bulk delete.
    expect(q('[data-add-row], [data-cell-input], [data-records-add], [data-records-delete]')).toBeNull()
  })

  it('shows the app\'s rows when its list route answers', async () => {
    await open({}, { '/api/blog/posts': { items: [post('one'), post('two'), post('draft')], total: 3 } })
    expect(text(q('[data-live-badge]'))).toBe('App data')
    expect(q('[data-records-error]')).toBeNull()
    expect(qa('[data-record]')).toHaveLength(3)
    expect(text(collection('posts')?.querySelector('[data-collection-count]') ?? null)).toBe('3')
  })

  it('searches, filters and sorts the loaded rows', async () => {
    await open({}, { '/api/blog/posts': { items: [post('one'), post('two'), post('draft')], total: 3 } })
    const titles = () => qa('[data-record]').map(row => text(row.querySelector('[data-cell$="-0"]')))
    await click(q('[data-records-search-open]'))
    await typeInto(q('[data-records-search]'), 'TWO')
    expect(titles()).toEqual(['Post two'])
    expect(text(q('[data-records-count]'))).toBe('1 of 3 items')
    await typeInto(q('[data-records-search]'), '')
    await click(qa('[data-records-header]')[0]!)
    await click(qa('[data-records-header]')[0]!)
    expect(titles()).toEqual(['Post two', 'Post one', 'Post draft'])
  })

  it('opens a row in the right panel, read-only, and closes it', async () => {
    await open()
    await click(q('[data-record]'))
    const panel = q('[data-record-panel]')!
    expect(panel.getAttribute('data-record-id')).toBe('0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01')
    expect(text(panel.querySelector('[data-record-field="title"]'))).toContain('Hello bildr')
    expect(text(panel.querySelector('[data-record-field="published"]'))).toContain('Yes')
    expect(panel.querySelector('input, textarea, [role="switch"]')).toBeNull()
    await click(q('[data-record-close]'))
    expect(q('[data-record-panel]')).toBeNull()
    expect(q('[data-collection-panel]')).not.toBeNull()
  })

  it('shows a REST collection as Remote, with the reason the app\'s rows could not be read', async () => {
    await open()
    await click(collection('quotes'))
    expect(text(q('[data-live-badge]'))).toBe('Remote')
    expect(text(q('[data-records-error]'))).toContain('The app\'s list route for quotes could not be reached.')
    expect(text(q('[data-records-empty]'))).toBe('The API returned no items.')
  })

  it('shows a REST collection\'s rows from the app\'s list route', async () => {
    await open({}, { '/api/blog/quotes': { items: quotes, total: 2 } })
    await click(collection('quotes'))
    await settle()
    expect(qa('[data-record]').map(row => text(row))).toEqual([expect.stringContaining('Q one'), expect.stringContaining('Q two')])
    expect(q('[data-records-error]')).toBeNull()
  })

  it('reads the rows again on Refresh', async () => {
    let answer = [post('one')]
    const { actions } = await open({}, { '/api/blog/posts': () => ({ items: answer, total: answer.length }) })
    expect(qa('[data-record]')).toHaveLength(1)
    answer = [post('one'), post('two')]
    const before = actions.appCalls.length
    await click(q('[data-records-refresh]'))
    expect(qa('[data-record]')).toHaveLength(2)
    expect(actions.appCalls.length).toBe(before + 1)
  })
})

describe('collections', () => {
  it('adds one with an inline name: an entity over the app database with a first field', async () => {
    const { actions } = await open({ entity_create: ok({ entityId: 'ent_menu' }) })
    await click(q('[aria-label="Add collection"]'))
    await typeInto(q('[aria-label="New collection name"]'), 'Menu')
    q('[aria-label="New collection name"]')!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(inputs(actions, 'entity_create')).toEqual([{ name: 'Menu', source: 'ds_main', fields: [{ name: 'title', type: 'text' }] }])
  })

  it('renames one by double-click, and deletes it after a confirmation', async () => {
    const { actions } = await open({ entity_update: ok(), entity_delete: ok({ deleted: ['ent_post'] }) })
    collection('posts')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settle()
    const input = byLabel('Rename collection')!
    await typeInto(input, 'Article')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(inputs(actions, 'entity_update')).toEqual([{ entity: 'ent_post', name: 'Article' }])
    await menuItem(byLabel('Collection actions'), 'Delete')
    expect(q('[data-confirm]')?.textContent).toContain('Undo brings it back')
    await click(qa('button').find(button => button.textContent?.trim() === 'Delete collection') ?? null)
    expect(inputs(actions, 'entity_delete')).toEqual([{ entity: 'ent_post' }])
  })

  it('keeps a collection a page still uses, and says so', async () => {
    await open({ entity_delete: () => new Failure(422, 'invalid', 'Entity Post is still used by pg_index (uses). Change them first') })
    await menuItem(byLabel('Collection actions'), 'Delete')
    await click(qa('button').find(button => button.textContent?.trim() === 'Delete collection') ?? null)
    expect(q('[data-testid="design-error"]')?.textContent).toContain('still used by pg_index')
  })

  it('starts from "Add your first collection" when there are none', async () => {
    world.model.modules.blog!.entities = []
    world.model.modules.blog!.repositories = []
    const { actions } = await open({ entity_create: ok({ entityId: 'ent_untitled' }) })
    expect(q('[data-data-empty]')).not.toBeNull()
    await click(q('[data-empty-new]'))
    expect(inputs(actions, 'entity_create')).toEqual([{ name: 'Untitled', source: 'ds_main', fields: [{ name: 'title', type: 'text' }] }])
  })
})

describe('fields', () => {
  const fieldsTab = async () => click(q('[data-data-tab="fields"]'))
  const row = (name: string) => q(`[data-fields-tab] [data-field="${name}"]`)!

  it('lists the fields of the shown collection with their types', async () => {
    await open()
    await fieldsTab()
    expect(text(q('[data-fields-title]'))).toBe('Post')
    expect(qa('[data-fields-tab] [data-field]').map(entry => entry.getAttribute('data-field'))).toEqual(['title', 'slug', 'body', 'published', 'publishedAt'])
  })

  it('renames a field and changes its type in place', async () => {
    const { actions } = await open({ entity_field_update: ok() })
    await fieldsTab()
    const name = row('body').querySelector<HTMLInputElement>('[data-field-label-input]')!
    await typeInto(name, 'content')
    expect(inputs(actions, 'entity_field_update')).toEqual([{ entity: 'ent_post', field: 'fld_body', name: 'content' }])
    await selectOption(row('slug').querySelector('[data-field-type]'), 'Integer')
    expect(inputs(actions, 'entity_field_update').at(-1)).toEqual({ entity: 'ent_post', field: 'fld_slug', type: 'integer' })
  })

  it('puts a refused rename back and says why', async () => {
    await open({ entity_field_update: () => new Failure(422, 'invalid', 'slug is used by q_post_by_slug: change them first') })
    await fieldsTab()
    const name = row('slug').querySelector<HTMLInputElement>('[data-field-label-input]')!
    await typeInto(name, 'permalink')
    expect(q('[data-testid="design-error"]')?.textContent).toContain('used by q_post_by_slug')
    expect(row('slug').querySelector<HTMLInputElement>('[data-field-label-input]')!.value).toBe('slug')
  })

  it('adds a field by name and type, and removes one after a confirmation', async () => {
    const { actions } = await open({ entity_field_add: ok({ fieldId: 'fld_served_from' }), entity_field_remove: ok() })
    await fieldsTab()
    await click(q('[aria-label="Add field"]'))
    await typeInto(q('[data-new-field-label]'), 'Reading time')
    await selectOption(q('[data-new-field-type]'), 'Number')
    q('[data-add-field]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(inputs(actions, 'entity_field_add')).toEqual([{ entity: 'ent_post', name: 'Reading time', type: 'number' }])
    await click(row('body').querySelector('[data-row-remove]'))
    await click(qa('button').find(button => button.textContent?.trim() === 'Remove field') ?? null)
    expect(inputs(actions, 'entity_field_remove')).toEqual([{ entity: 'ent_post', field: 'fld_body' }])
  })

  it('moves a field by dragging its grip', async () => {
    const { actions } = await open({ entity_field_move: ok() })
    await fieldsTab()
    const grip = row('published').querySelector<HTMLElement>('[data-field-handle]')!
    grip.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: { setData() {}, setDragImage() {}, effectAllowed: '' } }))
    const target = row('title')
    target.getBoundingClientRect = () => ({ top: 0, height: 36, bottom: 36, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} })
    target.dispatchEvent(Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { clientY: 2 }))
    target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    await settle()
    expect(inputs(actions, 'entity_field_move')).toEqual([{ entity: 'ent_post', field: 'fld_published', index: 0 }])
  })

  it('lists a REST collection\'s fields read-only with the key each reads', async () => {
    await open()
    await click(collection('quotes'))
    await fieldsTab()
    expect(text(row('text'))).toContain('quote')
    expect(row('text').querySelector('input')).toBeNull()
    expect(q('[data-edit-mapping]')).not.toBeNull()
  })
})

describe('the collection panel', () => {
  it('edits the name, the plural and whether the app serves the list: each one entity_update', async () => {
    const { actions } = await open({ entity_update: ok() })
    const panel = q('[data-collection-panel]')!
    await typeInto(panel.querySelector('[aria-label="Collection name"]'), 'Article')
    await click(panel.querySelector('[data-flag="expose"]'))
    expect(inputs(actions, 'entity_update')).toEqual([{ entity: 'ent_post', name: 'Article' }, { entity: 'ent_post', expose: false }])
  })

  it('shows what stores it, its create action and its fields, and opens the Fields tab', async () => {
    await open()
    expect(text(q('[data-stored-in]'))).toBe('main (sqlite)')
    expect(text(q('[data-create-action]'))).toBe('act_create_post')
    await click(q('[data-show-fields]'))
    expect(q('[data-fields-tab]')).not.toBeNull()
  })

  it('opens the detail page of a collection on the Canvas', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await open()
      expect(text(q('[data-open-detail-page]'))).toBe('posts-slug')
      await click(q('[data-open-detail-page="pg_post_detail"]'))
      expect(opened).toHaveBeenCalledWith('design')
    } finally {
      off()
    }
  })

  it('says how to make a detail page for a collection with none, instead of offering to create one', async () => {
    await open()
    await click(collection('quotes'))
    expect(q('[data-create-detail-page]')).toBeNull()
    expect(q('[data-no-detail-page]')?.textContent).toContain('route parameter')
  })
})

describe('connections', () => {
  it('shows a connection in the right panel with its base URL and auth', async () => {
    await open({ env_status: () => ({ variables: [{ name: 'NUXT_DATASOURCES_QUOTES_API_KEY', datasource: 'ds_quotes', setting: 'apiKey', secret: true, hasDefault: false, set: true, from: '.env' }] }) })
    await click(q('[data-connection-name]'))
    const panel = q('[data-connection-panel]')!
    expect(panel.getAttribute('data-connection-id')).toBe('ds_quotes')
    expect(panel.querySelector<HTMLInputElement>('[aria-label="Base URL"]')?.value).toBe('https://dummyjson.com')
    expect(text(panel.querySelector('[data-base-url-env]'))).toContain('NUXT_DATASOURCES_QUOTES_BASE_URL')
    expect(text(panel.querySelector('[data-auth-env]'))).toBe('NUXT_DATASOURCES_QUOTES_API_KEY')
    expect(text(panel.querySelector('[data-auth-status]'))).toBe('Set')
  })

  it('edits the name and the base URL: each one datasource_update', async () => {
    const { actions } = await open({ datasource_update: ok() })
    await click(q('[data-connection-name]'))
    const panel = q('[data-connection-panel]')!
    for (const [label, value] of [['Connection name', 'dummy'], ['Base URL', 'https://example.org/v2']] as const) {
      await typeInto(panel.querySelector(`[aria-label="${label}"]`), value)
    }
    expect(inputs(actions, 'datasource_update')).toEqual([{ datasource: 'ds_quotes', name: 'dummy' }, { datasource: 'ds_quotes', defaults: { baseUrl: 'https://example.org/v2' } }])
  })

  it('changes how it authenticates, and says the secret is an env var: Header takes a header name', async () => {
    const { actions } = await open({ datasource_update: ok() })
    await click(q('[data-connection-name]'))
    await selectOption(q('[data-auth-type]'), 'Header')
    expect(inputs(actions, 'datasource_update')).toEqual([{ datasource: 'ds_quotes', auth: { type: 'header', secret: 'apiKey', header: 'X-Api-Key' } }])
    await selectOption(q('[data-auth-type]'), 'None')
    expect(inputs(actions, 'datasource_update').at(-1)).toEqual({ datasource: 'ds_quotes', auth: null })
    expect(q('[data-connection-panel]')?.textContent).toContain('never here')
  })

  it('adds a connection with an inline name, with a placeholder base URL to set in the panel', async () => {
    const { actions } = await open({ datasource_create: ok({ datasourceId: 'ds_billing' }) })
    await menuItem(q('[data-synced-add]'), 'New connection')
    await typeInto(q('[aria-label="New connection name"]'), 'Billing')
    q('[data-new-connection]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(inputs(actions, 'datasource_create')).toEqual([{ name: 'Billing', kind: 'rest', defaults: { baseUrl: 'https://api.example.com' } }])
  })

  it('renames a connection, and deletes it with its collections after a confirmation', async () => {
    const { actions } = await open({ datasource_update: ok(), entity_delete: ok(), datasource_delete: ok({ database: true }) })
    q('[data-connection-name]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settle()
    await typeInto(byLabel('Rename connection'), 'dummy')
    byLabel('Rename connection')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(inputs(actions, 'datasource_update')).toEqual([{ datasource: 'ds_quotes', name: 'dummy' }])
    await menuItem(byLabel('Connection actions'), 'Delete')
    expect(q('[data-confirm]')?.textContent).toContain('used by Quote')
    await click(qa('button').find(button => button.textContent?.trim() === 'Delete all') ?? null)
    expect(actions.calls.filter(call => call.name === 'entity_delete' || call.name === 'datasource_delete').map(call => [call.name, call.input])).toEqual([
      ['entity_delete', { entity: 'ent_quote' }],
      ['datasource_delete', { datasource: 'ds_quotes' }]
    ])
  })
})

describe('endpoints', () => {
  const toQuote = async (extra: Handlers = {}, routes: AppRoutes = {}) => {
    const mounted = await open(extra, routes)
    await click(collection('quotes'))
    return mounted
  }

  it('lists a REST collection\'s endpoints read-only, with the paging the adapter uses', async () => {
    await toQuote()
    expect(q('[data-endpoint="list"] [data-endpoint-method]')?.textContent).toBe('GET')
    const path = q('[data-endpoint="list"] input') as HTMLInputElement
    expect(path.value).toBe('/quotes')
    expect(path.readOnly).toBe(true)
    expect(text(q('[data-items-path]'))).toBe('quotes')
    expect(text(q('[data-paging-summary]'))).toBe('Offset (skip, limit)')
    expect(text(q('[data-total-path]'))).toBe('total')
    // No action changes an endpoint of a saved repository.
    expect(q('[data-endpoint-method] select, [aria-label="Add Endpoints property"], [data-id-path], [data-paging-detect]')).toBeNull()
  })

  it('tests the list endpoint with repository_endpoint_test and reads the mapping back', async () => {
    const { actions } = await toQuote({ repository_endpoint_test: () => ({ method: 'GET', path: '/quotes', status: 200, count: 30, items: quotes, fields: [], sample: {}, mapping: [{ field: 'id', remote: 'id', found: true }, { field: 'text', remote: 'quote', found: false }] }) })
    await click(q('[data-endpoint-test="list"]'))
    expect(inputs(actions, 'repository_endpoint_test')).toEqual([{ repository: 'repo_quote', op: 'list' }])
    expect(text(q('[data-endpoint-result]'))).toBe('200 · 30 items · not in the response: text')
    expect(q('[data-endpoint-result]')?.className).toContain('text-error')
  })

  it('says what a failed test said', async () => {
    await toQuote({ repository_endpoint_test: () => new Failure(502, 'upstream', 'Request failed with status 502') })
    await click(q('[data-endpoint-test="list"]'))
    expect(text(q('[data-endpoint-result]'))).toBe('Request failed with status 502')
  })

  it('does not test an endpoint that is not a GET, which could change the API\'s data', async () => {
    world.model.modules.blog!.repositories.find(repository => repository.id === 'repo_quote')!.operations = ['list', 'create']
    ;(world.model.modules.blog!.repositories.find(repository => repository.id === 'repo_quote')!.rest as Record<string, unknown>).create = { path: '/quotes/add' }
    const { actions } = await toQuote()
    expect(q('[data-endpoint="create"] [data-endpoint-method]')?.textContent).toBe('POST')
    const test = q('[data-endpoint-test="create"]')!
    expect(test.hasAttribute('disabled')).toBe(true)
    test.click()
    await settle()
    expect(actions.named('repository_endpoint_test')).toEqual([])
  })
})
