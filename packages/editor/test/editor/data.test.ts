import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, Failure, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import type { AppRoutes } from '../helpers.ts'
import DataView from '../../src/views/DataView.vue'
import App from '../../src/App.vue'
import { usesOf } from '@bildr/codegen/edit'
import { describeUses } from '../../../codegen/src/edit/usage.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { FakeEventSource, baseHandlers, byLabel, combo, indexPage, inputOf, menuItem, modelGet, selectOption, setupHarness, world } from '../design/harness.ts'
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
const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
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
const ITEMS = {
  post: 'collection:ent_post',
  quote: 'collection:ent_quote',
  quotes: 'connection:ds_quotes',
  allPosts: 'query:q_all_posts',
  featured: 'query:q_featured_posts',
  latestQuotes: 'query:q_latest_quotes',
  bySlug: 'query:q_post_by_slug',
  createPost: 'action:act_create_post',
  publishPost: 'action:act_publish_post',
  files: 'files'
}
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

  it('shows a model with problems as the list of them, and links to All model files', async () => {
    const { actions, router } = await open({ model_get: () => ({ ok: false, problems: [{ path: '.bildr/modules/blog/entities/post.json', message: 'bad entity' }], files: {}, database: false }) })
    expect(q('[data-testid="data-problems"]')?.textContent).toContain('bad entity')
    expect(actions.named('model_get').length).toBeGreaterThan(0)
    expect(q('[data-records]')).toBeNull()
    expect(q('[data-testid="data-problems"]')?.textContent).not.toContain('(Model screen)')
    await click(q('[data-testid="open-model"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'files' }))
    expect(router.currentRoute.value.path).toBe('/data')
  })

  it('links to All model files at the bottom of the tree', async () => {
    const { router } = await open()
    await click(q('[data-raw-model]'))
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'files' }))
    expect(router.currentRoute.value.path).toBe('/data')
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
    // The rows, and the paths of the files, are the project's own: they are not the screen's words.
    for (const own of page.querySelectorAll('[data-records-table], [data-file-path]')) own.remove()
    // The files' buttons carry their path as the title.
    for (const own of page.querySelectorAll('[data-file], [data-file-switch]')) own.removeAttribute('title')
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

  it('switches the tab: Fields edits the fields, Endpoints lists them, JSON edits the file', async () => {
    await open()
    await click(tab('fields'))
    expect(activeTab()).toBe('fields')
    expect(q('[role="tabpanel"] [data-fields-tab]')).not.toBeNull()
    expect(q('[data-records]')).toBeNull()
    await click(tab('json'))
    expect(q('[data-data-json] [data-testid="raw-content"]')).not.toBeNull()
    expect(q('[data-data-json]')?.textContent).not.toContain('Coming in a later step')
    expect(q('[data-data-json]')?.textContent).not.toContain('Raw model files')
    await click(tab('rows'))
    expect(q('[data-records]')).not.toBeNull()
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
    expect(qa('[data-tree-item]').map(item => item.getAttribute('data-tree-item'))).toEqual([ITEMS.post, ITEMS.quotes, ITEMS.quote, ITEMS.allPosts, ITEMS.featured, ITEMS.latestQuotes, ITEMS.bySlug, ITEMS.createPost, ITEMS.publishPost, ITEMS.files])
    treeItem('post')!.focus()
    await key(treeItem('post'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('quotes'))
    await key(treeItem('quotes'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('quote'))
    // The queries and the actions are in the same group: the arrows go on into them, and out of them to All model files.
    await key(treeItem('quote'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('allPosts'))
    await key(treeItem('allPosts'), 'End')
    expect(document.activeElement).toBe(treeItem('files'))
    await key(treeItem('files'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('files'))
    await key(treeItem('files'), 'ArrowUp')
    expect(document.activeElement).toBe(treeItem('publishPost'))
    await key(treeItem('publishPost'), 'ArrowUp')
    expect(document.activeElement).toBe(treeItem('createPost'))
    await key(treeItem('createPost'), 'ArrowUp')
    expect(document.activeElement).toBe(treeItem('bySlug'))
    await key(treeItem('bySlug'), 'Home')
    expect(document.activeElement).toBe(treeItem('post'))
    await key(treeItem('post'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('quotes'))
    await key(treeItem('quotes'), 'Enter')
    expect(q('[data-connection-panel]')).not.toBeNull()
    await key(treeItem('quote'), 'Home')
    expect(document.activeElement).toBe(treeItem('post'))
    await key(treeItem('post'), 'ArrowUp')
    expect(document.activeElement).toBe(treeItem('post'))
    await key(treeItem('post'), 'End')
    expect(document.activeElement).toBe(treeItem('files'))
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
      () => click(q('[data-confirm-cancel]')),
      // Queries and actions: each tab of each kind, and each dialog.
      () => click(treeItem('featured')),
      ...['definition', 'used', 'json', 'results'].map(name => () => click(tab(name))),
      () => click(treeItem('createPost')),
      ...['used', 'json', 'overview'].map(name => () => click(tab(name))),
      () => click(byLabel('New query')),
      cancel,
      () => click(byLabel('New action')),
      cancel,
      () => menuItem(q('[data-artifact-menu="q_featured_posts"]'), 'Rename'),
      cancel,
      () => menuItem(q('[data-artifact-menu="q_all_posts"]'), 'Delete'),
      cancel
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

/**
 * S3: the JSON tab edits the file of the item shown, and "All model files" lists every `.bildr/` file; both with the one
 * raw editor (`model_file_put` / `model_file_delete`), whose problems are shown inline. The module serves the files back, so
 * a put here keeps what was saved, as the module does.
 */
describe('the JSON tab and All model files (S3)', () => {
  const POST = '.bildr/modules/blog/entities/post.json'
  const POST_REPOSITORY = '.bildr/modules/blog/repositories/post.json'
  const POST_FIXTURES = '.bildr/modules/blog/fixtures/post.json'
  const QUOTES = '.bildr/datasources/quotes.json'
  const INDEX_PAGE = '.bildr/modules/blog/pages/index.json'
  const LAYOUT = '.bildr/layouts/main.json'
  const rawText = () => {
    const element = q('[data-testid="raw-content"]')
    return (element?.matches('textarea') ? element : element?.querySelector('textarea')) as HTMLTextAreaElement | null
  }
  type FileJson = Record<string, unknown> & { fields: Array<Record<string, unknown>> }
  const shownFile = () => JSON.parse(rawText()!.value) as FileJson
  const saved = (() => {
    let files: Record<string, unknown> = {}
    return { reset: () => (files = {}), files: () => files }
  })()
  // What one test saved is not on another's disk.
  beforeEach(() => saved.reset())
  /** The file as the module first returns it (what an edit of it starts from, and what the module sees as the base). */
  const original = (path: string) => structuredClone(modelGet().files[path as keyof ReturnType<typeof modelGet>['files']])
  /** A module that keeps what is put: the next `model_get` returns the file as saved (and `edit` runs for the model's own change). */
  const keeping = (edit: (path: string, content: FileJson) => void = () => {}, extra: Handlers = {}): Handlers => ({
    model_get: () => ({ ...modelGet(), files: { ...modelGet().files, ...saved.files() } }),
    model_file_put: (input) => {
      saved.files()[input.path as string] = input.content
      edit(input.path as string, input.content as FileJson)
      return { sha256: 'a'.repeat(64) }
    },
    ...extra
  })
  const addField = (_path: string, content: FileJson) => {
    world.model.modules.blog!.entities.find(entity => entity.id === 'ent_post')!.fields.push(content.fields.at(-1) as never)
  }
  const withExtraField = () => {
    const file = shownFile()
    file.fields.push({ id: 'fld_extra', name: 'extra', type: 'text' })
    return file
  }
  const json = async (extra: Handlers = {}, path = '/data') => {
    saved.reset()
    const mounted = await open({ ...keeping(addField), ...extra }, {}, path)
    await click(tab('json'))
    return mounted
  }
  const group = (kind: string) => q(`[data-files-group="${kind}"]`)
  const fileButton = (path: string) => q(`[data-file="${path}"]`)

  describe('the JSON tab', () => {
    it('shows the collection\'s own file in the raw editor: its path, no path to type, and no delete', async () => {
      await json()
      expect(text(q('[data-data-json] [data-file-path]'))).toBe(POST)
      expect(shownFile()).toMatchObject({ id: 'ent_post', name: 'Post' })
      expect(q('[data-testid="raw-path"]')).toBeNull()
      expect(q('[data-testid="raw-delete"]')).toBeNull()
      expect(q('[data-data-json] [data-open-in-code]')?.getAttribute('href')).toBe(`/code?path=${POST}`)
    })

    it('saves the edit to the file, and Fields shows the change', async () => {
      const { actions } = await json()
      const edited = withExtraField()
      await typeInto(q('[data-testid="raw-content"]'), JSON.stringify(edited))
      const reads = actions.named('model_get').length
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put')).toEqual([{ path: POST, content: edited, base: original(POST) }])
      expect(text(q('[data-data-json]'))).toContain('Saved.')
      expect(actions.named('model_get').length).toBeGreaterThan(reads)
      await click(tab('fields'))
      expect(byLabel('Type of extra')).not.toBeNull()
      // The file is read back as the module saved it.
      await click(tab('json'))
      expect(shownFile().fields.map(field => field.name)).toContain('extra')
    })

    it('shows the problems of a refused save inline, keeps the text, and changes nothing', async () => {
      const problems = [{ path: POST, message: 'Unknown entity "ent_missing" in relations' }]
      const { actions } = await json({ model_file_put: () => new Failure(422, 'invalid', 'The model would have problems, .bildr/modules/blog/entities/post.json was not saved', problems) })
      const edited = withExtraField()
      await typeInto(q('[data-testid="raw-content"]'), JSON.stringify(edited))
      const reads = actions.named('model_get').length
      await click(q('[data-testid="raw-save"]'))
      expect(text(q('[data-data-json]'))).toContain('was not saved')
      expect(text(q('[data-data-json]'))).toContain('Unknown entity "ent_missing" in relations')
      expect(JSON.parse(rawText()!.value)).toEqual(edited)
      expect(actions.named('model_get')).toHaveLength(reads)
      await click(tab('fields'))
      expect(byLabel('Type of extra')).toBeNull()
    })

    it('says text that is not JSON is not, keeps it, and asks the module nothing', async () => {
      const { actions } = await json()
      await typeInto(q('[data-testid="raw-content"]'), '{ "id": ')
      await click(q('[data-testid="raw-save"]'))
      expect(text(q('[data-data-json]'))).toContain('Invalid JSON')
      expect(rawText()!.value).toBe('{ "id": ')
      expect(actions.named('model_file_put')).toEqual([])
    })

    it('shows the file as it is when the model changes elsewhere, and leaves what is being typed alone', async () => {
      const { actions } = await json()
      const changed = { ...shownFile(), plural: 'articles' }
      const change = async () => {
        saved.files()[POST] = changed
        FakeEventSource.instances.at(-1)!.send({ type: 'model', version: 9, files: [POST], source: 'disk' })
        await settle()
      }
      const reads = actions.named('model_get').length
      await change()
      expect(actions.named('model_get').length).toBeGreaterThan(reads)
      expect(shownFile().plural).toBe('articles')
      expect(q('[data-file-changed]')).toBeNull()
      await typeInto(q('[data-testid="raw-content"]'), '{ "draft": true }')
      saved.files()[POST] = { ...changed, plural: 'notes' }
      FakeEventSource.instances.at(-1)!.send({ type: 'model', version: 10, files: [POST], source: 'disk' })
      await settle()
      expect(rawText()!.value).toBe('{ "draft": true }')
    })

    it('reads the model once more, not twice, after a save: the files and the editor\'s model share the read', async () => {
      const { actions } = await json()
      await typeInto(q('[data-testid="raw-content"]'), JSON.stringify(withExtraField()))
      const reads = actions.named('model_get').length
      await click(q('[data-testid="raw-save"]'))
      // The editor reads its model once and the files once: the files' own watch on the model does not read a third time.
      expect(actions.named('model_get').length - reads).toBe(2)
    })

    it('shows a parse error with its line and column', async () => {
      await json()
      await typeInto(q('[data-testid="raw-content"]'), '{\n  "id": 1,\n  "name" 2\n}')
      await click(q('[data-testid="raw-save"]'))
      expect(text(q('[data-data-json]'))).toMatch(/Invalid JSON.*line 3, column 10/)
    })

    it('has an editor as tall as the window allows, not a fixed number of rows', async () => {
      await json()
      expect(rawText()!.getAttribute('rows')).not.toBe('18')
      expect(rawText()!.className).toMatch(/h-\[/)
    })

    it('has a switcher for the files the collection is linked to, its own first, one at a time', async () => {
      // The module keeps what it is given, whatever the file is.
      const { actions } = await json(keeping())
      const labels = () => qa('[data-file-switcher] button').map(button => text(button))
      expect(labels().slice(0, 3)).toEqual(['Collection', 'Repository', 'Sample data'])
      expect(labels().slice(3).every(label => label.startsWith('Query '))).toBe(true)
      expect(labels().length).toBeGreaterThan(3)
      expect(q('[data-file-switcher] [aria-pressed="true"]')?.textContent?.trim()).toBe('Collection')
      await click(qa('[data-file-switcher] button').find(button => text(button) === 'Repository')!)
      expect(text(q('[data-file-path]'))).toBe(POST_REPOSITORY)
      expect(qa('[data-file-path]')).toHaveLength(1)
      expect(shownFile()).toMatchObject({ id: 'repo_post', entity: 'ent_post' })
      expect(q('[data-file-switcher] [aria-pressed="true"]')?.textContent?.trim()).toBe('Repository')
      await typeInto(q('[data-testid="raw-content"]'), JSON.stringify({ ...shownFile(), table: 'blog_articles' }))
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put').map(input => input.path)).toEqual([POST_REPOSITORY])
      await click(qa('[data-file-switcher] button').find(button => text(button) === 'Sample data')!)
      expect(text(q('[data-file-path]'))).toBe(POST_FIXTURES)
      expect(shownFile().entity).toBe('ent_post')
    })

    it('starts each collection on its own file', async () => {
      await json()
      await click(qa('[data-file-switcher] button').find(button => text(button) === 'Repository')!)
      await click(treeItem('quote'))
      expect(text(q('[data-file-path]'))).toBe('.bildr/modules/blog/entities/quote.json')
      expect(q('[data-file-switcher] [aria-pressed="true"]')?.textContent?.trim()).toBe('Collection')
    })

    it('edits a connection\'s own file, with nothing to switch to', async () => {
      const { actions } = await json()
      await click(treeItem('quotes'))
      expect(activeTab()).toBe('json')
      expect(text(q('[data-file-path]'))).toBe(QUOTES)
      expect(shownFile()).toMatchObject({ id: 'ds_quotes', kind: 'rest' })
      expect(q('[data-file-switcher]')).toBeNull()
      const edited = { ...shownFile(), defaults: { baseUrl: 'https://quotes.test' } }
      await typeInto(q('[data-testid="raw-content"]'), JSON.stringify(edited))
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put')).toEqual([{ path: QUOTES, content: edited, base: original(QUOTES) }])
    })
  })

  describe('All model files', () => {
    it('is the last entry of the tree, named so, where Raw model files was', async () => {
      await open()
      const entries = qa('[data-tree-item]')
      expect(entries.at(-1)?.getAttribute('data-raw-model')).toBe('')
      expect(text(entries.at(-1) ?? null)).toBe('All model files')
      expect(document.body.textContent).not.toContain('Raw model files')
    })

    it('lists every model file by kind, inside the workspace, with the one raw editor', async () => {
      const { router } = await open()
      await click(q('[data-raw-model]'))
      expect(router.currentRoute.value.path).toBe('/data')
      expect(q('[data-data-files]')).not.toBeNull()
      expect(q('[data-data-tree]')).not.toBeNull()
      expect(q('[role="tablist"]')).toBeNull()
      expect(q('[data-raw-model]')?.getAttribute('aria-selected')).toBe('true')
      expect(treeItem('post')?.getAttribute('aria-selected')).toBe('false')
      expect(qa('[data-files-group] h3').map(heading => text(heading))).toEqual(['Project', 'Theme', 'Connections and storage', 'Layouts', 'Modules', 'Collections', 'Repositories', 'Queries', 'Actions', 'State', 'Components', 'Pages', 'Sample data'])
      expect(text(group('page'))).toContain('index')
      expect(fileButton(INDEX_PAGE)).not.toBeNull()
      expect(fileButton('.bildr/manifest.json')).toBeNull()
      // No file is chosen yet: the editor waits for one, or for a path.
      expect(rawText()?.value).toBe('')
    })

    it('opens the file chosen in the editor, with its path in the URL, and saves it', async () => {
      const { actions, router } = await open(keeping())
      await click(q('[data-raw-model]'))
      await click(fileButton(INDEX_PAGE))
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: INDEX_PAGE })
      expect(fileButton(INDEX_PAGE)?.getAttribute('aria-current')).toBe('true')
      expect(text(q('[data-file-path]'))).toBe(INDEX_PAGE)
      expect(shownFile()).toMatchObject({ id: 'pg_index', name: 'index' })
      const edited = { ...shownFile(), title: 'Home' }
      await typeInto(q('[data-testid="raw-content"]'), JSON.stringify(edited))
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put')).toEqual([{ path: INDEX_PAGE, content: edited, base: original(INDEX_PAGE) }])
      expect(text(q('[data-data-files]'))).toContain('Saved.')
    })

    it('shows the problems of a refused save, and keeps the text', async () => {
      const problems = [{ path: INDEX_PAGE, message: 'root: Unknown node type "Wat"' }]
      await open({ model_file_put: () => new Failure(422, 'invalid', 'The model would have problems', problems) }, {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "id": "pg_index" }')
      await click(q('[data-testid="raw-save"]'))
      expect(text(q('[data-data-files]'))).toContain('root: Unknown node type "Wat"')
      expect(rawText()!.value).toBe('{ "id": "pg_index" }')
    })

    it('shows the chosen file\'s path, read only, and asks for a path only behind New file…', async () => {
      await open(keeping(), {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      expect(text(q('[data-file-path]'))).toBe(INDEX_PAGE)
      expect(q('[data-testid="raw-path"]')).toBeNull()
      expect(text(textButton('New file…'))).toBe('New file…')
    })

    it('opens a file by its path, even one the model has not got yet, and puts it in the URL once it is saved', async () => {
      const { actions, router } = await open(keeping(), {}, '/data?item=files')
      const about = '.bildr/modules/blog/pages/about.json'
      await click(textButton('New file…'))
      await typeInto(q('[data-testid="raw-path"]'), about)
      await click(q('[data-testid="raw-path-open"]'))
      expect(text(q('[data-file-path]'))).toBe(about)
      // A path that is typed is not a file yet: the URL does not name it.
      expect(router.currentRoute.value.query).toEqual({ item: 'files' })
      await typeInto(q('[data-testid="raw-content"]'), '{ "id": "pg_about" }')
      await click(q('[data-testid="raw-save"]'))
      // A file that was not there is created: the base says so.
      expect(inputs(actions, 'model_file_put')).toEqual([{ path: about, content: { id: 'pg_about' }, base: null }])
      await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'files', file: about }))
      expect(fileButton(about)?.getAttribute('aria-current')).toBe('true')
    })

    it('opens the file a typed path names when the model has it, and asks for a path under .bildr/', async () => {
      const { router } = await open(keeping(), {}, '/data?item=files')
      await click(textButton('New file…'))
      await typeInto(q('[data-testid="raw-path"]'), 'package.json')
      await click(q('[data-testid="raw-path-open"]'))
      expect(text(q('[data-data-files]'))).toContain('Enter a path under .bildr/')
      expect(q('[data-file-path]')).toBeNull()
      await typeInto(q('[data-testid="raw-path"]'), INDEX_PAGE)
      await click(q('[data-testid="raw-path-open"]'))
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: INDEX_PAGE })
      expect(shownFile()).toMatchObject({ id: 'pg_index' })
    })

    it('goes back to the chosen file when it is chosen again after another path was typed', async () => {
      const { router } = await open(keeping(), {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      await click(textButton('New file…'))
      await typeInto(q('[data-testid="raw-path"]'), '.bildr/modules/blog/pages/about.json')
      await click(q('[data-testid="raw-path-open"]'))
      expect(text(q('[data-file-path]'))).toBe('.bildr/modules/blog/pages/about.json')
      // The list shows nothing chosen, and the URL does not disagree with what is shown after a reload.
      expect(qa('[data-file][aria-current="true"]')).toEqual([])
      expect(router.currentRoute.value.query).toEqual({ item: 'files' })
      await click(fileButton(INDEX_PAGE))
      expect(text(q('[data-file-path]'))).toBe(INDEX_PAGE)
      expect(shownFile()).toMatchObject({ id: 'pg_index' })
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: INDEX_PAGE })
    })

    it('scrolls the chosen file into view in the list', async () => {
      const scrolled: Element[] = []
      const original = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this)
      }
      try {
        await open(keeping(), {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
        expect(scrolled.at(-1)).toBe(fileButton(INDEX_PAGE))
        await click(fileButton(LAYOUT))
        expect(scrolled.at(-1)).toBe(fileButton(LAYOUT))
      } finally {
        Element.prototype.scrollIntoView = original
      }
    })

    it('deletes the file only after it is confirmed', async () => {
      const { actions } = await open({ model_file_delete: () => ({}) }, {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      await click(q('[data-testid="raw-delete"]'))
      expect(actions.named('model_file_delete')).toEqual([])
      await click(q('[data-confirm-cancel]'))
      expect(actions.named('model_file_delete')).toEqual([])
      await click(q('[data-testid="raw-delete"]'))
      await click(q('[data-confirm-ok]'))
      expect(inputs(actions, 'model_file_delete')).toEqual([{ path: INDEX_PAGE }])
    })

    it('after a delete reads the files again, and the file is gone from the list, nothing is chosen, the URL says so, and "Deleted." stays', async () => {
      let deleted = false
      const { actions, router } = await open({
        model_get: () => deleted ? { ...modelGet(), files: Object.fromEntries(Object.entries(modelGet().files).filter(([path]) => path !== INDEX_PAGE)) } : modelGet(),
        model_file_delete: () => {
          deleted = true
          return {}
        }
      }, {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      const reads = actions.named('model_get').length
      await click(q('[data-testid="raw-delete"]'))
      await click(q('[data-confirm-ok]'))
      await vi.waitFor(() => expect(fileButton(INDEX_PAGE)).toBeNull())
      expect(actions.named('model_get').length).toBeGreaterThan(reads)
      expect(router.currentRoute.value.query).toEqual({ item: 'files' })
      expect(q('[data-file-path]')).toBeNull()
      expect(rawText()?.value).toBe('')
      expect(text(q('[data-data-files]'))).toContain('Deleted.')
    })

    it('keeps its selection in the URL, both ways', async () => {
      const { router } = await open({}, {}, `/data?item=files&file=${encodeURIComponent(LAYOUT)}`)
      expect(q('[data-raw-model]')?.getAttribute('aria-selected')).toBe('true')
      expect(shownFile()).toMatchObject({ id: 'lay_main' })
      expect(fileButton(LAYOUT)?.getAttribute('aria-current')).toBe('true')
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: LAYOUT })
      // A collection is shown, with its own tab and none of the file.
      await click(treeItem('post'))
      expect(router.currentRoute.value.query).toEqual({ item: ITEMS.post, tab: 'rows' })
      expect(q('[data-data-files]')).toBeNull()
      // Back to the files, on the file it was on.
      await click(q('[data-raw-model]'))
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: LAYOUT })
      // The URL changing (Back, a link) moves the screen.
      await router.replace({ path: '/data', query: { item: 'files', file: INDEX_PAGE } })
      await settle()
      expect(shownFile()).toMatchObject({ id: 'pg_index' })
      await router.replace({ path: '/data', query: { item: ITEMS.quote, tab: 'fields' } })
      await settle()
      expect(q('[data-data-files]')).toBeNull()
      expect(activeTab()).toBe('fields')
    })

    it('shows no file, and drops it from the URL, for one the model does not have', async () => {
      const { router } = await open({}, {}, '/data?item=files&file=.bildr%2Fnope.json')
      expect(q('[data-data-files]')).not.toBeNull()
      expect(rawText()?.value).toBe('')
      expect(router.currentRoute.value.query).toEqual({ item: 'files' })
    })

    it('is reached with no collection and no connection', async () => {
      world.model.modules.blog!.entities = []
      world.model.modules.blog!.repositories = []
      world.model.datasources = []
      await open({}, {}, '/data?item=files')
      expect(q('[data-data-files]')).not.toBeNull()
      expect(q('[data-data-empty]')).toBeNull()
    })
  })

  describe('the JSON tab\'s switcher', () => {
    const switcherLabels = () => qa('[data-file-switch]').map(button => text(button))

    it('names a query by its label, not the name generated for it, and keeps its path as the title', async () => {
      await json()
      expect(switcherLabels()).toContain('Query All posts')
      expect(switcherLabels().join(' ')).not.toContain('allPosts')
      const button = qa('[data-file-switch]').find(entry => text(entry) === 'Query All posts')
      expect(button?.getAttribute('title')).toBe('.bildr/modules/blog/queries/all-posts.json')
      expect(qa('[data-file-switch]').find(entry => text(entry) === 'Repository')?.getAttribute('title')).toBe(POST_REPOSITORY)
    })

    it('keeps the queries in the strip up to three, and puts them in one select beyond that, so the strip does not wrap', async () => {
      const more = Object.fromEntries([1, 2, 3].map(index => [`.bildr/modules/blog/queries/more-${index}.json`, { id: `q_more_${index}`, name: `more${index}`, label: `More ${index}`, from: 'ent_post' }]))
      saved.reset()
      await open({ ...keeping(addField), model_get: () => ({ ...modelGet(), files: { ...modelGet().files, ...more } }) })
      await click(tab('json'))
      expect(switcherLabels()).toEqual(['Collection', 'Repository', 'Sample data'])
      const select = q('[data-file-switcher] [data-queries-select]')
      expect(select).not.toBeNull()
      expect(text(select)).toContain('Queries')
      await selectOption(select!.querySelector('[role="combobox"]') ?? select, 'Query More 2')
      expect(text(q('[data-file-path]'))).toBe('.bildr/modules/blog/queries/more-2.json')
      expect(shownFile()).toMatchObject({ id: 'q_more_2' })
      // The select says which query is shown, and the strip says no button is.
      expect(q('[data-file-switcher] [aria-pressed="true"]')).toBeNull()
    })
  })

  /** The save the module would refuse as stale when the file is not what the edit started from, as the real action does. */
  const checkingBase = (disk: { files: () => Record<string, unknown> }): Handlers => ({
    model_get: () => ({ ...modelGet(), files: { ...modelGet().files, ...disk.files() } }),
    model_file_put: (input) => {
      const path = input.path as string
      const now = disk.files()[path] ?? modelGet().files[path as keyof ReturnType<typeof modelGet>['files']]
      if ('base' in input && JSON.stringify(input.base) !== JSON.stringify(now)) return new Failure(409, 'conflict', `${path} changed since it was opened, so it was not saved`)
      disk.files()[path] = input.content
      return { sha256: 'c'.repeat(64) }
    }
  })
  const confirmText = () => text(q('[data-confirm]')?.closest('[role="dialog"]') ?? null)

  describe('unsaved edits (S3)', () => {
    const edit = async () => typeInto(q('[data-testid="raw-content"]'), '{ "draft": true }')
    const DISCARD = `Discard unsaved changes to ${POST}?`

    it('asks before another file is chosen in All model files, keeps the text when it is declined, and shows the other file when it is confirmed', async () => {
      const { router } = await open(keeping(), {}, `/data?item=files&file=${encodeURIComponent(POST)}`)
      await edit()
      await click(fileButton(INDEX_PAGE))
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      expect(rawText()!.value).toBe('{ "draft": true }')
      expect(text(q('[data-file-path]'))).toBe(POST)
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: POST })
      await click(fileButton(INDEX_PAGE))
      await click(q('[data-confirm-ok]'))
      expect(text(q('[data-file-path]'))).toBe(INDEX_PAGE)
      expect(shownFile()).toMatchObject({ id: 'pg_index' })
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: INDEX_PAGE })
    })

    it('does not ask when nothing was typed, or after the text was saved', async () => {
      const { actions } = await open(keeping(), {}, `/data?item=files&file=${encodeURIComponent(POST)}`)
      await click(fileButton(INDEX_PAGE))
      expect(q('[data-confirm]')).toBeNull()
      expect(text(q('[data-file-path]'))).toBe(INDEX_PAGE)
      await typeInto(q('[data-testid="raw-content"]'), JSON.stringify({ ...shownFile(), title: 'Home' }))
      await click(q('[data-testid="raw-save"]'))
      expect(actions.named('model_file_put')).toHaveLength(1)
      await click(fileButton(POST))
      expect(q('[data-confirm]')).toBeNull()
      expect(text(q('[data-file-path]'))).toBe(POST)
    })

    it('asks before another file is chosen in the JSON tab\'s switcher', async () => {
      await json()
      await edit()
      const repository = qa('[data-file-switch]').find(button => text(button) === 'Repository')!
      await click(repository)
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      expect(text(q('[data-file-path]'))).toBe(POST)
      expect(rawText()!.value).toBe('{ "draft": true }')
      await click(repository)
      await click(q('[data-confirm-ok]'))
      expect(text(q('[data-file-path]'))).toBe(POST_REPOSITORY)
      expect(shownFile()).toMatchObject({ id: 'repo_post' })
    })

    it('asks before the JSON tab is left for another tab', async () => {
      const { router } = await json()
      await edit()
      await click(tab('fields'))
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      expect(activeTab()).toBe('json')
      expect(rawText()!.value).toBe('{ "draft": true }')
      expect(router.currentRoute.value.query).toEqual({ item: ITEMS.post, tab: 'json' })
      await click(tab('fields'))
      await click(q('[data-confirm-ok]'))
      expect(activeTab()).toBe('fields')
      await click(tab('json'))
      expect(rawText()!.value).not.toBe('{ "draft": true }')
    })

    it('asks before another item is chosen in the tree, and before All model files', async () => {
      await json()
      await edit()
      await click(treeItem('quote'))
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      expect(text(q('[data-file-path]'))).toBe(POST)
      expect(treeItem('post')?.getAttribute('aria-selected')).toBe('true')
      await click(treeItem('quotes'))
      await click(q('[data-confirm-cancel]'))
      expect(treeItem('post')?.getAttribute('aria-selected')).toBe('true')
      await click(q('[data-raw-model]'))
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      expect(q('[data-data-files]')).toBeNull()
      // Confirmed, the other collection opens on its own file.
      await click(treeItem('quote'))
      await click(q('[data-confirm-ok]'))
      expect(text(q('[data-file-path]'))).toBe('.bildr/modules/blog/entities/quote.json')
    })

    it('asks before the URL moves the screen away (Back, a link), and puts the URL back when it is declined', async () => {
      const { router } = await json()
      await edit()
      await router.replace({ path: '/data', query: { item: ITEMS.quote, tab: 'json' } })
      await settle()
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      expect(router.currentRoute.value.query).toEqual({ item: ITEMS.post, tab: 'json' })
      expect(rawText()!.value).toBe('{ "draft": true }')
      await router.replace({ path: '/data', query: { item: ITEMS.quote, tab: 'json' } })
      await settle()
      await click(q('[data-confirm-ok]'))
      expect(text(q('[data-file-path]'))).toBe('.bildr/modules/blog/entities/quote.json')
    })

    it('asks before the screen is left for another one', async () => {
      saved.reset()
      mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...keeping(addField) })
      const { router } = await mountWithApp(App, '/data')
      await click(tab('json'))
      await edit()
      const leaving = router.push('/code')
      await settle()
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      await leaving
      expect(router.currentRoute.value.path).toBe('/data')
      expect(rawText()!.value).toBe('{ "draft": true }')
    })
  })

  describe('the file changing elsewhere while it is edited (S3)', () => {
    const external = async (disk: { files: () => Record<string, unknown> }, path: string, file: unknown, version = 20) => {
      disk.files()[path] = file
      FakeEventSource.instances.at(-1)!.send({ type: 'model', version, files: [path], source: 'disk' })
      await settle()
    }

    it('says so, leaves the edits, and offers the new version or keeping the edits; saving waits for the choice', async () => {
      const disk = { files: () => saved.files() }
      const { actions } = await open(checkingBase(disk), {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "mine": true }')
      await external(disk, INDEX_PAGE, { ...original(INDEX_PAGE) as object, seo: { title: 'Elsewhere' } })
      expect(text(q('[data-file-changed]'))).toContain('This file changed since you opened it')
      expect(textButton('Load the new version')).not.toBeNull()
      expect(textButton('Keep my edits')).not.toBeNull()
      expect(rawText()!.value).toBe('{ "mine": true }')
      // Save does not overwrite what is there without a choice.
      expect(q('[data-testid="raw-save"]')?.hasAttribute('disabled')).toBe(true)
      await click(q('[data-testid="raw-save"]'))
      expect(actions.named('model_file_put')).toEqual([])
      expect(JSON.stringify(saved.files()[INDEX_PAGE])).toContain('Elsewhere')
    })

    it('loads the new version over the edits on request', async () => {
      const disk = { files: () => saved.files() }
      await open(checkingBase(disk), {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "mine": true }')
      await external(disk, INDEX_PAGE, { id: 'pg_index', name: 'index', seo: { title: 'Elsewhere' } })
      await click(textButton('Load the new version'))
      expect(q('[data-file-changed]')).toBeNull()
      expect(shownFile()).toMatchObject({ seo: { title: 'Elsewhere' } })
      // Nothing is left to lose: moving on asks nothing.
      await click(fileButton(POST))
      expect(q('[data-confirm]')).toBeNull()
    })

    it('keeps the edits on request, and then a save replaces the file on purpose, from the new version', async () => {
      const disk = { files: () => saved.files() }
      const { actions } = await open(checkingBase(disk), {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "id": "pg_index", "name": "mine" }')
      const elsewhere = { id: 'pg_index', name: 'index', seo: { title: 'Elsewhere' } }
      await external(disk, INDEX_PAGE, elsewhere)
      await click(textButton('Keep my edits'))
      expect(q('[data-file-changed]')).toBeNull()
      expect(rawText()!.value).toBe('{ "id": "pg_index", "name": "mine" }')
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put')).toEqual([{ path: INDEX_PAGE, content: { id: 'pg_index', name: 'mine' }, base: elsewhere }])
      expect(text(q('[data-data-files]'))).toContain('Saved.')
    })

    it('is refused by the module when the change was not read yet, says why, and then shows the notice: a dirty edit, then an outside change, then a save does not clobber', async () => {
      const disk = { files: () => saved.files() }
      const { actions } = await open(checkingBase(disk), {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "mine": true }')
      // The file changes on disk, and the editor has not heard of it yet.
      saved.files()[INDEX_PAGE] = { id: 'pg_index', name: 'index', seo: { title: 'Elsewhere' } }
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put')).toEqual([{ path: INDEX_PAGE, content: { mine: true }, base: original(INDEX_PAGE) }])
      expect(text(q('[data-data-files]'))).toContain('changed since it was opened, so it was not saved')
      expect(saved.files()[INDEX_PAGE]).toEqual({ id: 'pg_index', name: 'index', seo: { title: 'Elsewhere' } })
      expect(rawText()!.value).toBe('{ "mine": true }')
      await vi.waitFor(() => expect(q('[data-file-changed]')).not.toBeNull())
    })

    it('is said in the JSON tab too, and a regeneration that changes the file is the same', async () => {
      const disk = { files: () => saved.files() }
      await open(checkingBase(disk))
      await click(tab('json'))
      await typeInto(q('[data-testid="raw-content"]'), '{ "mine": true }')
      await external(disk, POST, { ...original(POST) as object, plural: 'articles' })
      expect(text(q('[data-data-json] [data-file-changed]'))).toContain('This file changed since you opened it')
    })
  })

  describe('a file that is not valid JSON (S3)', () => {
    const ABOUT = '.bildr/modules/blog/pages/about.json'
    const RAW = '{ "id": "pg_about", '
    const brokenModule = () => {
      const state = { text: RAW as string | null }
      return {
        state,
        handlers: {
          model_get: () => ({ ok: false, problems: [{ path: ABOUT, message: 'Invalid JSON: Expected property name' }], files: { ...modelGet().files, ...(state.text === null ? { [ABOUT]: { id: 'pg_about' } } : {}) }, invalid: state.text === null ? {} : { [ABOUT]: state.text }, database: false }),
          model_file_put: () => {
            state.text = null
            return { sha256: 'd'.repeat(64) }
          }
        } satisfies Handlers
      }
    }

    it('is listed with a marker, opens with its text, and says it is not valid JSON', async () => {
      const module = brokenModule()
      await open(module.handlers, {}, '/data?item=files')
      expect(group('page')?.querySelector(`[data-file="${ABOUT}"]`)).not.toBeNull()
      expect(text(fileButton(ABOUT))).toContain('not valid JSON')
      await click(fileButton(ABOUT))
      expect(rawText()!.value).toBe(RAW)
      expect(text(q('[data-file-invalid]'))).toContain('This file is not valid JSON')
    })

    it('is not cleared from the URL when a link names it', async () => {
      const module = brokenModule()
      const { router } = await open(module.handlers, {}, `/data?item=files&file=${encodeURIComponent(ABOUT)}`)
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: ABOUT })
      expect(rawText()!.value).toBe(RAW)
      expect(fileButton(ABOUT)?.getAttribute('aria-current')).toBe('true')
    })

    it('is fixed by saving: the module is told it started from the text', async () => {
      const module = brokenModule()
      const { actions } = await open(module.handlers, {}, `/data?item=files&file=${encodeURIComponent(ABOUT)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "id": "pg_about" }')
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put')).toEqual([{ path: ABOUT, content: { id: 'pg_about' }, base: RAW }])
      expect(text(q('[data-data-files]'))).toContain('Saved.')
    })

    it('is not saved while another file has problems: the other file is listed as a link that opens it, and the edit is kept', async () => {
      const module = brokenModule()
      const refused = new Failure(422, 'invalid', 'The model would have problems, .bildr/modules/blog/pages/about.json was not saved', [{ path: POST, message: 'fields: Too small' }])
      const { actions, router } = await open({ ...module.handlers, model_file_put: () => refused }, {}, `/data?item=files&file=${encodeURIComponent(ABOUT)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "id": "pg_about" }')
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put')).toHaveLength(1)
      const files = text(q('[data-data-files]'))
      expect(files).toContain('Not saved')
      expect(files).not.toContain('Saved.')
      expect(text(q('[data-other-problems]'))).toContain('The model must be valid after a save. These files also have problems — fix them here, or in your code editor (the dev server picks it up).')
      expect(rawText()!.value).toBe('{ "id": "pg_about" }')
      const link = q(`[data-other-problems] [data-problem-file="${POST}"]`)
      expect(link?.textContent).toContain(POST)
      // The link opens the other file in All model files; what was typed is asked about first.
      await click(link)
      await vi.waitFor(() => expect(q('[data-confirm]')).not.toBeNull())
      await click(q('[data-confirm-ok]'))
      await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'files', file: POST }))
      await vi.waitFor(() => expect(shownFile()).toMatchObject({ id: 'ent_post' }))
      expect(text(q('[data-file-path]'))).toBe(POST)
    })

    it('lists no link for the file that is being saved, and none for a refused delete', async () => {
      const own = [{ path: INDEX_PAGE, message: 'root: Unknown node type "Wat"' }, { path: POST, message: 'fields: Too small' }]
      const { actions } = await open({
        model_file_put: () => new Failure(422, 'invalid', 'The model would have problems', own),
        model_file_delete: () => new Failure(422, 'invalid', 'The rest of the model would have problems', own)
      }, {}, `/data?item=files&file=${encodeURIComponent(INDEX_PAGE)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "id": "pg_index" }')
      await click(q('[data-testid="raw-save"]'))
      expect(Array.from(document.querySelectorAll('[data-problem-file]'), element => element.getAttribute('data-problem-file'))).toEqual([POST])
      await click(q('[data-testid="raw-delete"]'))
      await click(q('[data-confirm-ok]'))
      expect(actions.named('model_file_delete')).toHaveLength(1)
      expect(q('[data-other-problems]')).toBeNull()
      expect(text(q('[data-data-files]'))).toContain('Not saved')
    })
  })

  describe('what is shown while the model does not load (S3)', () => {
    it('shows All model files, not a spinner, when the model could not be read at all', async () => {
      let reads = 0
      await open({ model_get: () => (++reads === 1 ? new Failure(500, 'write_failed', 'The module is restarting') : modelGet()) }, {}, '/data?item=files')
      expect(q('[data-testid="data-loading"]')).toBeNull()
      expect(q('[data-data-files]')).not.toBeNull()
      expect(fileButton(INDEX_PAGE)).not.toBeNull()
    })

    it('shows All model files, not a spinner, when the module says the model is not ok and names no problem', async () => {
      await open({ model_get: () => ({ ok: false, problems: [], files: modelGet().files, database: false }) }, {}, '/data?item=files')
      expect(q('[data-testid="data-loading"]')).toBeNull()
      expect(q('[data-data-files]')).not.toBeNull()
      expect(fileButton(INDEX_PAGE)).not.toBeNull()
    })

    it('says the model could not be read instead of spinning, and offers the files, outside All model files too', async () => {
      await open({ model_get: () => new Failure(500, 'write_failed', 'The module is restarting') })
      expect(q('[data-testid="data-loading"]')).toBeNull()
      expect(text(q('[data-testid="data-unreadable"]'))).toContain('The model could not be read')
      expect(q('[data-testid="open-model"]')).not.toBeNull()
    })

    it('shows the files\' own load failure, with a Retry that reads again', async () => {
      let reads = 0
      // The editor\'s own read answers; the files\' read fails once.
      await open({ model_get: () => (++reads === 2 ? new Failure(500, 'write_failed', 'The module is restarting') : modelGet()) }, {}, '/data?item=files')
      expect(text(q('[data-files-error]'))).toContain('Could not read the model files')
      expect(text(q('[data-files-error]'))).toContain('The module is restarting')
      await click(textButton('Retry'))
      await vi.waitFor(() => expect(q('[data-files-error]')).toBeNull())
      expect(fileButton(INDEX_PAGE)).not.toBeNull()
    })

    it('shows the same error block, with a Retry, in the JSON tab', async () => {
      let reads = 0
      await open({ model_get: () => (++reads === 2 ? new Failure(500, 'write_failed', 'The module is restarting') : modelGet()) })
      await click(tab('json'))
      expect(text(q('[data-data-json] [data-files-error]'))).toContain('Could not read the model files')
      await click(textButton('Retry'))
      await vi.waitFor(() => expect(q('[data-files-error]')).toBeNull())
      expect(q('[data-testid="raw-content"]')).not.toBeNull()
    })

    it('ignores a /model link\'s path that is not under .bildr/', async () => {
      const { router } = await open({}, {}, '/model?path=package.json')
      expect(router.currentRoute.value.query).toEqual({ item: 'files' })
      expect(q('[data-file-path]')).toBeNull()
      expect(rawText()?.value).toBe('')
    })
  })

  describe('a model with problems', () => {
    const PROBLEM = { path: POST, message: 'fields: Too small' }
    /** The module's answer: broken until `fixed`, then the model as it is. */
    const broken = () => {
      const state = { fixed: false }
      return {
        state,
        handlers: {
          model_get: () => state.fixed ? modelGet() : { ok: false, problems: [PROBLEM], files: modelGet().files, database: false },
          model_file_put: () => {
            state.fixed = true
            return { sha256: 'b'.repeat(64) }
          }
        } satisfies Handlers
      }
    }

    it('lists the files and edits one from the problems list, and is the Data workspace again once the file is fixed', async () => {
      const module = broken()
      const { actions, router } = await open(module.handlers)
      expect(q('[data-testid="data-problems"]')?.textContent).toContain('fields: Too small')
      expect(q('[data-data-tree]')).toBeNull()
      await click(q('[data-testid="open-model"]'))
      await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'files' }))
      // The problems stay on show, and the files and the editor beside them work.
      expect(q('[data-testid="data-problems"]')?.textContent).toContain('fields: Too small')
      expect(fileButton(POST)).not.toBeNull()
      await click(fileButton(POST))
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: POST })
      expect(shownFile()).toMatchObject({ id: 'ent_post' })
      await typeInto(q('[data-testid="raw-content"]'), JSON.stringify(shownFile()))
      await click(q('[data-testid="raw-save"]'))
      expect(inputs(actions, 'model_file_put').map(input => input.path)).toEqual([POST])
      await vi.waitFor(() => expect(q('[data-testid="data-problems"]')).toBeNull())
      expect(q('[data-data-tree]')).not.toBeNull()
      expect(q('[data-data-files]')).not.toBeNull()
      expect(router.currentRoute.value.query).toEqual({ item: 'files', file: POST })
    })

    it('keeps what is typed, and the problems, when the fix is refused', async () => {
      const module = broken()
      await open({ ...module.handlers, model_file_put: () => new Failure(422, 'invalid', 'The model would have problems', [{ path: POST, message: 'fields: Too small' }]) }, {}, `/data?item=files&file=${encodeURIComponent(POST)}`)
      await typeInto(q('[data-testid="raw-content"]'), '{ "id": "ent_post" }')
      await click(q('[data-testid="raw-save"]'))
      expect(text(q('[data-data-files]'))).toContain('Not saved')
      expect(rawText()!.value).toBe('{ "id": "ent_post" }')
      expect(q('[data-testid="data-problems"]')).not.toBeNull()
    })

    it('opens All model files from the /model deep link too, and from a file the problems name', async () => {
      const module = broken()
      const { router } = await open(module.handlers, {}, `/model?path=${encodeURIComponent(POST)}`)
      expect(router.currentRoute.value.path).toBe('/data')
      expect(q('[data-testid="data-problems"]')).not.toBeNull()
      expect(shownFile()).toMatchObject({ id: 'ent_post' })
    })

    it('does not offer the link to the files where the files are already shown', async () => {
      const module = broken()
      await open(module.handlers, {}, '/data?item=files')
      expect(q('[data-testid="open-model"]')).toBeNull()
    })
  })
})

describe('Queries and Actions in the Data tree (S10)', () => {
  const section = (kind: 'query' | 'action') => q(`[data-artifacts="${kind}"]`)
  const items = (kind: 'query' | 'action') => qa(`[data-artifacts="${kind}"] [data-tree-item]`).map(item => item.getAttribute('data-tree-item'))
  /** A model with `count` more queries over Post, `q_more_1`… */
  const withQueries = (count: number) => {
    const mod = world.model.modules.blog!
    for (let n = 1; n <= count; n++) mod.queries.push({ ...structuredClone(mod.queries[0]!), id: `q_more_${n}`, name: `more${n}`, label: `More ${n}` })
  }

  it('has Queries and Actions sections after Collections and Connections, before All model files', async () => {
    await open()
    const order = qa('[data-collections-internal], [data-collections-synced], [data-artifacts], [data-raw-model]').map(element => element.getAttribute('data-artifacts') ?? element.tagName)
    expect(order).toHaveLength(5)
    expect(order.slice(2)).toEqual(['query', 'action', 'BUTTON'])
    expect(text(section('query')?.querySelector('p'))).toBe('Queries')
    expect(text(section('action')?.querySelector('p'))).toBe('Actions')
    expect(items('query')).toEqual([ITEMS.allPosts, ITEMS.featured, ITEMS.latestQuotes, ITEMS.bySlug])
    expect(items('action')).toEqual([ITEMS.createPost, ITEMS.publishPost])
  })

  it('shows each item with its label, and its collection as a grey subtitle', async () => {
    await open()
    expect(text(treeItem('featured')?.querySelector('[data-artifact-label]'))).toBe('Featured posts')
    expect(text(treeItem('featured')?.querySelector('[data-artifact-collection]'))).toBe('Post')
    expect(treeItem('featured')?.querySelector('[data-artifact-collection]')?.className).toContain('text-dimmed')
    expect(text(treeItem('latestQuotes')?.querySelector('[data-artifact-collection]'))).toBe('Quote')
    expect(text(treeItem('publishPost')?.querySelector('[data-artifact-label]'))).toBe('Publish post')
  })

  it('shows the name when an item has no label', async () => {
    world.model.modules.blog!.queries[0]!.label = ''
    await open()
    expect(text(treeItem('allPosts')?.querySelector('[data-artifact-label]'))).toBe('allPosts')
  })

  it('has no filter box in a section with 8 items or fewer', async () => {
    withQueries(4)
    await open()
    expect(items('query')).toHaveLength(8)
    expect(q('[data-artifact-filter]')).toBeNull()
  })

  it('filters the queries by label, name or collection, and says when nothing matches', async () => {
    withQueries(5)
    await open()
    expect(items('query')).toHaveLength(9)
    expect(q('[data-artifact-filter="query"]')).not.toBeNull()
    expect(q('[data-artifact-filter="action"]')).toBeNull()
    await typeInto(inputOf('[data-artifact-filter="query"]'), 'more 3')
    expect(items('query')).toEqual(['query:q_more_3'])
    await typeInto(inputOf('[data-artifact-filter="query"]'), 'quote')
    expect(items('query')).toEqual([ITEMS.latestQuotes])
    await typeInto(inputOf('[data-artifact-filter="query"]'), 'zzz')
    expect(items('query')).toEqual([])
    expect(text(q('[data-artifacts-empty="query"]'))).toContain('No queries match')
    // The roving group is what is listed: the arrows skip what the filter hides.
    await typeInto(inputOf('[data-artifact-filter="query"]'), 'LATEST')
    expect(items('query')).toEqual([ITEMS.latestQuotes])
    treeItem('quote')!.focus()
    await key(treeItem('quote'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('latestQuotes'))
    await key(treeItem('latestQuotes'), 'ArrowDown')
    expect(document.activeElement).toBe(treeItem('createPost'))
  })

  it('does not take the arrow keys typed in the filter for the tree\'s', async () => {
    withQueries(5)
    await open()
    const filter = inputOf('[data-artifact-filter="query"]')
    filter.focus()
    await key(filter, 'ArrowDown')
    await key(filter, 'Enter')
    expect(document.activeElement).toBe(filter)
  })

  it('has a + on each section, which opens its create dialog', async () => {
    await open()
    expect(byLabel('New query')).not.toBeNull()
    expect(byLabel('New action')).not.toBeNull()
    expect(q('[data-artifact-dialog]')).toBeNull()
    await click(byLabel('New query'))
    expect(q('[data-artifact-dialog="create"]')).not.toBeNull()
    expect(text(q('[data-artifact-dialog="create"]'))).toContain('Name')
  })

  it('says what is empty in each section', async () => {
    world.model.modules.blog!.queries = []
    world.model.modules.blog!.actions = []
    indexPage().uses!.queries = []
    await open()
    expect(text(q('[data-artifacts-empty="query"]'))).toBe('No queries yet. Queries read a collection for your pages.')
    expect(text(q('[data-artifacts-empty="action"]'))).toBe('No actions yet. Actions change a collection when a form or a button runs them.')
  })

  it('has a … menu on each row with Rename and Delete', async () => {
    await open()
    const menu = q('[data-artifact-menu="q_featured_posts"]')
    expect(menu).not.toBeNull()
    expect(menu?.getAttribute('aria-label')).toBe('Query options')
    expect(q('[data-artifact-menu="act_create_post"]')?.getAttribute('aria-label')).toBe('Action options')
    await menuItem(menu, 'Rename')
    expect(q('[data-artifact-dialog="rename"]')).not.toBeNull()
  })

  it('shows a query on Results and an action on Overview, with the tabs of its kind', async () => {
    await open()
    await click(treeItem('featured'))
    expect(tabNames()).toEqual(['results', 'definition', 'used', 'json'])
    expect(activeTab()).toBe('results')
    expect(text(q('[data-data-title] h2'))).toBe('Featured posts')
    expect(text(q('[data-data-title]'))).toContain('Query')
    expect(treeItem('featured')?.getAttribute('aria-selected')).toBe('true')
    expect(treeItem('post')?.getAttribute('aria-selected')).toBe('false')
    await click(treeItem('createPost'))
    expect(tabNames()).toEqual(['overview', 'used', 'json'])
    expect(activeTab()).toBe('overview')
    expect(text(q('[data-data-title]'))).toContain('Action')
    expect(text(q('[data-data-title] h2'))).toBe('Create post')
    await click(treeItem('post'))
    expect(tabNames()).toEqual(['rows', 'fields', 'endpoints', 'json'])
  })

  it('puts the query or action and the tab in the URL, and a deep link opens them', async () => {
    const { router } = await open()
    await click(treeItem('featured'))
    expect(router.currentRoute.value.query).toEqual({ item: 'query:q_featured_posts', tab: 'results' })
    await click(tab('used'))
    expect(router.currentRoute.value.query).toEqual({ item: 'query:q_featured_posts', tab: 'used' })
    await click(treeItem('publishPost'))
    expect(router.currentRoute.value.query).toEqual({ item: 'action:act_publish_post', tab: 'used' })
  })

  it('opens the query and the tab a deep link names, and the action too', async () => {
    const { router } = await open({}, {}, '/data?item=query:q_post_by_slug&tab=definition')
    expect(activeTab()).toBe('definition')
    expect(text(q('[data-data-title] h2'))).toBe('Post by slug')
    expect(router.currentRoute.value.query).toEqual({ item: 'query:q_post_by_slug', tab: 'definition' })
    await router.replace({ path: '/data', query: { item: 'action:act_create_post', tab: 'json' } })
    await settle()
    expect(activeTab()).toBe('json')
    expect(text(q('[data-data-title] h2'))).toBe('Create post')
  })

  it('settles on the first tab of a query for a tab it does not have, and on the first collection for one that is gone', async () => {
    const { router } = await open({}, {}, '/data?item=query:q_all_posts&tab=fields')
    expect(router.currentRoute.value.query).toEqual({ item: 'query:q_all_posts', tab: 'results' })
    await router.replace({ path: '/data', query: { item: 'query:q_gone', tab: 'results' } })
    await settle()
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_post', tab: 'rows' })
  })
})

describe('Query Results (S10, DW-7b)', () => {
  const results = (id: string, extra: Handlers = {}, routes: AppRoutes = {}) => open(extra, routes, `/data?item=query:${id}&tab=results`)
  const shownRows = () => qa('[data-query-results] [data-record]').map(row => row.getAttribute('data-record'))
  const param = (name: string) => inputOf(`[data-query-param="${name}"]`)
  const livePosts = { '/api/blog/posts': { items: [post('one'), post('two'), post('three')], total: 3 } }

  it('runs the query over the sample data the Rows tab shows, with its condition, ordering and limit', async () => {
    await results('q_featured_posts')
    // Published posts only: the draft is out.
    expect(shownRows()).toEqual(['0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01'])
    expect(text(q('[data-query-results]'))).toContain('Hello bildr')
    expect(text(q('[data-query-results] [data-results-count]'))).toBe('1 result')
    await click(treeItem('allPosts'))
    // Newest first (createdAt, descending): the draft was created last.
    expect(shownRows()).toEqual(['0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02', '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01'])
    expect(text(q('[data-query-results] [data-results-count]'))).toBe('2 results')
  })

  it('shows the same rows as the collection\'s Rows tab, with the same Live / Sample data switch', async () => {
    await results('q_all_posts', {}, livePosts)
    expect(pressedSources()).toEqual(['Live'])
    expect(shownRows()).toEqual(['id-one', 'id-three', 'id-two'].sort())
    await click(q('[data-live-badge] [aria-label="Sample data"]'))
    expect(pressedSources()).toEqual(['Sample data'])
    expect(shownRows()).toHaveLength(2)
    expect(editorSource()).toBe('sample')
    await click(q('[data-live-badge] [aria-label="Live"]'))
    expect(shownRows()).toHaveLength(3)
    // The collection's own tab reads the same rows.
    await click(treeItem('post'))
    expect(qa('[data-records-table] [data-record]')).toHaveLength(3)
  })

  /** Where the shown rows come from, as the switch says. */
  const editorSource = () => q('[data-live-badge]')?.getAttribute('data-source')

  it('says when the app is not answering and the rows are the sample data', async () => {
    await results('q_all_posts')
    expect(text(q('[data-source-note]'))).toContain('showing sample data')
    expect(shownRows()).toHaveLength(2)
  })

  it('has an input for each parameter above the results, typed by the parameter, prefilled with its default', async () => {
    await results('q_featured_posts', {}, livePosts)
    expect(param('limit').value).toBe('6')
    expect(param('limit').getAttribute('inputmode')).toBe('numeric')
    expect(text(q('[data-query-param-row="limit"]'))).toContain('Limit')
    expect(shownRows()).toHaveLength(3)
    await typeInto(param('limit'), '2')
    expect(shownRows()).toEqual(['id-one', 'id-three'])
    await typeInto(param('limit'), '1')
    expect(shownRows()).toEqual(['id-one'])
    // A blank input is no argument: the default applies again.
    await typeInto(param('limit'), '')
    expect(shownRows()).toHaveLength(3)
  })

  it('names an input that is not a whole number, and shows no rows', async () => {
    await results('q_featured_posts', {}, livePosts)
    await typeInto(param('limit'), 'lots')
    expect(text(q('[data-query-param-row="limit"]'))).toContain('Enter a whole number')
    expect(shownRows()).toEqual([])
  })

  it('keeps the inputs of each query while another tab or query shows, and starts a query over its own defaults', async () => {
    await results('q_featured_posts', {}, livePosts)
    await typeInto(param('limit'), '1')
    await click(tab('definition'))
    await click(tab('results'))
    expect(param('limit').value).toBe('1')
    await click(treeItem('latestQuotes'))
    expect(param('limit').value).toBe('3')
    await click(treeItem('featured'))
    expect(param('limit').value).toBe('1')
  })

  it('shows a query that returns one row as a record, or says there is no match', async () => {
    await results('q_post_by_slug')
    // The slug has no default: nothing matches until it is typed.
    expect(q('[data-query-record]')).toBeNull()
    expect(text(q('[data-query-no-match]'))).toBe('No match')
    await typeInto(param('slug'), 'a-draft')
    expect(q('[data-query-no-match]')).toBeNull()
    expect(text(q('[data-query-record]'))).toContain('A draft')
    expect(text(q('[data-query-record] [data-record-field="slug"]'))).toContain('a-draft')
    expect(q('[data-records-table]')).toBeNull()
    await typeInto(param('slug'), 'nope')
    expect(text(q('[data-query-no-match]'))).toBe('No match')
  })

  it('runs a query over a collection read through a connection, which is always Live', async () => {
    await results('q_latest_quotes', {}, { '/api/blog/quotes': { items: [{ id: 3, text: 'Q three', author: 'Cy' }, { id: 1, text: 'Q one', author: 'Ann' }, { id: 2, text: 'Q two', author: 'Bob' }], total: 3 } })
    expect(q('[data-live-badge] [aria-label="Sample data"]')).toBeNull()
    // Ordered by id, ascending, at most the limit parameter's 3.
    expect(shownRows()).toEqual(['1', '2', '3'])
    await typeInto(param('limit'), '2')
    expect(shownRows()).toEqual(['1', '2'])
  })

  it('says why a query has no results: the collection has no rows', async () => {
    world.model.modules.blog!.fixtures = []
    await results('q_all_posts')
    expect(shownRows()).toEqual([])
    expect(text(q('[data-query-results]'))).toContain('No results')
  })

  it('applies each operator of a condition over the rows', async () => {
    const query = world.model.modules.blog!.queries.find(entry => entry.id === 'q_all_posts')!
    query.where = { op: 'like', field: 'slug', value: '%draft' }
    await results('q_all_posts')
    expect(text(q('[data-query-results]'))).toContain('A draft')
    expect(shownRows()).toHaveLength(1)
  })

  it('reads the app\'s rows again on Refresh', async () => {
    let count = 1
    await results('q_all_posts', {}, { '/api/blog/posts': () => ({ items: Array.from({ length: count }, (_, n) => post(`p${n}`)), total: count }) })
    expect(shownRows()).toHaveLength(1)
    count = 2
    await click(q('[data-records-refresh]'))
    expect(shownRows()).toHaveLength(2)
  })
})

type Json = Record<string, unknown>

/**
 * The module's query and action edits over the mocked model: what `query_update`, `query_create`, `query_rename`, `query_delete` and the
 * action ones change in the model, and the refusal the module gives for a delete while the item is used (its own `usesOf`).
 */
const artifactModule = (): Handlers => {
  const mod = () => world.model.modules.blog!
  const queryOf = (id: unknown) => mod().queries.find(entry => entry.id === id)!
  const actionOf = (id: unknown) => mod().actions.find(entry => entry.id === id)!
  const used = (kind: string, name: string, id: string) => {
    const uses = usesOf(world.model, id)
    if (uses.length) throw new Failure(422, 'invalid', `${kind} ${name} (${id}) is still used: ${describeUses(uses)}. Change them first`)
  }
  const guard = <T>(run: () => T) => {
    try {
      return run()
    } catch (failure) {
      if (failure instanceof Failure) return failure
      throw failure
    }
  }
  return {
    query_update: input => guard(() => {
      const query = queryOf(input.query) as unknown as Json
      for (const key of ['label', 'description', 'result', 'params', 'where', 'orderBy', 'limit']) {
        if (!(key in input)) continue
        if (input[key] === null || (key === 'orderBy' && (input[key] as unknown[]).length === 0)) Reflect.deleteProperty(query, key)
        else query[key] = input[key]
      }
      return { queryId: input.query, forked: false, changed: [] }
    }),
    query_create: input => guard(() => {
      const name = String(input.name).replace(/\s+(\w)/g, (_, letter: string) => letter.toUpperCase())
      if ([...mod().queries, ...mod().actions].some(entry => entry.name === name)) throw new Failure(422, 'invalid', `The name "${name}" is already used by a query or an action of the module`)
      const one = input.result === 'one'
      mod().queries.push({ id: `q_${name}`, name, label: name, from: input.entity, params: one ? [{ name: 'id', type: 'uuid', reactive: true }] : [], ...(one ? { where: { op: 'eq', field: 'id', value: { $param: 'id' } } } : {}), result: input.result } as never)
      return { queryId: `q_${name}`, filePath: `.bildr/modules/blog/queries/${name}.json`, changed: [] }
    }),
    query_rename: input => guard(() => {
      const query = queryOf(input.query)
      const name = String(input.name)
      if ([...mod().queries, ...mod().actions].some(entry => entry.name === name && entry.id !== query.id)) throw new Failure(422, 'invalid', `The name "${name}" is already used by a query or an action of the module`)
      query.name = name
      return { queryId: query.id, name, changed: [] }
    }),
    query_delete: input => guard(() => {
      const query = queryOf(input.query)
      used('Query', query.name, query.id)
      mod().queries = mod().queries.filter(entry => entry.id !== query.id)
      return { deleted: [query.id], changed: [] }
    }),
    action_create: input => guard(() => {
      const name = String(input.name).replace(/\s+(\w)/g, (_, letter: string) => letter.toUpperCase())
      if (input.template === 'update') throw new Failure(422, 'invalid', 'Update needs a sample row of Quote: its generated test loads one. Add sample data to Quote first')
      mod().actions.push({ id: `act_${name}`, name, label: name, http: { method: 'POST', path: `/posts/${name}` }, input: { entity: input.entity, pick: ['id', 'title'] }, errors: [], steps: [{ kind: 'return', if: true, value: { $var: 'undefined' } }], client: { invalidates: [] } } as never)
      return { actionId: `act_${name}`, filePath: `.bildr/modules/blog/actions/${name}.json`, changed: [] }
    }),
    action_update: input => guard(() => {
      const action = actionOf(input.action) as unknown as Json
      for (const key of ['label', 'description', 'input']) {
        if (!(key in input)) continue
        if (input[key] === null) Reflect.deleteProperty(action, key)
        else action[key] = input[key]
      }
      return { actionId: input.action, changed: [] }
    }),
    action_rename: input => guard(() => {
      const action = actionOf(input.action)
      action.name = String(input.name)
      return { actionId: action.id, name: action.name, changed: [] }
    }),
    action_delete: input => guard(() => {
      const action = actionOf(input.action)
      used('Action', action.name, action.id)
      mod().actions = mod().actions.filter(entry => entry.id !== action.id)
      return { deleted: [action.id], changed: [] }
    })
  }
}

describe('Query Definition (S10)', () => {
  const definition = (id = 'q_featured_posts', extra: Handlers = {}, routes: AppRoutes = {}) => open({ ...artifactModule(), ...extra }, routes, `/data?item=query:${id}&tab=definition`)
  const update = (actions: Awaited<ReturnType<typeof open>>['actions']) => inputs(actions, 'query_update')
  const save = () => click(q('[data-def-save]'))
  const field = (name: string) => inputOf(`[data-def="${name}"]`)
  const livePosts = { '/api/blog/posts': { items: [post('one'), post('two'), post('three')], total: 3 } }

  it('shows the query as a form: label, description, one or many, parameters, condition, sort and limit', async () => {
    await definition()
    expect(field('label').value).toBe('Featured posts')
    expect(field('description').value).toBe('published posts, newest first, at most `limit`.')
    expect(q('[data-def="result"] [aria-label="Many"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(q('[data-def="result"] [aria-label="One"]')?.getAttribute('aria-pressed')).toBe('false')
    const parameter = q('[data-def-param-row="0"]')!
    expect(inputOf('[data-def-param-row="0"] [data-def-param-name]').value).toBe('limit')
    expect(text(parameter)).toContain('Integer')
    expect(inputOf('[data-def-param-row="0"] [data-def-param-default]').value).toBe('6')
    expect(text(q('[data-def-where] [data-def-where-field]'))).toContain('published')
    expect(text(q('[data-def-where] [data-def-where-op]'))).toContain('is')
    expect(text(q('[data-def-sort="0"] [data-def-sort-field]'))).toContain('publishedAt')
    expect(text(q('[data-def-sort="0"] [data-def-sort-direction]'))).toContain('Descending')
    expect(text(q('[data-def-limit-kind]'))).toContain('Parameter')
    expect(text(q('[data-def-limit-param]'))).toContain('limit')
    expect(q('[data-def-save]')?.hasAttribute('disabled')).toBe(true)
  })

  it('shows a query without a condition, an ordering or a limit as empty sections', async () => {
    world.model.modules.blog!.queries.push({ id: 'q_bare', name: 'bare', label: 'Bare', from: 'ent_post', params: [], result: 'many' })
    await definition('q_bare')
    expect(q('[data-def-where]')).toBeNull()
    expect(q('[data-def-where-add]')).not.toBeNull()
    expect(q('[data-def-sort]')).toBeNull()
    expect(text(q('[data-def-limit-kind]'))).toContain('No limit')
    expect(q('[data-def-param-row]')).toBeNull()
  })

  it('saves with query_update, in place, and only what changed', async () => {
    const { actions } = await definition()
    await typeInto(field('label'), 'Top posts')
    expect(q('[data-def-save]')?.hasAttribute('disabled')).toBe(false)
    await save()
    expect(update(actions)).toEqual([{ query: 'q_featured_posts', inPlace: true, label: 'Top posts' }])
    // The model has it: the tree and the title say so, and there is nothing left to save.
    expect(text(treeItem('featured')?.querySelector('[data-artifact-label]'))).toBe('Top posts')
    expect(text(q('[data-data-title] h2'))).toBe('Top posts')
    expect(q('[data-def-save]')?.hasAttribute('disabled')).toBe(true)
  })

  it('changes the description, and removes it when it is emptied', async () => {
    const { actions } = await definition()
    await typeInto(field('description'), 'The newest posts')
    await save()
    await typeInto(field('description'), '')
    await save()
    expect(update(actions)).toEqual([
      { query: 'q_featured_posts', inPlace: true, description: 'The newest posts' },
      { query: 'q_featured_posts', inPlace: true, description: null }
    ])
  })

  it('changes One / Many', async () => {
    world.model.modules.blog!.queries.push({ id: 'q_bare', name: 'bare', label: 'Bare', from: 'ent_post', params: [], result: 'many' })
    const { actions } = await definition('q_bare')
    await click(q('[data-def="result"] [aria-label="One"]'))
    await save()
    expect(update(actions)).toEqual([{ query: 'q_bare', inPlace: true, result: 'one' }])
    expect(q('[data-def="result"] [aria-label="One"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('adds a condition on a field, with an operator and a value, and removes it', async () => {
    world.model.modules.blog!.queries.push({ id: 'q_bare', name: 'bare', label: 'Bare', from: 'ent_post', params: [], result: 'many' })
    const { actions } = await definition('q_bare')
    await click(q('[data-def-where-add]'))
    await selectOption(combo('[data-def-where-field]'), 'slug')
    await selectOption(combo('[data-def-where-op]'), 'matches')
    await typeInto(q('[data-def-where-value]'), 'hello%')
    await save()
    expect(update(actions)).toEqual([{ query: 'q_bare', inPlace: true, where: { op: 'like', field: 'slug', value: 'hello%' } }])
    await click(q('[data-def-where-remove]'))
    await save()
    expect(update(actions).at(-1)).toEqual({ query: 'q_bare', inPlace: true, where: null })
    expect(q('[data-def-where]')).toBeNull()
  })

  it('types a condition\'s value by the field: a number for an integer, true or false for a toggle, a list for "is one of"', async () => {
    world.model.modules.blog!.entities[0]!.fields.push({ id: 'fld_views', name: 'views', type: 'integer' } as never)
    world.model.modules.blog!.queries.push({ id: 'q_bare', name: 'bare', label: 'Bare', from: 'ent_post', params: [], result: 'many' })
    const { actions } = await definition('q_bare')
    await click(q('[data-def-where-add]'))
    await selectOption(combo('[data-def-where-field]'), 'views')
    await selectOption(combo('[data-def-where-op]'), 'is at least')
    await typeInto(q('[data-def-where-value]'), '10')
    await save()
    expect(update(actions).at(-1)).toEqual({ query: 'q_bare', inPlace: true, where: { op: 'gte', field: 'views', value: 10 } })
    await selectOption(combo('[data-def-where-op]'), 'is one of')
    await typeInto(q('[data-def-where-value]'), '1, 2,3')
    await save()
    expect(update(actions).at(-1)).toEqual({ query: 'q_bare', inPlace: true, where: { op: 'in', field: 'views', value: [1, 2, 3] } })
    await selectOption(combo('[data-def-where-field]'), 'published')
    await selectOption(combo('[data-def-where-op]'), 'is')
    await selectOption(combo('[data-def-where-value]'), 'No')
    await save()
    expect(update(actions).at(-1)).toEqual({ query: 'q_bare', inPlace: true, where: { op: 'eq', field: 'published', value: false } })
  })

  it('takes a condition\'s value from a parameter', async () => {
    const { actions } = await definition('q_post_by_slug')
    expect(text(q('[data-def-where-kind]'))).toContain('Parameter')
    expect(text(q('[data-def-where-param]'))).toContain('slug')
    await selectOption(combo('[data-def-where-kind]'), 'Value')
    await typeInto(q('[data-def-where-value]'), 'hello-bildr')
    await save()
    expect(update(actions)).toEqual([{ query: 'q_post_by_slug', inPlace: true, where: { op: 'eq', field: 'slug', value: 'hello-bildr' } }])
  })

  it('changes the sort: another field, the direction, one more, and none', async () => {
    const { actions } = await definition()
    await selectOption(combo('[data-def-sort="0"] [data-def-sort-field]'), 'title')
    await selectOption(combo('[data-def-sort="0"] [data-def-sort-direction]'), 'Ascending')
    await click(q('[data-def-sort-add]'))
    await selectOption(combo('[data-def-sort="1"] [data-def-sort-field]'), 'slug')
    await save()
    expect(update(actions)).toEqual([{ query: 'q_featured_posts', inPlace: true, orderBy: [{ field: 'title', direction: 'asc' }, { field: 'slug', direction: 'asc' }] }])
    await click(q('[data-def-sort="1"] [data-def-sort-remove]'))
    await click(q('[data-def-sort="0"] [data-def-sort-remove]'))
    await save()
    expect(update(actions).at(-1)).toEqual({ query: 'q_featured_posts', inPlace: true, orderBy: [] })
    expect(q('[data-def-sort]')).toBeNull()
  })

  it('changes the limit: a number, a parameter, none; Results reflect it after the save', async () => {
    const { actions } = await definition('q_featured_posts', {}, livePosts)
    await selectOption(combo('[data-def-limit-kind]'), 'Number')
    await typeInto(q('[data-def-limit-number]'), '2')
    await save()
    expect(update(actions)).toEqual([{ query: 'q_featured_posts', inPlace: true, limit: 2 }])
    await click(tab('results'))
    expect(qa('[data-query-results] [data-record]')).toHaveLength(2)
    await click(tab('definition'))
    await selectOption(combo('[data-def-limit-kind]'), 'No limit')
    await save()
    expect(update(actions).at(-1)).toEqual({ query: 'q_featured_posts', inPlace: true, limit: null })
    await click(tab('results'))
    expect(qa('[data-query-results] [data-record]')).toHaveLength(3)
  })

  it('adds, renames and removes parameters: the whole list goes with the save', async () => {
    const { actions } = await definition()
    await click(q('[data-def-param-add]'))
    await typeInto(q('[data-def-param-row="1"] [data-def-param-name]'), 'minViews')
    await selectOption(combo('[data-def-param-row="1"] [data-def-param-type]'), 'Integer')
    await typeInto(q('[data-def-param-row="1"] [data-def-param-default]'), '5')
    await save()
    expect(update(actions)).toEqual([{ query: 'q_featured_posts', inPlace: true, params: [{ name: 'limit', type: 'integer', default: 6 }, { name: 'minViews', type: 'integer', default: 5 }] }])
    await click(q('[data-def-param-row="1"] [data-def-param-remove]'))
    await save()
    expect(update(actions).at(-1)).toEqual({ query: 'q_featured_posts', inPlace: true, params: [{ name: 'limit', type: 'integer', default: 6 }] })
  })

  it('shows what the module refused inline, and keeps what was typed', async () => {
    const { actions } = await definition('q_featured_posts', { query_update: () => new Failure(422, 'invalid', 'where: Post has no field "nope" (id, title, slug, body, published, publishedAt, createdAt, updatedAt)') })
    await typeInto(field('label'), 'Top posts')
    await save()
    expect(update(actions)).toHaveLength(1)
    expect(text(q('[data-def-error]'))).toBe('where: Post has no field "nope" (id, title, slug, body, published, publishedAt, createdAt, updatedAt)')
    expect(field('label').value).toBe('Top posts')
    expect(q('[data-def-save]')?.hasAttribute('disabled')).toBe(false)
    // Shown there, not as the screen's banner too.
    expect(q('[data-testid="error-banner"]')).toBeNull()
  })

  it('clears the refusal once the form changes, and keeps the draft over a refresh of the model', async () => {
    let refuse = true
    await definition('q_featured_posts', { query_update: input => refuse ? new Failure(422, 'invalid', 'The query is read by page "index"') : artifactModule().query_update!(input) })
    await typeInto(field('label'), 'Top posts')
    await save()
    expect(q('[data-def-error]')).not.toBeNull()
    refuse = false
    await typeInto(field('label'), 'Top post')
    expect(q('[data-def-error]')).toBeNull()
    await save()
    expect(text(treeItem('featured')?.querySelector('[data-artifact-label]'))).toBe('Top post')
  })

  it('says a change of One / Many is refused while a page reads the query, with the module\'s message', async () => {
    const { actions } = await definition('q_all_posts', { query_update: () => new Failure(422, 'invalid', 'The query allPosts (q_all_posts) is read by page "index" (pg_index) as "all": changing it to one changes what they bind. Change them first') })
    await click(q('[data-def="result"] [aria-label="One"]'))
    await save()
    expect(update(actions)).toEqual([{ query: 'q_all_posts', inPlace: true, result: 'one' }])
    expect(text(q('[data-def-error]'))).toContain('is read by page "index"')
  })
})

describe('Used in, for a query and an action (S10)', () => {
  const usedIn = (item: string, extra: Handlers = {}) => open({ ...artifactModule(), ...extra }, {}, `/data?item=${item}&tab=used`)
  const entries = () => qa('[data-used-in] [data-use]').map(entry => entry.getAttribute('data-use'))

  it('lists the pages that read a query, with how', async () => {
    await usedIn('query:q_featured_posts')
    expect(entries()).toEqual(['page:pg_index'])
    const entry = q('[data-use="page:pg_index"]')!
    expect(text(entry)).toContain('index')
    expect(text(entry)).toContain('Page')
    expect(text(entry)).toContain('Reads it as “featured”')
  })

  it('lists what runs an action: the page that uses it, and the forms and buttons that run it', async () => {
    await usedIn('action:act_create_post')
    expect(entries()).toContain('page:pg_new_post')
    expect(text(q('[data-use="page:pg_new_post"]'))).toContain('Runs it as “createPost”')
  })

  it('says nothing uses a query or an action that is not used', async () => {
    world.model.modules.blog!.queries.push({ id: 'q_bare', name: 'bare', label: 'Bare', from: 'ent_post', params: [], result: 'many' })
    await usedIn('query:q_bare')
    expect(entries()).toEqual([])
    expect(text(q('[data-used-in]'))).toContain('Not used yet. No page reads this query.')
  })

  it('says so for an action too', async () => {
    world.model.modules.blog!.actions.push({ ...structuredClone(world.model.modules.blog!.actions[0]!), id: 'act_bare', name: 'bare', label: 'Bare', http: { method: 'POST', path: '/posts/bare' } })
    await usedIn('action:act_bare')
    expect(entries()).toEqual([])
    expect(text(q('[data-used-in]'))).toContain('Not used yet. No page or form runs this action.')
  })

  it('opens the page on the Canvas from its entry, as the collection\'s detail page link does', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await usedIn('query:q_featured_posts')
      await click(q('[data-use-open="page:pg_index"]'))
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.pageId).toBe('pg_index')
    } finally {
      off()
    }
  })

  it('lists a page once, with each place it uses the query', async () => {
    await usedIn('action:act_create_post')
    expect(entries().filter(entry => entry === 'page:pg_new_post')).toHaveLength(1)
    expect(qa('[data-use="page:pg_new_post"] [data-use-what]').length).toBeGreaterThan(1)
  })
})

describe('Action Overview (S10)', () => {
  const overview = (id = 'act_create_post', extra: Handlers = {}) => open({ ...artifactModule(), ...extra }, {}, `/data?item=action:${id}&tab=overview`)
  const updates = (actions: Awaited<ReturnType<typeof open>>['actions']) => inputs(actions, 'action_update')

  it('shows the label and the description as fields, and the route, the output and the steps read-only', async () => {
    await overview()
    expect(inputOf('[data-action-field="label"]').value).toBe('Create post')
    expect(inputOf('[data-action-field="description"]').value).toBe('Create a post. Rule: the slug must be unique.')
    expect(text(q('[data-action-route]'))).toBe('POST /posts')
    expect(q('[data-action-route] input')).toBeNull()
    expect(text(q('[data-action-output]'))).toContain('Post')
    expect(qa('[data-action-step]').map(step => step.getAttribute('data-action-step'))).toEqual(['validate', 'assert', 'repository'])
    expect(text(q('[data-action-step="validate"]'))).toContain('Checks the input')
    expect(text(q('[data-action-step="assert"]'))).toContain('slug_taken')
    expect(text(q('[data-action-step="repository"]'))).toMatch(/create.*Post/)
  })

  it('says the steps are edited elsewhere for now, with a link to the JSON tab', async () => {
    await overview()
    expect(text(q('[data-steps-note]'))).toContain('Edit the steps in the JSON tab')
    await click(q('[data-steps-note] button'))
    expect(activeTab()).toBe('json')
  })

  it('says what a step is that is not generated yet', async () => {
    world.model.modules.blog!.actions.find(action => action.id === 'act_create_post')!.steps.push({ kind: 'call', service: 'mail' } as never)
    await overview()
    expect(text(q('[data-action-step="call"]'))).toContain('Not generated yet')
  })

  it('lists the fields of the body: those the action takes are on, and a change goes with action_update', async () => {
    const { actions } = await overview()
    expect(qa('[data-pick]').map(pick => pick.getAttribute('data-pick'))).toEqual(['id', 'title', 'slug', 'body', 'published', 'publishedAt'])
    expect(qa('[data-pick][aria-checked="true"]').map(pick => pick.getAttribute('data-pick'))).toEqual(['id', 'title', 'slug', 'body', 'published'])
    await click(q('[data-pick="body"]'))
    expect(updates(actions)).toEqual([{ action: 'act_create_post', input: { entity: 'ent_post', pick: ['id', 'title', 'slug', 'published'] } }])
    expect(q('[data-pick="body"]')?.getAttribute('aria-checked')).toBe('false')
    await click(q('[data-pick="publishedAt"]'))
    expect(updates(actions).at(-1)).toEqual({ action: 'act_create_post', input: { entity: 'ent_post', pick: ['id', 'title', 'slug', 'published', 'publishedAt'] } })
  })

  it('shows the route parameters of an action with no body, read-only', async () => {
    await overview('act_publish_post')
    expect(q('[data-pick]')).toBeNull()
    expect(text(q('[data-action-params]'))).toContain('id')
    expect(text(q('[data-action-params]'))).toContain('route')
    expect(text(q('[data-action-route]'))).toBe('POST /posts/:id/publish')
  })

  it('saves the label and the description: each one action_update', async () => {
    const { actions } = await overview()
    await typeInto(inputOf('[data-action-field="label"]'), 'Add post')
    expect(updates(actions)).toEqual([{ action: 'act_create_post', label: 'Add post' }])
    expect(text(treeItem('createPost')?.querySelector('[data-artifact-label]'))).toBe('Add post')
    await typeInto(inputOf('[data-action-field="description"]'), '')
    expect(updates(actions).at(-1)).toEqual({ action: 'act_create_post', description: null })
  })

  it('shows what the module refused inline, and keeps what was typed', async () => {
    await overview('act_create_post', { action_update: () => new Failure(422, 'invalid', 'input: Post has no field "nope"') })
    await typeInto(inputOf('[data-action-field="label"]'), 'Add post')
    expect(text(q('[data-action-error]'))).toBe('input: Post has no field "nope"')
    expect(inputOf('[data-action-field="label"]').value).toBe('Add post')
    expect(q('[data-testid="error-banner"]')).toBeNull()
  })
})

describe('the JSON tab of a query and of an action (S10)', () => {
  const rawText = () => {
    const element = q('[data-testid="raw-content"]')
    return (element?.matches('textarea') ? element : element?.querySelector('textarea')) as HTMLTextAreaElement | null
  }

  it('edits the query\'s own file in the raw editor', async () => {
    await open({}, {}, '/data?item=query:q_featured_posts&tab=json')
    expect(q('[data-data-json]')).not.toBeNull()
    expect(q('[data-file-switcher]')).toBeNull()
    expect((JSON.parse(rawText()!.value) as { id: string }).id).toBe('q_featured_posts')
    expect(text(q('[data-data-json]'))).toContain('.bildr/modules/blog/queries/featured-posts.json')
  })

  it('edits the action\'s own file in the raw editor', async () => {
    await open({}, {}, '/data?item=action:act_publish_post&tab=json')
    expect((JSON.parse(rawText()!.value) as { id: string }).id).toBe('act_publish_post')
    expect(text(q('[data-data-json]'))).toContain('.bildr/modules/blog/actions/publish-post.json')
  })
})

describe('the dialogs of queries and actions (S10, DW-7d, DW-7e)', () => {
  const mounted = (extra: Handlers = {}, path = '/data') => open({ ...artifactModule(), ...extra }, {}, path)
  const dialog = (kind: 'create' | 'rename' | 'delete') => q(`[data-artifact-dialog="${kind}"]`)
  const nameInput = () => inputOf('[data-artifact-name]')
  const submit = () => click(q('[data-artifact-submit]'))
  const error = () => text(q('[data-artifact-error]'))
  const calls = (actions: Awaited<ReturnType<typeof open>>['actions'], name: string) => inputs(actions, name)

  describe('New query', () => {
    const openCreate = async (extra: Handlers = {}) => {
      const mount = await mounted(extra)
      await click(byLabel('New query'))
      return mount
    }

    it('asks for a collection, One or Many and a name, and starts on Many', async () => {
      await openCreate()
      expect(text(q('[role="dialog"]'))).toContain('New query')
      expect(text(q('[data-artifact-collection-select]'))).toContain('Post')
      expect(q('[data-artifact-result] [aria-label="Many"]')?.getAttribute('aria-pressed')).toBe('true')
      expect(q('[data-artifact-result] [aria-label="One"]')?.getAttribute('aria-pressed')).toBe('false')
      expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(true)
    })

    it('lists every collection, the one shown first, and starts on it', async () => {
      await mounted()
      await click(collection('quotes'))
      await click(byLabel('New query'))
      expect(text(q('[data-artifact-collection-select]'))).toContain('Quote')
    })

    it('creates it with query_create, opens it on Definition, and closes', async () => {
      const { actions, router } = await openCreate()
      await typeInto(nameInput(), 'recent posts')
      expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(false)
      await submit()
      expect(calls(actions, 'query_create')).toEqual([{ entity: 'ent_post', result: 'many', name: 'recent posts' }])
      expect(dialog('create')).toBeNull()
      expect(activeTab()).toBe('definition')
      expect(router.currentRoute.value.query).toEqual({ item: 'query:q_recentPosts', tab: 'definition' })
      expect(treeItem('featured')).not.toBeNull()
      expect(q('[data-tree-item="query:q_recentPosts"]')?.getAttribute('aria-selected')).toBe('true')
    })

    it('creates a query that returns one row, over the collection picked', async () => {
      const { actions } = await openCreate()
      await selectOption(combo('[data-artifact-collection-select]'), 'Quote')
      await click(q('[data-artifact-result] [aria-label="One"]'))
      await typeInto(nameInput(), 'quoteById')
      await submit()
      expect(calls(actions, 'query_create')).toEqual([{ entity: 'ent_quote', result: 'one', name: 'quoteById' }])
    })

    it('submits with Enter in the name', async () => {
      const { actions } = await openCreate()
      await typeInto(nameInput(), 'enterQuery')
      await key(nameInput(), 'Enter')
      expect(calls(actions, 'query_create')).toHaveLength(1)
    })

    it('shows what the module refused inside the dialog, and keeps the name', async () => {
      const { actions } = await openCreate({ query_create: () => new Failure(422, 'invalid', 'Quote has no list the app can read: expose its list in the collection\'s JSON tab, under Repository') })
      await typeInto(nameInput(), 'recent posts')
      await submit()
      expect(calls(actions, 'query_create')).toHaveLength(1)
      expect(dialog('create')).not.toBeNull()
      expect(error()).toBe('Quote has no list the app can read: expose its list in the collection\'s JSON tab, under Repository')
      expect(nameInput().value).toBe('recent posts')
      expect(q('[data-testid="error-banner"]')).toBeNull()
      // Typing again clears it.
      await typeInto(nameInput(), 'recent posts 2')
      expect(q('[data-artifact-error]')).toBeNull()
    })

    it('is cancelled with Cancel, and starts fresh the next time', async () => {
      await openCreate()
      await typeInto(nameInput(), 'draftName')
      await click(textButton('Cancel'))
      expect(dialog('create')).toBeNull()
      await click(byLabel('New query'))
      expect(nameInput().value).toBe('')
    })
  })

  describe('New action', () => {
    const openCreate = async (extra: Handlers = {}) => {
      const mount = await mounted(extra)
      await click(byLabel('New action'))
      return mount
    }
    const templates = () => qa('[data-action-template]').map(template => template.getAttribute('data-action-template'))

    it('offers Create, Update, Delete and Blank, each with a line saying what it starts with', async () => {
      await openCreate()
      expect(text(q('[role="dialog"]'))).toContain('New action')
      expect(templates()).toEqual(['create', 'update', 'delete', 'blank'])
      for (const template of qa('[data-action-template]')) expect(text(template.querySelector('[data-action-template-description]')).length).toBeGreaterThan(10)
      expect(text(q('[data-action-template="blank"]'))).toContain('Blank')
      expect(text(q('[data-action-template="blank"]'))).toContain('one step')
      expect(qa('[data-action-template][aria-checked="true"]').map(template => template.getAttribute('data-action-template'))).toEqual(['create'])
    })

    it('creates it with action_create from the template picked, and opens it on Overview', async () => {
      const { actions, router } = await openCreate()
      await click(q('[data-action-template="blank"]'))
      await typeInto(nameInput(), 'archive post')
      await submit()
      expect(calls(actions, 'action_create')).toEqual([{ entity: 'ent_post', template: 'blank', name: 'archive post' }])
      expect(dialog('create')).toBeNull()
      expect(activeTab()).toBe('overview')
      expect(router.currentRoute.value.query).toEqual({ item: 'action:act_archivePost', tab: 'overview' })
    })

    it('shows what the module refused inside the dialog, and keeps the input', async () => {
      const { actions } = await openCreate()
      await selectOption(combo('[data-artifact-collection-select]'), 'Quote')
      await click(q('[data-action-template="update"]'))
      await typeInto(nameInput(), 'edit quote')
      await submit()
      expect(calls(actions, 'action_create')).toEqual([{ entity: 'ent_quote', template: 'update', name: 'edit quote' }])
      expect(error()).toContain('Update needs a sample row of Quote')
      expect(nameInput().value).toBe('edit quote')
      expect(q('[data-action-template="update"]')?.getAttribute('aria-checked')).toBe('true')
      expect(dialog('create')).not.toBeNull()
    })
  })

  describe('Rename', () => {
    const openRename = async (item: string, extra: Handlers = {}) => {
      const mount = await mounted(extra)
      const id = item.slice(item.indexOf(':') + 1)
      await menuItem(q(`[data-artifact-menu="${id}"]`), 'Rename')
      return mount
    }

    it('starts on the name and says hand-written code that imports the generated name needs the same rename', async () => {
      await openRename('query:q_featured_posts')
      expect(text(q('[role="dialog"]'))).toContain('Rename query')
      expect(nameInput().value).toBe('featuredPosts')
      expect(text(q('[data-artifact-warning]'))).toBe('Hand-written code that imports `useFeaturedPosts` needs the same rename.')
    })

    it('renames with query_rename, keeps the query shown, and closes', async () => {
      const { actions } = await openRename('query:q_featured_posts')
      await typeInto(nameInput(), 'topPosts')
      await submit()
      expect(calls(actions, 'query_rename')).toEqual([{ query: 'q_featured_posts', name: 'topPosts' }])
      expect(dialog('rename')).toBeNull()
      expect(treeItem('featured')?.getAttribute('title')).toBe('topPosts')
    })

    it('renames an action with action_rename', async () => {
      const { actions } = await openRename('action:act_publish_post')
      expect(text(q('[data-artifact-warning]'))).toContain('`usePublishPost`')
      await typeInto(nameInput(), 'releasePost')
      await submit()
      expect(calls(actions, 'action_rename')).toEqual([{ action: 'act_publish_post', name: 'releasePost' }])
      expect(dialog('rename')).toBeNull()
    })

    it('keeps the item that was shown, and its tab, over a rename', async () => {
      const { router } = await openRename('query:q_featured_posts')
      await click(textButton('Cancel'))
      await click(treeItem('featured'))
      await click(tab('definition'))
      await menuItem(q('[data-artifact-menu="q_featured_posts"]'), 'Rename')
      await typeInto(nameInput(), 'topPosts')
      await submit()
      expect(router.currentRoute.value.query).toEqual({ item: 'query:q_featured_posts', tab: 'definition' })
    })

    it('shows what the module refused inside the dialog, and keeps the input', async () => {
      await openRename('query:q_featured_posts')
      await typeInto(nameInput(), 'allPosts')
      await submit()
      expect(error()).toBe('The name "allPosts" is already used by a query or an action of the module')
      expect(dialog('rename')).not.toBeNull()
      expect(nameInput().value).toBe('allPosts')
    })

    it('does not send a rename to the same name', async () => {
      const { actions } = await openRename('query:q_featured_posts')
      await submit()
      expect(calls(actions, 'query_rename')).toEqual([])
      expect(dialog('rename')).toBeNull()
    })
  })

  describe('Delete', () => {
    const openDelete = async (id: string, extra: Handlers = {}) => {
      const mount = await mounted(extra)
      await menuItem(q(`[data-artifact-menu="${id}"]`), 'Delete')
      return mount
    }
    const bare = () => world.model.modules.blog!.queries.push({ id: 'q_bare', name: 'bare', label: 'Bare', from: 'ent_post', params: [], result: 'many' })

    it('asks first, and deletes a query nothing uses with query_delete', async () => {
      bare()
      const { actions } = await openDelete('q_bare')
      expect(text(q('[role="dialog"]'))).toContain('Delete query')
      expect(text(q('[role="dialog"]'))).toContain('Bare')
      expect(q('[data-artifact-uses]')).toBeNull()
      await submit()
      expect(calls(actions, 'query_delete')).toEqual([{ query: 'q_bare' }])
      expect(dialog('delete')).toBeNull()
      expect(q('[data-tree-item="query:q_bare"]')).toBeNull()
    })

    it('falls back to the first collection when the query shown is deleted', async () => {
      bare()
      const { router } = await open({ ...artifactModule() }, {}, '/data?item=query:q_bare&tab=results')
      await menuItem(q('[data-artifact-menu="q_bare"]'), 'Delete')
      await submit()
      expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_post', tab: 'rows' })
    })

    it('says a query that is used is used, with the places as links, and the module refuses', async () => {
      const { actions } = await openDelete('q_all_posts')
      expect(text(q('[data-artifact-uses]'))).toContain('Used in 1 place')
      expect(q('[data-artifact-uses] [data-use-open="page:pg_index"]')).not.toBeNull()
      await submit()
      expect(calls(actions, 'query_delete')).toEqual([{ query: 'q_all_posts' }])
      expect(dialog('delete')).not.toBeNull()
      expect(error()).toContain('Query allPosts (q_all_posts) is still used')
      expect(q('[data-artifact-uses] [data-use-open="page:pg_index"]')).not.toBeNull()
      expect(treeItem('allPosts')).not.toBeNull()
      expect(q('[data-testid="error-banner"]')).toBeNull()
    })

    it('opens a place from the list on the Canvas, and closes the dialog', async () => {
      const opened = vi.fn()
      const off = registerScreens(opened)
      try {
        await openDelete('q_all_posts')
        await click(q('[data-artifact-uses] [data-use-open="page:pg_index"]'))
        expect(opened).toHaveBeenCalledWith('design')
        expect(takeStart().data.pageId).toBe('pg_index')
        expect(dialog('delete')).toBeNull()
      } finally {
        off()
      }
    })

    it('refuses an action a page uses, and deletes one nothing uses', async () => {
      world.model.modules.blog!.actions.push({ ...structuredClone(world.model.modules.blog!.actions[0]!), id: 'act_bare', name: 'bare', label: 'Bare', http: { method: 'POST', path: '/posts/bare' } })
      const { actions } = await openDelete('act_create_post')
      expect(text(q('[data-artifact-uses]'))).toContain('Used in')
      await submit()
      expect(error()).toContain('Action createPost (act_create_post) is still used')
      await click(textButton('Cancel'))
      await menuItem(q('[data-artifact-menu="act_bare"]'), 'Delete')
      await submit()
      expect(calls(actions, 'action_delete')).toEqual([{ action: 'act_create_post' }, { action: 'act_bare' }])
      expect(q('[data-tree-item="action:act_bare"]')).toBeNull()
    })
  })
})
