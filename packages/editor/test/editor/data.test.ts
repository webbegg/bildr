import { afterEach, describe, expect, it, vi } from 'vitest'
import { click, Failure, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import type { AppRoutes } from '../helpers.ts'
import DataView from '../../src/views/DataView.vue'
import App from '../../src/App.vue'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { baseHandlers, byLabel, indexPage, menuItem, selectOption, setupHarness, world } from '../design/harness.ts'
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
const open = async (extra: Handlers = {}, routes: AppRoutes = {}, path = '/data') => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...extra }, routes)
  const mounted = await mountWithApp(DataView, path)
  return { actions, ...mounted }
}

/** The fixture's index page shows the latest quotes, and a page that uses a collection keeps its connection. */
const freeQuotes = () => {
  indexPage().uses!.queries = indexPage().uses!.queries!.filter(use => use.query !== 'q_latest_quotes')
}

const inputs = (actions: Awaited<ReturnType<typeof open>>['actions'], name: string) => actions.named(name).map(call => call.input)
const collection = (plural: string) => q(`[data-collection="${plural}"]`)

/** The tree's items by name: `data-tree-item` is the item's key (`collection:<id>`, `connection:<id>`). */
const ITEMS = { post: 'collection:ent_post', quote: 'collection:ent_quote', quotes: 'connection:ds_quotes' }
const treeItem = (name: keyof typeof ITEMS) => q(`[data-tree-item="${ITEMS[name]}"]`)
const tabNames = () => qa('[role="tab"][data-data-tab]').map(tab => tab.getAttribute('data-data-tab'))
const activeTab = () => q('[role="tab"][aria-selected="true"]')?.getAttribute('data-data-tab')
const tab = (name: string) => q(`[role="tab"][data-data-tab="${name}"]`)
const key = async (element: Element | null, name: string) => {
  element!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  await settle()
}
const pressedSources = () => qa('[data-live-badge] button').filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.getAttribute('aria-label'))
const textButton = (label: string) => qa('button').find(candidate => candidate.textContent?.trim() === label) ?? null

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
    // The side panel is for an open row and for the collection's settings in Fields: Rows with none open has none.
    expect(q('[data-data-panel]')).toBeNull()
    await click(tab('fields'))
    expect(q('[data-data-panel] [data-collection-panel]')).not.toBeNull()
    expect(q('[data-data-panel]')?.style.width).toBe('320px')
  })

  it('shows the canvas insert tools only on the Canvas, not on the Data screen', async () => {
    await open()
    expect(q('[data-insert-button]')).toBeNull()
    expect(q('[data-insert-tool]')).toBeNull()
  })

  it('counts a collection\'s rows from its fixtures, and a REST collection\'s once they are read', async () => {
    await open()
    expect(text(collection('posts')?.querySelector('[data-collection-count]') ?? null)).toBe('2')
    expect(text(collection('quotes')?.querySelector('[data-collection-count]') ?? null)).toBe('')
  })

  it('shows a model with problems as the list of them, and links to the Model screen', async () => {
    const { actions, router } = await open({ model_get: () => ({ ok: false, problems: [{ path: '.bildr/modules/blog/entities/post.json', message: 'bad entity' }], files: {}, database: false }) })
    expect(q('[data-testid="data-problems"]')?.textContent).toContain('bad entity')
    expect(actions.named('model_get').length).toBeGreaterThan(0)
    expect(q('[data-records]')).toBeNull()
    expect(q('[data-testid="data-problems"]')?.textContent).not.toContain('(Model screen)')
    await click(q('[data-testid="open-model"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/model'))
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

  it('is reached from the Design screen\'s view menu, the only navigation', async () => {
    mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }) })
    const { router } = await mountWithApp(App, '/design')
    expect(q('nav')).toBeNull()
    await menuItem(q('[data-view-menu]'), 'Data')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    await settle()
    expect(q('[data-view-menu]')?.textContent?.trim()).toBe('Data')
    expect(q('[data-collections-internal]')).not.toBeNull()
  })
})

describe('the Data workspace (S2)', () => {
  /** Everything the screen says: its text, and the titles, labels and placeholders a user reads or hears (not the rows, which are the project's data). */
  const said = () => {
    const page = document.body.cloneNode(true) as HTMLElement
    for (const rows of page.querySelectorAll('[data-records-table]')) rows.remove()
    return [page.textContent ?? '', ...[...page.querySelectorAll('[title], [aria-label], [placeholder]')].flatMap(element => ['title', 'aria-label', 'placeholder'].map(name => element.getAttribute(name) ?? ''))].join(' | ')
  }

  it('has a tree with the sections Collections and Connections, and their items', async () => {
    await open()
    expect(text(q('[data-collections-internal]'))).toMatch(/^Collections\b/)
    expect(qa('[data-collections-internal] [data-collection]').map(item => item.getAttribute('data-collection'))).toEqual(['posts'])
    expect(text(q('[data-collections-synced]'))).toMatch(/^Connections\b/)
    expect(qa('[data-collections-synced] [data-connection-name]').map(item => text(item))).toEqual(['quotes'])
    expect(qa('[data-collections-synced] [data-collection]').map(item => item.getAttribute('data-collection'))).toEqual(['quotes'])
  })

  it('shows Rows, Fields, Endpoints and JSON for a collection, starting on Rows', async () => {
    await open()
    expect(q('[role="tablist"]')).not.toBeNull()
    expect(tabNames()).toEqual(['rows', 'fields', 'endpoints', 'json'])
    expect(qa('[role="tab"]').map(item => text(item))).toEqual(['Rows', 'Fields', 'Endpoints', 'JSON'])
    expect(activeTab()).toBe('rows')
    expect(q('[role="tabpanel"] [data-records]')).not.toBeNull()
  })

  it('shows Endpoints and JSON for a connection, starting on Endpoints', async () => {
    await open()
    await click(q('[data-connection-name]'))
    expect(tabNames()).toEqual(['endpoints', 'json'])
    expect(activeTab()).toBe('endpoints')
    expect(q('[data-connection-panel]')).not.toBeNull()
    expect(qa('[data-connection-endpoints] [data-endpoint="list"]')).toHaveLength(1)
    expect(q('[data-records]')).toBeNull()
  })

  it('switches the tab: Fields edits the fields, Endpoints lists them, JSON points to the raw model files', async () => {
    const { router } = await open()
    await click(tab('fields'))
    expect(activeTab()).toBe('fields')
    expect(q('[role="tabpanel"] [data-fields-tab]')).not.toBeNull()
    expect(q('[data-records]')).toBeNull()
    await click(tab('json'))
    expect(text(q('[data-data-json]'))).toContain('Edit this collection\'s file in Raw model files')
    expect(q('[data-data-json]')?.textContent).not.toContain('Coming in a later step')
    await click(tab('rows'))
    expect(q('[data-records]')).not.toBeNull()
    await click(tab('json'))
    await click(q('[data-data-json] a'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/model'))
  })

  it('says what the JSON tab of a connection edits', async () => {
    await open()
    await click(treeItem('quotes'))
    await click(tab('json'))
    expect(text(q('[data-data-json]'))).toContain('Edit this connection\'s file in Raw model files')
  })

  it('says what a collection with no endpoints is: its rows are not read through a connection', async () => {
    await open()
    await click(tab('endpoints'))
    expect(q('[data-endpoints-empty]')).not.toBeNull()
    await click(collection('quotes'))
    expect(q('[data-endpoints-empty]')).toBeNull()
    expect(q('[data-endpoint="list"]')).not.toBeNull()
  })

  it('puts the item and the tab in the URL query as they change', async () => {
    const { router } = await open()
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_post', tab: 'rows' })
    await click(tab('fields'))
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_post', tab: 'fields' })
    await click(collection('quotes'))
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_quote', tab: 'fields' })
    await click(q('[data-connection-name]'))
    expect(router.currentRoute.value.query).toEqual({ item: 'connection:ds_quotes', tab: 'endpoints' })
  })

  it('opens the item and the tab a deep link names', async () => {
    const { router } = await open({}, {}, '/data?item=collection:ent_quote&tab=fields')
    expect(activeTab()).toBe('fields')
    expect(text(q('[data-data-title] h2'))).toBe('Quote')
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_quote', tab: 'fields' })
  })

  it('restores a connection from a deep link', async () => {
    await open({}, {}, '/data?item=connection:ds_quotes&tab=json')
    expect(activeTab()).toBe('json')
    expect(q('[data-data-json]')).not.toBeNull()
    expect(tabNames()).toEqual(['endpoints', 'json'])
  })

  it('falls back to the first item, on Rows, for a deep link to one that is gone', async () => {
    const { router } = await open({}, {}, '/data?item=collection:ent_gone&tab=nope')
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_post', tab: 'rows' })
    expect(tabNames()).toEqual(['rows', 'fields', 'endpoints', 'json'])
    expect(text(q('[data-records]'))).toContain('Hello bildr')
  })

  it('follows the URL when it changes (Back and Forward)', async () => {
    const { router } = await open()
    await router.replace({ path: '/data', query: { item: 'collection:ent_quote', tab: 'endpoints' } })
    await settle()
    expect(activeTab()).toBe('endpoints')
    expect(q('[data-endpoint="list"]')).not.toBeNull()
  })

  it('moves through the tree with the arrow keys, stopping at the ends, and picks with Enter', async () => {
    await open()
    expect(qa('[data-tree-item]').map(item => item.getAttribute('data-tree-item'))).toEqual([ITEMS.post, ITEMS.quotes, ITEMS.quote])
    treeItem('post')!.focus()
    await key(treeItem('post'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('quotes'))
    await key(treeItem('quotes'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('quote'))
    await key(treeItem('quote'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('quote'))
    await key(treeItem('quote'), 'ArrowUp')
    expect(document.activeElement).toBe(treeItem('quotes'))
    await key(treeItem('quotes'), 'Enter')
    expect(q('[data-connection-panel]')).not.toBeNull()
    await key(treeItem('quote'), 'Home')
    expect(document.activeElement).toBe(treeItem('post'))
    await key(treeItem('post'), 'ArrowUp')
    expect(document.activeElement).toBe(treeItem('post'))
    await key(treeItem('post'), 'End')
    expect(document.activeElement).toBe(treeItem('quote'))
    await key(treeItem('post'), 'Enter')
    expect(q('[data-records]')).not.toBeNull()
  })

  it('is a tree with one tab stop that follows the focus', async () => {
    await open()
    expect(q('[data-data-tree]')?.getAttribute('role')).toBe('tree')
    expect(qa('[data-tree-item]').every(item => item.getAttribute('role') === 'treeitem')).toBe(true)
    const stops = () => qa('[data-tree-item][tabindex="0"]').map(item => item.getAttribute('data-tree-item'))
    // With nothing focused yet, the stop is the item shown.
    expect(stops()).toEqual([ITEMS.post])
    expect(treeItem('post')?.getAttribute('aria-selected')).toBe('true')
    expect(treeItem('quotes')?.getAttribute('aria-selected')).toBe('false')
    treeItem('post')!.focus()
    await key(treeItem('post'), 'ArrowDown')
    expect(stops()).toEqual([ITEMS.quotes])
    await click(treeItem('quote'))
    expect(stops()).toEqual([ITEMS.quote])
  })

  it('collapses and expands a connection with ArrowLeft and ArrowRight, and ArrowLeft on its collection goes to it', async () => {
    await open()
    const connection = () => treeItem('quotes')
    expect(connection()?.getAttribute('aria-expanded')).toBe('true')
    treeItem('quote')!.focus()
    await key(treeItem('quote'), 'ArrowLeft')
    expect(document.activeElement).toBe(connection())
    await key(connection(), 'ArrowLeft')
    expect(connection()?.getAttribute('aria-expanded')).toBe('false')
    expect(treeItem('quote')).toBeNull()
    // The tree stays reachable: the stop is an item that is there.
    expect(qa('[data-tree-item][tabindex="0"]')).toHaveLength(1)
    await key(connection(), 'ArrowRight')
    expect(connection()?.getAttribute('aria-expanded')).toBe('true')
    expect(treeItem('quote')).not.toBeNull()
    // Right on an expanded connection goes to its first collection; a collection has nothing to expand.
    await key(connection(), 'ArrowRight')
    expect(document.activeElement).toBe(treeItem('quote'))
    await key(treeItem('quote'), 'ArrowRight')
    expect(document.activeElement).toBe(treeItem('quote'))
  })

  it('keeps a tab stop in the tree when the connection folding the selected collection is collapsed', async () => {
    await open()
    await click(treeItem('quote'))
    await click(q('[data-connection-toggle]'))
    expect(treeItem('quote')).toBeNull()
    expect(qa('[data-tree-item][tabindex="0"]')).toHaveLength(1)
  })

  it('reaches the tab strip by keyboard: one tab stop, the arrows move and pick', async () => {
    await open()
    expect(qa('[role="tab"]').map(item => item.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1'])
    tab('rows')!.focus()
    await key(tab('rows'), 'ArrowRight')
    expect(document.activeElement).toBe(tab('fields'))
    expect(activeTab()).toBe('fields')
    await key(tab('fields'), 'End')
    expect(activeTab()).toBe('json')
    await key(tab('json'), 'ArrowRight')
    expect(activeTab()).toBe('rows')
    await key(tab('rows'), 'ArrowLeft')
    expect(activeTab()).toBe('json')
  })

  it('has one name per concept: Collection, Connection and Sample data, never Synced, fixtures, data source or entity', async () => {
    freeQuotes()
    await open()
    const unwanted = /synced|fixtures?\b|data source|entit(y|ies)/i
    const cancel = () => click(textButton('Cancel'))
    // Each step brings a screen, a dialog or a confirmation up; what the user reads on it is checked.
    const steps: Array<() => Promise<unknown>> = [
      async () => {},
      ...['fields', 'endpoints', 'json', 'rows'].map(name => () => click(tab(name))),
      () => menuItem(byLabel('Collection actions'), 'Delete'),
      () => click(q('[data-confirm-cancel]')),
      () => click(collection('quotes')),
      ...['rows', 'fields', 'endpoints'].map(name => () => click(tab(name))),
      () => click(treeItem('quotes')),
      () => click(q('[data-connection-add-collection]')),
      cancel,
      () => menuItem(byLabel('Add connection'), 'Import from URL'),
      cancel,
      () => menuItem(byLabel('Connection actions'), 'Delete'),
      () => click(q('[data-confirm-cancel]'))
    ]
    for (const [index, step] of steps.entries()) {
      await step()
      expect(said(), `after step ${index}`).not.toMatch(unwanted)
    }
    expect(byLabel('Add connection')).not.toBeNull()
  })

  it('says what is empty in each section', async () => {
    world.model.modules.blog!.entities = []
    world.model.modules.blog!.repositories = []
    world.model.datasources = world.model.datasources.filter(source => source.kind !== 'rest')
    await open()
    expect(q('[data-data-empty]')).not.toBeNull()
    expect(text(q('[data-collections-internal]'))).toContain('No collections yet')
    expect(text(q('[data-collections-synced]'))).toContain('No connections yet')
    expect(q('[role="tablist"]')).toBeNull()
  })

  it('starts empty when only a connection exists, and says its endpoints are none until a collection reads through it', async () => {
    world.model.modules.blog!.entities = []
    world.model.modules.blog!.repositories = []
    await open()
    expect(q('[data-data-empty]')).not.toBeNull()
    expect(tabNames()).toEqual([])
    await click(q('[data-connection-name]'))
    expect(tabNames()).toEqual(['endpoints', 'json'])
    expect(q('[data-data-empty]')).toBeNull()
    expect(text(q('[data-connection-endpoints-empty]'))).toContain('No collection reads through this connection yet')
  })

  it('labels the rows source switch Live / Sample data, and shows the sample data on Sample data', async () => {
    await open({}, { '/api/blog/posts': { items: [post('one'), post('two'), post('draft')], total: 3 } })
    expect(qa('[data-live-badge] button').map(button => button.getAttribute('aria-label'))).toEqual(['Live', 'Sample data'])
    expect(pressedSources()).toEqual(['Live'])
    expect(q('[data-live-badge]')?.getAttribute('data-source')).toBe('live')
    expect(q('[data-source-note]')).toBeNull()
    expect(qa('[data-record]')).toHaveLength(3)
    await click(byLabel('Sample data', q('[data-live-badge]')!))
    expect(pressedSources()).toEqual(['Sample data'])
    expect(q('[data-live-badge]')?.getAttribute('data-source')).toBe('sample')
    expect(qa('[data-record]')).toHaveLength(2)
    expect(q('[data-records-error]')).toBeNull()
    await click(byLabel('Live', q('[data-live-badge]')!))
    expect(pressedSources()).toEqual(['Live'])
    expect(qa('[data-record]')).toHaveLength(3)
  })

  it('keeps Live as the choice when the app does not answer, and says in a note that the rows are sample data', async () => {
    await open()
    expect(pressedSources()).toEqual(['Live'])
    expect(q('[data-live-badge]')?.getAttribute('data-source')).toBe('sample')
    expect(text(q('[data-source-note]'))).toBe('App not answering — showing sample data')
    expect(qa('[data-record]')).toHaveLength(2)
    await click(byLabel('Sample data', q('[data-live-badge]')!))
    expect(pressedSources()).toEqual(['Sample data'])
    expect(q('[data-source-note]')).toBeNull()
  })

  it('picks the app up again when Live is chosen after it came back', async () => {
    let down = true
    await open({}, { '/api/blog/posts': () => down ? new Failure(503, 'down', 'down') : { items: [post('one'), post('two'), post('draft')], total: 3 } })
    expect(pressedSources()).toEqual(['Live'])
    expect(q('[data-source-note]')).not.toBeNull()
    down = false
    // Choosing Live while Live is chosen is a retry.
    await click(byLabel('Live', q('[data-live-badge]')!))
    expect(q('[data-live-badge]')?.getAttribute('data-source')).toBe('live')
    expect(q('[data-source-note]')).toBeNull()
    expect(pressedSources()).toEqual(['Live'])
    expect(qa('[data-record]')).toHaveLength(3)
  })

  it('counts what the shown source has in the tree', async () => {
    await open({}, { '/api/blog/posts': { items: [post('one'), post('two'), post('draft')], total: 3 } })
    const count = () => text(collection('posts')?.querySelector('[data-collection-count]') ?? null)
    expect(count()).toBe('3')
    await click(byLabel('Sample data', q('[data-live-badge]')!))
    expect(count()).toBe('2')
    await click(byLabel('Live', q('[data-live-badge]')!))
    expect(count()).toBe('3')
  })

  it('closes an open row when the source is switched', async () => {
    await open({}, { '/api/blog/posts': { items: [post('one'), post('two'), post('draft')], total: 3 } })
    await click(q('[data-record]'))
    expect(q('[data-record-panel]')).not.toBeNull()
    await click(byLabel('Sample data', q('[data-live-badge]')!))
    expect(q('[data-record-panel]')).toBeNull()
    await click(q('[data-record]'))
    expect(q('[data-record-panel]')).not.toBeNull()
    await click(byLabel('Live', q('[data-live-badge]')!))
    expect(q('[data-record-panel]')).toBeNull()
  })

  it('speaks about sample data, not the app\'s data, when there is none to show', async () => {
    world.model.modules.blog!.fixtures = []
    await open({}, { '/api/blog/posts': { items: [], total: 0 } })
    expect(text(q('[data-records-empty]'))).toContain('app\'s data')
    await click(byLabel('Sample data', q('[data-live-badge]')!))
    expect(text(q('[data-records-empty]'))).toBe('No sample data yet for this collection.')
  })

  it('says the app is not answering, and there is no sample data, when Live is chosen and neither shows rows', async () => {
    world.model.modules.blog!.fixtures = []
    await open()
    expect(text(q('[data-records-empty]'))).toContain('sample data')
    expect(text(q('[data-records-empty]'))).not.toContain('app\'s data')
    expect(pressedSources()).toEqual(['Live'])
  })
})

describe('the Data location (S2)', () => {
  const removeEntity = (id: string) => {
    const mod = world.model.modules.blog!
    mod.entities = mod.entities.filter(entity => entity.id !== id)
    mod.repositories = mod.repositories.filter(repository => repository.entity !== id)
  }

  it('replaces the history entry when an item or a tab is chosen, so Back leaves the Data screen', async () => {
    const { router } = await open()
    const push = vi.spyOn(router.options.history, 'push')
    const replace = vi.spyOn(router.options.history, 'replace')
    await click(tab('fields'))
    await click(collection('quotes'))
    await click(treeItem('quotes'))
    await click(treeItem('post'))
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.post, tab: 'fields' })
    expect(replace).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('falls back to the first collection, and rewrites the URL, when the selected one is deleted', async () => {
    const { router } = await open({ entity_delete: () => {
      removeEntity('ent_quote')
      return { changed: [] }
    } })
    await click(tab('fields'))
    await click(treeItem('quote'))
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.quote, tab: 'fields' })
    await menuItem(collection('quotes')!.parentElement!.querySelector('[aria-label="Collection actions"]'), 'Delete')
    await click(textButton('Delete collection'))
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.post, tab: 'fields' })
    expect(text(q('[data-data-title] h2'))).toBe('Post')
    expect(treeItem('quote')).toBeNull()
  })

  it('falls back to the first collection, and rewrites the URL, when the selected connection is deleted', async () => {
    freeQuotes()
    const { router } = await open({
      entity_delete: () => {
        removeEntity('ent_quote')
        return { changed: [] }
      },
      datasource_delete: () => {
        world.model.datasources = world.model.datasources.filter(source => source.id !== 'ds_quotes')
        return { changed: [], database: true }
      }
    })
    await click(treeItem('quotes'))
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.quotes, tab: 'endpoints' })
    await menuItem(byLabel('Connection actions'), 'Delete')
    await click(textButton('Delete all'))
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.post, tab: 'rows' })
    expect(text(q('[data-data-title] h2'))).toBe('Post')
    expect(q('[data-connection-panel]')).toBeNull()
    expect(treeItem('quotes')).toBeNull()
  })

  it('keeps the id of the selected item in the URL when it is renamed', async () => {
    const { router } = await open({
      entity_update: (input) => {
        world.model.modules.blog!.entities.find(entity => entity.id === input.entity)!.name = input.name as string
        return { changed: [] }
      },
      datasource_update: (input) => {
        world.model.datasources.find(source => source.id === input.datasource)!.name = input.name as string
        return { changed: [] }
      }
    })
    const rename = async (item: Element | null, label: string, name: string) => {
      item!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await settle()
      await typeInto(byLabel(label), name)
      byLabel(label)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle()
    }
    await rename(treeItem('post'), 'Rename collection', 'Article')
    expect(text(q('[data-data-title] h2'))).toBe('Article')
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.post, tab: 'rows' })
    await click(treeItem('quotes'))
    await rename(treeItem('quotes'), 'Rename connection', 'dummy')
    expect(text(q('[data-data-title] h2'))).toBe('dummy')
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.quotes, tab: 'endpoints' })
  })

  it('falls back to the first collection for a deep link to a connection that is gone', async () => {
    const { router } = await open({}, {}, '/data?item=connection:ds_gone')
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.post, tab: 'rows' })
    expect(text(q('[data-data-title] h2'))).toBe('Post')
    expect(q('[data-connection-panel]')).toBeNull()
  })

  it('settles on Endpoints for a connection asked for on a tab it does not have', async () => {
    const { router } = await open({}, {}, '/data?item=connection:ds_quotes&tab=fields')
    expect(activeTab()).toBe('endpoints')
    expect(router.currentRoute.value.query).toEqual({ item: ITEMS.quotes, tab: 'endpoints' })
  })

  it('shows a collection made while a connection is selected, and rewrites the URL', async () => {
    const { router } = await open({
      entity_create: () => {
        const mod = world.model.modules.blog!
        mod.entities.push({ ...structuredClone(mod.entities.find(entity => entity.id === 'ent_post')!), id: 'ent_menu', name: 'Menu', plural: 'menus' })
        return { entityId: 'ent_menu', changed: [] }
      }
    })
    await click(treeItem('quotes'))
    expect(router.currentRoute.value.query.item).toBe(ITEMS.quotes)
    await click(q('[aria-label="Add collection"]'))
    await typeInto(q('[aria-label="New collection name"]'), 'Menu')
    q('[aria-label="New collection name"]')!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_menu', tab: 'rows' })
    expect(text(q('[data-data-title] h2'))).toBe('Menu')
  })
})

describe('the rows table', () => {
  it('shows the entity\'s sample data as read-only rows, on the Sample data side of the switch, with why the app\'s rows are not shown', async () => {
    await open()
    expect(qa('[data-records-header]').map(header => text(header))).toEqual(['Title', 'Slug', 'Body', 'Published', 'Published at'])
    expect(qa('[data-record]')).toHaveLength(2)
    expect(text(q('[data-record] [data-cell="0-0"]'))).toBe('Hello bildr')
    expect(q('[data-live-badge]')?.getAttribute('data-source')).toBe('sample')
    expect(text(q('[data-records-error]'))).toContain('Showing the sample data.')
    expect(text(q('[data-records-error]'))).toContain('The app\'s list route for posts could not be reached.')
    expect(text(q('[data-records-count]'))).toBe('2 items')
    // A boolean is shown, not a control: nothing in a cell looks clickable.
    expect(qa('[data-record] [data-cell-bool]').map(cell => cell.getAttribute('data-cell-bool'))).toEqual(['true', 'false'])
    expect(q('[data-record] [role="switch"], [data-cell-bool] button, [data-record] input')).toBeNull()
    // Read-only: no add row, no cell editors, no bulk delete.
    expect(q('[data-add-row], [data-cell-input], [data-records-add], [data-records-delete]')).toBeNull()
  })

  it('shows the app\'s rows when its list route answers', async () => {
    await open({}, { '/api/blog/posts': { items: [post('one'), post('two'), post('draft')], total: 3 } })
    expect(q('[data-live-badge]')?.getAttribute('data-source')).toBe('live')
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
    expect(q('[data-data-panel]')).toBeNull()
  })

  it('shows a REST collection as Live only, with the reason the app\'s rows could not be read', async () => {
    await open()
    await click(collection('quotes'))
    expect(text(q('[data-live-badge]'))).toBe('Live')
    expect(q('[data-live-badge] button')).toBeNull()
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
    expect(text(q('[data-confirm-description]'))).toContain('The collection goes with its repository')
    await click(textButton('Delete collection'))
    expect(inputs(actions, 'entity_delete')).toEqual([{ entity: 'ent_post' }])
  })

  it('keeps a collection a page still uses, and says so', async () => {
    await open({ entity_delete: () => new Failure(422, 'invalid', 'Entity Post is still used by pg_index (uses). Change them first') })
    await menuItem(byLabel('Collection actions'), 'Delete')
    await click(textButton('Delete collection'))
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
  const fieldsTab = async () => click(tab('fields'))
  const row = (name: string) => q(`[data-fields-tab] [data-field="${name}"]`)!

  it('lists the fields of the shown collection with their types', async () => {
    await open()
    await fieldsTab()
    expect(text(q('[data-data-title] h2'))).toBe('Post')
    expect(text(q('[data-fields-title]'))).toBe('5 fields')
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
    await click(textButton('Remove field'))
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

describe('the collection panel (beside the Fields tab)', () => {
  /** The panel is the Fields tab's side: the Rows tab has none. */
  const openFields = async (extra: Handlers = {}) => {
    const mounted = await open(extra)
    await click(tab('fields'))
    return mounted
  }

  it('edits the name, the plural and whether the app serves the list: each one entity_update', async () => {
    const { actions } = await openFields({ entity_update: ok() })
    const panel = q('[data-collection-panel]')!
    await typeInto(panel.querySelector('[aria-label="Collection name"]'), 'Article')
    await click(panel.querySelector('[data-flag="expose"]'))
    expect(inputs(actions, 'entity_update')).toEqual([{ entity: 'ent_post', name: 'Article' }, { entity: 'ent_post', expose: false }])
  })

  it('shows what stores it and its create action, next to the fields', async () => {
    await openFields()
    expect(text(q('[data-stored-in]'))).toBe('main (sqlite)')
    expect(text(q('[data-create-action]'))).toBe('act_create_post')
    expect(q('[data-fields-tab]')).not.toBeNull()
    expect(q('[data-show-fields]')).toBeNull()
  })

  it('opens the detail page of a collection on the Canvas', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await openFields()
      expect(text(q('[data-open-detail-page]'))).toBe('posts-slug')
      await click(q('[data-open-detail-page="pg_post_detail"]'))
      expect(opened).toHaveBeenCalledWith('design')
    } finally {
      off()
    }
  })

  it('says how to make a detail page for a collection with none, instead of offering to create one', async () => {
    await openFields()
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
    freeQuotes()
    const { actions } = await open({ datasource_update: ok(), entity_delete: ok(), datasource_delete: ok({ database: true }) })
    q('[data-connection-name]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settle()
    await typeInto(byLabel('Rename connection'), 'dummy')
    byLabel('Rename connection')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(inputs(actions, 'datasource_update')).toEqual([{ datasource: 'ds_quotes', name: 'dummy' }])
    await menuItem(byLabel('Connection actions'), 'Delete')
    expect(q('[data-confirm]')?.textContent).toContain('used by Quote')
    await click(textButton('Delete all'))
    expect(actions.calls.filter(call => call.name === 'entity_delete' || call.name === 'datasource_delete').map(call => [call.name, call.input])).toEqual([
      ['entity_delete', { entity: 'ent_quote' }],
      ['datasource_delete', { datasource: 'ds_quotes' }]
    ])
  })
})

describe('deleting a connection', () => {
  const deleteConnection = async () => menuItem(byLabel('Connection actions'), 'Delete')
  const deleteAll = () => click(textButton('Delete all'))
  /** A second collection over the same connection. */
  const addSecondCollection = () => {
    const mod = world.model.modules.blog!
    const entity = structuredClone(mod.entities.find(entry => entry.id === 'ent_quote')!)
    const repository = structuredClone(mod.repositories.find(entry => entry.id === 'repo_quote')!)
    Object.assign(entity, { id: 'ent_note', name: 'Note', plural: 'notes' })
    entity.fields.forEach((field, index) => Object.assign(field, { id: `fld_n_${index}` }))
    Object.assign(repository, { id: 'repo_note', entity: 'ent_note' })
    mod.entities.push(entity)
    mod.repositories.push(repository)
  }

  it('refuses up front, naming the pages, when a page uses one of its collections: nothing is deleted', async () => {
    // The fixture's index page shows the latest quotes.
    expect(indexPage().uses!.queries!.some(use => use.query === 'q_latest_quotes')).toBe(true)
    const { actions } = await open({ entity_delete: ok(), datasource_delete: ok() })
    await deleteConnection()
    expect(q('[data-confirm]')).toBeNull()
    expect(q('[data-testid="design-error"]')?.textContent).toContain('"index"')
    expect(q('[data-testid="design-error"]')?.textContent).toContain('Quote')
    expect(actions.calls.filter(call => call.name === 'entity_delete' || call.name === 'datasource_delete')).toEqual([])
  })

  it('stops at the second collection the module refuses, and keeps the connection', async () => {
    freeQuotes()
    addSecondCollection()
    const { actions } = await open({
      entity_delete: input => input.entity === 'ent_note' ? new Failure(422, 'invalid', 'Entity Note is still used by cmp_x (properties). Change them first') : ok()(),
      datasource_delete: ok({ database: true })
    })
    await deleteConnection()
    await deleteAll()
    expect(actions.calls.filter(call => call.name === 'entity_delete' || call.name === 'datasource_delete').map(call => [call.name, call.input])).toEqual([
      ['entity_delete', { entity: 'ent_quote' }],
      ['entity_delete', { entity: 'ent_note' }]
    ])
    expect(q('[data-testid="design-error"]')?.textContent).toContain('Entity Note is still used by')
  })
})

describe('endpoints', () => {
  const toQuote = async (extra: Handlers = {}, routes: AppRoutes = {}) => {
    const mounted = await open(extra, routes)
    await click(collection('quotes'))
    await click(tab('endpoints'))
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
