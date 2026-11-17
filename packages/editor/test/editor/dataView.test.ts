import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesign } from '../../src/design/store.ts'
import { createEditor } from '../../src/editor/useEditor.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { dataLocationQuery, filesLocationQuery, parseDataLocation } from '../../src/editor/dataLocation.ts'
import { liveRows } from '../../src/design/liveRows.ts'
import { treeItems } from '../../src/editor/dataTree.ts'
import { tabsOf } from '../../src/editor/dataTabs.ts'
import { Failure, mockActions, settle } from '../helpers.ts'
import { baseHandlers, setupHarness, world } from '../design/harness.ts'

/**
 * The adapter's Data state (U7): the hosted `collection`, `connection`, `records` and the table's rows over the model.
 * Rows are the app's (the generated list route) or the entity's fixtures; nothing writes them (E2).
 */

setupHarness()

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

const post = (slug: string) => ({ id: `id-${slug}`, title: `Post ${slug}`, slug, body: '', published: true, publishedAt: null, createdAt: '2026-11-10T09:00:00.000Z', updatedAt: '2026-11-10T09:00:00.000Z' })

const bootData = async (routes: Parameters<typeof mockActions>[1] = {}, extra: Record<string, (input: Record<string, unknown>) => unknown> = {}, view?: 'data') => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...extra }, routes)
  const design = createDesign()
  const editor = createEditor(design, view ? { view } : {})
  disposers.push(() => design.dispose())
  await editor.start()
  await settle()
  return { actions, design, editor }
}

describe('collections and connections', () => {
  it('lists the entities as collections and the REST data sources as connections; the first collection is shown', async () => {
    const { editor } = await bootData()
    expect(editor.collections.map(entry => entry.name)).toEqual(['Post', 'Quote'])
    expect(editor.connections.map(entry => entry.name)).toEqual(['quotes'])
    expect(editor.collection?.id).toBe('ent_post')
    expect(editor.connection).toBeNull()
  })

  it('shows the collection or the connection chosen, and falls back to the first when it is gone', async () => {
    const { editor } = await bootData()
    editor.collectionId = 'ent_quote'
    expect(editor.collection?.name).toBe('Quote')
    editor.connectionId = 'ds_quotes'
    expect(editor.connection?.baseUrl).toBe('https://dummyjson.com')
    editor.collectionId = 'ent_gone'
    expect(editor.collection?.id).toBe('ent_post')
  })

  it('follows the model: a collection added elsewhere appears', async () => {
    const { editor, design } = await bootData()
    world.model.modules.blog!.entities.push({ ...structuredClone(world.model.modules.blog!.entities[0]!), id: 'ent_note', name: 'Note', plural: 'notes' })
    await design.refresh()
    expect(editor.collections.map(entry => entry.name)).toEqual(['Post', 'Quote', 'Note'])
  })
})

describe('the rows of the shown collection', () => {
  it('reads nothing for the Data view until it is open (the canvas reads the rows its page needs, as before)', async () => {
    const { actions, editor } = await bootData({ '/api/blog/posts': { items: [post('one')], total: 1 } })
    const forCanvas = actions.appCalls.length
    editor.collectionId = 'ent_quote'
    await settle()
    expect(actions.appCalls).toHaveLength(forCanvas)
  })

  it('shows the entity\'s fixtures when the app can\'t answer, and says why', async () => {
    const { editor } = await bootData()
    editor.mode = 'data'
    await settle()
    expect(editor.collectionRows.map(row => row.slug)).toEqual(['hello-bildr', 'a-draft'])
    expect(editor.rowsSource).toBe('sample')
    expect(editor.recordsError).toBe('could not be reached')
    expect(editor.recordsTotal).toBe(2)
  })

  it('keeps the choice Live while the app does not answer, and says the rows shown are the fallback', async () => {
    const { editor } = await bootData()
    editor.mode = 'data'
    await settle()
    expect(editor.rowsPreference).toBe('live')
    expect(editor.rowsSource).toBe('sample')
    expect(editor.rowsFallback).toBe(true)
    // Sample data chosen is a choice, not a fallback.
    editor.rowsPreference = 'sample'
    expect(editor.rowsFallback).toBe(false)
  })

  it('has no fallback while the app answers', async () => {
    const { editor } = await bootData({ '/api/blog/posts': { items: [post('one')], total: 1 } })
    editor.mode = 'data'
    await settle()
    expect(editor.rowsFallback).toBe(false)
  })

  it('picks the app up when Live is read again after it came back', async () => {
    let up = false
    const { editor } = await bootData({ '/api/blog/posts': () => up ? { items: [post('one')], total: 1 } : new Failure(503, 'down', 'down') })
    editor.mode = 'data'
    await settle()
    expect(editor.rowsSource).toBe('sample')
    up = true
    editor.rowsPreference = 'live'
    await editor.reloadRecords()
    expect(editor.rowsSource).toBe('live')
    expect(editor.rowsFallback).toBe(false)
    expect(editor.collectionRows.map(row => row.slug)).toEqual(['one'])
  })

  it('shows the app\'s rows from the generated list route when it answers', async () => {
    const { editor, actions } = await bootData({ '/api/blog/posts': { items: [post('one'), post('two'), post('three')], total: 3 } })
    const forCanvas = actions.appCalls.length
    editor.mode = 'data'
    await settle()
    expect(actions.appCalls.slice(forCanvas)).toEqual(['/api/blog/posts?limit=500&offset=0'])
    expect(editor.collectionRows.map(row => row.slug)).toEqual(['one', 'two', 'three'])
    expect(editor.rowsSource).toBe('live')
    expect(editor.recordsError).toBe('')
    expect(editor.recordsTotal).toBe(3)
  })

  it('a REST entity has no fixtures: its rows come from the app, else none with the reason', async () => {
    const { editor } = await bootData({ '/api/blog/quotes': { items: [{ id: 1, text: 'Q', author: 'A' }], total: 1 } })
    editor.mode = 'data'
    editor.collectionId = 'ent_quote'
    await settle()
    expect(editor.collectionRows).toEqual([{ id: 1, text: 'Q', author: 'A' }])
    expect(editor.rowsSource).toBe('live')
  })

  it('reads the list again on Refresh, and after the app regenerated', async () => {
    let answer = [post('one')]
    const { editor, actions, design } = await bootData({ '/api/blog/posts': () => ({ items: answer, total: answer.length }) })
    const forCanvas = actions.appCalls.length
    editor.mode = 'data'
    await settle()
    answer = [post('one'), post('two')]
    await editor.reloadRecords()
    expect(editor.collectionRows).toHaveLength(2)
    answer = [post('three')]
    design.regenerated.value = { ok: true }
    await settle()
    expect(editor.collectionRows.map(row => row.slug)).toEqual(['three'])
    // The Data view's reads: when it opened, on Refresh and after the regenerate.
    expect(actions.appCalls.slice(forCanvas).filter(call => call.startsWith('/api/blog/posts'))).toHaveLength(3)
  })

  it('gives up on an app that does not answer in time and shows the fixtures', async () => {
    const before = liveRows.timeoutMs
    liveRows.timeoutMs = 30
    try {
      const { editor } = await bootData({ '/api/blog/posts': () => new Promise(() => {}) })
      editor.mode = 'data'
      await new Promise(resolve => setTimeout(resolve, 80))
      await settle()
      expect(editor.rowsSource).toBe('sample')
      expect(editor.recordsError).toContain('did not answer in time')
    } finally {
      liveRows.timeoutMs = before
    }
  })

  it('counts the rows of each collection: the fixtures, the app\'s once read, nothing for a REST entity not read yet', async () => {
    const { editor } = await bootData({ '/api/blog/posts': { items: [post('one'), post('two'), post('three')], total: 3 } })
    expect(editor.collectionCounts).toEqual({ ent_post: 2 })
    editor.mode = 'data'
    await settle()
    expect(editor.collectionCounts).toEqual({ ent_post: 3 })
  })

  it('counts the sample data of each collection while Sample data is chosen, whatever the app answers', async () => {
    const { editor } = await bootData({ '/api/blog/posts': { items: [post('one'), post('two'), post('three')], total: 3 } })
    editor.mode = 'data'
    await settle()
    editor.rowsPreference = 'sample'
    expect(editor.collectionCounts).toEqual({ ent_post: 2 })
    editor.rowsPreference = 'live'
    expect(editor.collectionCounts).toEqual({ ent_post: 3 })
  })

  it('closes the open record when another collection is shown', async () => {
    const { editor } = await bootData()
    editor.recordId = 'x'
    editor.collectionId = 'ent_quote'
    await settle()
    expect(editor.recordId).toBeNull()
  })

  it('closes the open record when the source is switched', async () => {
    const { editor } = await bootData({ '/api/blog/posts': { items: [post('one')], total: 1 } })
    editor.mode = 'data'
    await settle()
    editor.recordId = 'id-one'
    editor.rowsPreference = 'sample'
    await settle()
    expect(editor.recordId).toBeNull()
    editor.recordId = 'x'
    editor.rowsPreference = 'live'
    await settle()
    expect(editor.recordId).toBeNull()
  })

  it('keeps the open record when the app answers late, with no switch by the user', async () => {
    let answer: (value: unknown) => void = () => {}
    const { editor } = await bootData({ '/api/blog/posts': () => new Promise((resolve) => {
      answer = resolve
    }) })
    editor.mode = 'data'
    await settle()
    editor.recordId = 'x'
    answer({ items: [post('one')], total: 1 })
    await settle()
    expect(editor.rowsSource).toBe('live')
    expect(editor.recordId).toBe('x')
  })
})

describe('creating a collection', () => {
  it('is an entity over the app database with a first text field, and is shown', async () => {
    const { editor, actions } = await bootData({}, { entity_create: () => ({ entityId: 'ent_untitled', repositoryId: 'repo_untitled', queryIds: [] }) })
    expect(await editor.createCollection('Untitled')).toBe('ent_untitled')
    expect(actions.named('entity_create').map(call => call.input)).toEqual([{ name: 'Untitled', source: 'ds_main', fields: [{ name: 'title', type: 'text' }] }])
    expect(actions.named('datasource_create')).toEqual([])
    expect(editor.collectionId).toBe('ent_untitled')
    expect(editor.connectionId).toBeNull()
  })

  it('makes a memory data source first when the project has no database', async () => {
    world.model.datasources = world.model.datasources.filter(source => source.kind !== 'sqlite')
    const { editor, actions } = await bootData({}, { datasource_create: () => ({ datasourceId: 'ds_memory', filePath: '.bildr/datasources/memory.json', database: false }), entity_create: () => ({ entityId: 'ent_untitled' }) })
    await editor.createCollection('Untitled')
    expect(actions.named('datasource_create').map(call => call.input)).toEqual([{ name: 'memory', kind: 'memory' }])
    expect(actions.named('entity_create').map(call => call.input)).toEqual([{ name: 'Untitled', source: 'ds_memory', fields: [{ name: 'title', type: 'text' }] }])
  })

  it('shows nothing new when the action refuses', async () => {
    const { editor } = await bootData({}, { entity_create: () => new Failure(422, 'invalid', 'Module "blog" already has the entity Untitled (ent_untitled)') })
    expect(await editor.createCollection('Untitled')).toBeUndefined()
    expect(editor.collectionId).toBeNull()
    expect(editor.error).toContain('already has the entity')
  })
})

describe('creating a collection on a data source it made', () => {
  it('deletes the memory source it made when entity_create is refused', async () => {
    world.model.datasources = world.model.datasources.filter(source => source.kind !== 'sqlite')
    const { editor, actions } = await bootData({}, {
      datasource_create: () => ({ datasourceId: 'ds_memory', filePath: '.bildr/datasources/memory.json', database: false }),
      entity_create: () => new Failure(422, 'invalid', 'Module "blog" already has the entity Untitled (ent_untitled)'),
      datasource_delete: () => ({ changed: [], database: false })
    })
    expect(await editor.createCollection('Untitled')).toBeUndefined()
    expect(actions.named('datasource_delete').map(call => call.input)).toEqual([{ datasource: 'ds_memory' }])
    // The refusal that explains it stays.
    expect(editor.error).toContain('already has the entity')
  })

  it('keeps a source the project already had when entity_create is refused', async () => {
    const { editor, actions } = await bootData({}, { entity_create: () => new Failure(422, 'invalid', 'nope'), datasource_delete: () => ({ changed: [] }) })
    expect(await editor.createCollection('Untitled')).toBeUndefined()
    expect(actions.named('datasource_delete')).toEqual([])
    expect(editor.error).toContain('nope')
  })
})

describe('env and errors', () => {
  it('reads the env status the connection panel shows', async () => {
    const { editor } = await bootData({}, { env_status: () => ({ variables: [{ name: 'NUXT_DATASOURCES_QUOTES_API_KEY', datasource: 'ds_quotes', setting: 'apiKey', secret: true, hasDefault: false, set: false, from: null }] }) })
    expect(editor.env.map(entry => [entry.name, entry.set])).toEqual([['NUXT_DATASOURCES_QUOTES_API_KEY', false]])
  })

  it('a refused write comes back as no result with the refusal in error', async () => {
    const { editor } = await bootData({}, { entity_delete: () => new Failure(422, 'invalid', 'Entity Post is still used by pg_index (uses). Change them first') })
    expect(await editor.run('entity_delete', { entity: 'ent_post' })).toBeUndefined()
    expect(editor.error).toContain('still used')
  })
})

describe('the Data and the Design views are two screens', () => {
  afterEach(() => {
    takeStart()
  })

  it('a view the other screen shows is opened through the shell, which the editor there starts on', async () => {
    const open = vi.fn()
    const off = registerScreens(open)
    try {
      const { editor } = await bootData()
      editor.mode = 'settings'
      expect(open).not.toHaveBeenCalled()
      editor.mode = 'data'
      expect(open).toHaveBeenCalledWith('data')
      expect(takeStart().view).toBe('data')
    } finally {
      off()
    }
  })

  it('the Data screen starts on data, and leaves it for the Design screen', async () => {
    const open = vi.fn()
    const off = registerScreens(open)
    try {
      const { editor } = await bootData({}, {}, 'data')
      expect(editor.mode).toBe('data')
      editor.mode = 'build'
      expect(open).toHaveBeenCalledWith('design')
      expect(takeStart().view).toBe('build')
      expect(takeStart().view).toBeNull()
    } finally {
      off()
    }
  })

  it('the collection shown and an Import from API request go with the view to the Data screen', async () => {
    const open = vi.fn()
    const off = registerScreens(open)
    try {
      const { editor } = await bootData()
      editor.collectionId = 'ent_quote'
      editor.importRequest++
      editor.mode = 'data'
      const next = await bootData({}, {}, 'data')
      expect(next.editor.collectionId).toBe('ent_quote')
      expect(next.editor.importRequest).toBe(1)
      // It was handed over once: an editor created later starts clean.
      const later = await bootData({}, {}, 'data')
      expect(later.editor.collectionId).toBeNull()
      expect(later.editor.importRequest).toBe(0)
    } finally {
      off()
    }
  })

  it('forgets what it carried when the navigation fails or is cancelled', async () => {
    for (const outcome of [() => Promise.resolve(new Error('navigation cancelled')), () => Promise.reject(new Error('boom'))]) {
      const off = registerScreens(outcome)
      try {
        const { editor } = await bootData()
        editor.mode = 'data'
        await settle()
        expect(takeStart().view).toBeNull()
      } finally {
        off()
      }
    }
  })

  it('is taken by the editor of the screen it was for, and an editor of the other screen drops it', async () => {
    const off = registerScreens(() => Promise.resolve(undefined))
    try {
      const { editor } = await bootData()
      editor.collectionId = 'ent_quote'
      editor.mode = 'data'
      // A Design editor made meanwhile (a stale navigation) must not start on Data, nor leave it for a later screen.
      const other = await bootData()
      expect(other.editor.mode).toBe('build')
      const data = await bootData({}, {}, 'data')
      expect(data.editor.collectionId).toBeNull()
    } finally {
      off()
    }
  })

  it('carries the page chosen, so the Design screen opens that page and not the first', async () => {
    const off = registerScreens(() => Promise.resolve(undefined))
    try {
      for (const pageFirst of [false, true]) {
        const { editor } = await bootData({}, {}, 'data')
        if (pageFirst) editor.selectPage('pg_new_post')
        editor.mode = 'build'
        if (!pageFirst) editor.selectPage('pg_new_post')
        await settle()
        const next = await bootData()
        expect(next.editor.pageId).toBe('pg_new_post')
      }
    } finally {
      off()
    }
  })

  it('without a shell the view just changes', async () => {
    const { editor } = await bootData()
    editor.mode = 'data'
    expect(editor.mode).toBe('data')
  })
})

describe('the Data workspace selection (S2)', () => {
  it('gives a collection Rows, Fields, Endpoints and JSON, and a connection Endpoints and JSON', async () => {
    const { editor } = await bootData()
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
    expect(editor.dataTabs).toEqual(['rows', 'fields', 'endpoints', 'json'])
    expect(editor.dataTab).toBe('rows')
    editor.connectionId = 'ds_quotes'
    expect(editor.dataItem).toEqual({ kind: 'connection', id: 'ds_quotes' })
    expect(editor.dataTabs).toEqual(['endpoints', 'json'])
    expect(editor.dataTab).toBe('endpoints')
  })

  it('keeps the tab chosen across collections, and falls back to the first one a connection has', async () => {
    const { editor } = await bootData()
    editor.dataTab = 'fields'
    editor.collectionId = 'ent_quote'
    expect(editor.dataTab).toBe('fields')
    editor.connectionId = 'ds_quotes'
    expect(editor.dataTab).toBe('endpoints')
    editor.dataTab = 'json'
    editor.connectionId = null
    expect(editor.dataTab).toBe('json')
  })

  it('narrows the shown item: dataCollection for a collection, dataConnection for a connection, one of them at a time', async () => {
    const { editor } = await bootData()
    expect(editor.dataCollection?.id).toBe('ent_post')
    expect(editor.dataConnection).toBeNull()
    editor.connectionId = 'ds_quotes'
    expect(editor.dataCollection).toBeNull()
    expect(editor.dataConnection?.id).toBe('ds_quotes')
  })

  it('has no item and no tab when the project has no collection and no connection is chosen', async () => {
    world.model.modules.blog!.entities = []
    world.model.modules.blog!.repositories = []
    const { editor } = await bootData()
    expect(editor.dataItem).toBeNull()
    expect(editor.dataTabs).toEqual([])
  })

  it('shows the sample data on the Sample data side of the switch even when the app answers, and the app\'s rows on Live', async () => {
    const { editor } = await bootData({ '/api/blog/posts': { items: [post('one'), post('two'), post('three')], total: 3 } })
    editor.mode = 'data'
    await settle()
    expect(editor.rowsSource).toBe('live')
    editor.rowsPreference = 'sample'
    expect(editor.rowsSource).toBe('sample')
    expect(editor.collectionRows.map(row => row.slug)).toEqual(['hello-bildr', 'a-draft'])
    editor.rowsPreference = 'live'
    expect(editor.rowsSource).toBe('live')
  })

  it('has no sample data for a REST collection: it is always Live', async () => {
    const { editor } = await bootData({ '/api/blog/quotes': { items: [{ id: 1, text: 'Q', author: 'A' }], total: 1 } })
    editor.mode = 'data'
    editor.collectionId = 'ent_quote'
    editor.rowsPreference = 'sample'
    await settle()
    expect(editor.rowsSource).toBe('live')
  })
})

describe('the Data location in the URL query (S2)', () => {
  it('reads the item and the tab', () => {
    expect(parseDataLocation({ item: 'collection:ent_post', tab: 'fields' })).toEqual({ item: { kind: 'collection', id: 'ent_post' }, tab: 'fields' })
    expect(parseDataLocation({ item: 'connection:ds_quotes', tab: 'json' })).toEqual({ item: { kind: 'connection', id: 'ds_quotes' }, tab: 'json' })
  })

  it('does not take a name Object.prototype has for a tab', () => {
    for (const tab of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(parseDataLocation({ item: 'collection:ent_post', tab })).toEqual({ item: { kind: 'collection', id: 'ent_post' } })
  })

  it('ignores what is malformed or unknown instead of failing', () => {
    expect(parseDataLocation({})).toEqual({})
    expect(parseDataLocation({ item: 'page:pg_index', tab: 'nope' })).toEqual({})
    expect(parseDataLocation({ item: 'collection:', tab: ['rows', 'fields'] })).toEqual({})
    expect(parseDataLocation({ item: ['collection:ent_post'] })).toEqual({})
  })

  it('writes the item and the tab back as they were read', () => {
    const query = dataLocationQuery({ kind: 'connection', id: 'ds_quotes' }, 'endpoints')
    expect(query).toEqual({ item: 'connection:ds_quotes', tab: 'endpoints' })
    expect(parseDataLocation(query)).toEqual({ item: { kind: 'connection', id: 'ds_quotes' }, tab: 'endpoints' })
  })

  it('reads All model files, and the file chosen in it (S3)', () => {
    expect(parseDataLocation({ item: 'files' })).toEqual({ files: true })
    expect(parseDataLocation({ item: 'files', file: '.bildr/theme.json' })).toEqual({ files: true, file: '.bildr/theme.json' })
    // A tab belongs to a collection or a connection, not to the files.
    expect(parseDataLocation({ item: 'files', tab: 'fields' })).toEqual({ files: true })
  })

  it('takes only a .bildr/ path for the file, and only with All model files', () => {
    for (const file of ['', 'package.json', '../.bildr/x.json', ['.bildr/theme.json'], 7]) expect(parseDataLocation({ item: 'files', file })).toEqual({ files: true })
    expect(parseDataLocation({ item: 'collection:ent_post', file: '.bildr/theme.json' })).toEqual({ item: { kind: 'collection', id: 'ent_post' } })
    expect(parseDataLocation({ file: '.bildr/theme.json' })).toEqual({})
  })

  it('writes All model files back as it was read, with the file when one is chosen', () => {
    expect(filesLocationQuery(null)).toEqual({ item: 'files' })
    expect(filesLocationQuery('.bildr/theme.json')).toEqual({ item: 'files', file: '.bildr/theme.json' })
    expect(parseDataLocation(filesLocationQuery('.bildr/theme.json'))).toEqual({ files: true, file: '.bildr/theme.json' })
  })
})

describe('Queries and Actions in the Data workspace (S10)', () => {
  it('lists the model\'s queries and actions with their label and collection', async () => {
    const { editor } = await bootData()
    expect(editor.queries.map(query => [query.id, query.label, query.collectionName])).toEqual([
      ['q_all_posts', 'All posts', 'Post'],
      ['q_featured_posts', 'Featured posts', 'Post'],
      ['q_latest_quotes', 'Latest quotes', 'Quote'],
      ['q_post_by_slug', 'Post by slug', 'Post']
    ])
    expect(editor.actions.map(action => [action.id, action.label, action.collectionName])).toEqual([
      ['act_create_post', 'Create post', 'Post'],
      ['act_publish_post', 'Publish post', 'Post']
    ])
  })

  it('follows the model: a query added elsewhere appears, and the label falls back to the name', async () => {
    const { editor, design } = await bootData()
    world.model.modules.blog!.queries.push({ ...structuredClone(world.model.modules.blog!.queries[0]!), id: 'q_extra', name: 'extraPosts', label: '' })
    await design.refresh()
    expect(editor.queries.find(query => query.id === 'q_extra')?.label).toBe('extraPosts')
  })

  it('gives a query Results, Definition, Used in and JSON, and an action Overview, Used in and JSON (D10c puts Steps between)', async () => {
    const { editor } = await bootData()
    editor.queryId = 'q_featured_posts'
    expect(editor.dataItem).toEqual({ kind: 'query', id: 'q_featured_posts' })
    expect(editor.dataTabs).toEqual(['results', 'definition', 'used', 'json'])
    expect(editor.dataTab).toBe('results')
    expect(editor.dataQuery?.id).toBe('q_featured_posts')
    expect(editor.dataCollection).toBeNull()
    expect(editor.dataAction).toBeNull()
    editor.actionId = 'act_create_post'
    expect(editor.dataItem).toEqual({ kind: 'action', id: 'act_create_post' })
    expect(editor.dataTabs).toEqual(['overview', 'used', 'json'])
    expect(editor.dataTab).toBe('overview')
    expect(editor.dataAction?.id).toBe('act_create_post')
    expect(editor.dataQuery).toBeNull()
    expect(tabsOf('query')).toEqual(['results', 'definition', 'used', 'json'])
    expect(tabsOf('action')).toEqual(['overview', 'used', 'json'])
  })

  it('keeps the tab chosen for the next item that has it, and gives way to a collection or a connection chosen', async () => {
    const { editor } = await bootData()
    editor.queryId = 'q_featured_posts'
    editor.dataTab = 'json'
    editor.queryId = 'q_all_posts'
    expect(editor.dataTab).toBe('json')
    editor.collectionId = 'ent_post'
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
    editor.actionId = 'act_publish_post'
    editor.connectionId = 'ds_quotes'
    expect(editor.dataItem).toEqual({ kind: 'connection', id: 'ds_quotes' })
    editor.queryId = 'q_all_posts'
    expect(editor.dataItem).toEqual({ kind: 'query', id: 'q_all_posts' })
    editor.dataFiles = true
    editor.actionId = 'act_publish_post'
    expect(editor.dataFiles).toBe(false)
    expect(editor.dataItem).toEqual({ kind: 'action', id: 'act_publish_post' })
  })

  it('falls back to the first collection when the query or action shown is gone', async () => {
    const { editor, design } = await bootData()
    editor.queryId = 'q_all_posts'
    world.model.modules.blog!.queries = world.model.modules.blog!.queries.filter(query => query.id !== 'q_all_posts')
    await design.refresh()
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
    editor.actionId = 'act_nope'
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
  })

  it('does not show a query made later with the id of one that was shown and deleted', async () => {
    const { editor, design } = await bootData()
    const [first] = world.model.modules.blog!.queries
    editor.queryId = first!.id
    world.model.modules.blog!.queries = world.model.modules.blog!.queries.filter(query => query.id !== first!.id)
    await design.refresh()
    await settle()
    expect(editor.queryId).toBeNull()
    world.model.modules.blog!.queries.unshift(first!)
    await design.refresh()
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
  })

  it('reads the rows of the query\'s collection, not of the one shown before: Sample data and Live', async () => {
    const { editor } = await bootData({ '/api/blog/quotes': { items: [{ id: 1, text: 'Q one', author: 'Ann' }], total: 1 } })
    editor.mode = 'data'
    editor.queryId = 'q_featured_posts'
    await settle()
    expect(editor.collectionRows.map(row => row.slug)).toEqual(['hello-bildr', 'a-draft'])
    expect(editor.rowsSource).toBe('sample')
    editor.queryId = 'q_latest_quotes'
    await settle()
    expect(editor.rowsSource).toBe('live')
    expect(editor.collectionRows.map(row => row.text)).toEqual(['Q one'])
  })
})

describe('the Data tree of queries and actions (S10)', () => {
  const artifact = (id: string, label: string) => ({ id, name: id, label, module: 'blog', collectionId: 'ent_post', collectionName: 'Post' })

  it('lists Collections, Connections, Queries, Actions and All model files, in that order', async () => {
    const { editor } = await bootData()
    const keys = treeItems(editor.collections, editor.connections, new Set(), { queries: editor.queries, actions: editor.actions }).map(item => item.key)
    expect(keys).toEqual([
      'collection:ent_post', 'connection:ds_quotes', 'collection:ent_quote',
      'query:q_all_posts', 'query:q_featured_posts', 'query:q_latest_quotes', 'query:q_post_by_slug',
      'action:act_create_post', 'action:act_publish_post',
      'files'
    ])
  })

  it('keeps the queries and actions of a folded connection\'s collections listed: they are top level', async () => {
    const { editor } = await bootData()
    const keys = treeItems(editor.collections, editor.connections, new Set(['ds_quotes']), { queries: editor.queries, actions: [] }).map(item => item.key)
    expect(keys).toEqual(['collection:ent_post', 'connection:ds_quotes', 'query:q_all_posts', 'query:q_featured_posts', 'query:q_latest_quotes', 'query:q_post_by_slug', 'files'])
  })

  it('lists only the items that match a section\'s filter (label, name or collection, any case)', () => {
    const queries = [artifact('q_a', 'Recent posts'), { ...artifact('q_b', 'Top'), collectionName: 'Quote' }]
    const keys = (filter: string) => treeItems([], [], new Set(), { queries, actions: [] }, { queries: filter, actions: '' }).map(item => item.key)
    expect(keys('')).toEqual(['query:q_a', 'query:q_b', 'files'])
    expect(keys('RECENT')).toEqual(['query:q_a', 'files'])
    expect(keys('quote')).toEqual(['query:q_b', 'files'])
    expect(keys('q_b')).toEqual(['query:q_b', 'files'])
    expect(keys('zzz')).toEqual(['files'])
  })
})

describe('opening a use on the Canvas (S10)', () => {
  it('carries the page, and the component or layout, to the screen that opens', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      const { editor } = await bootData({}, {}, 'data')
      editor.selectPage('pg_index')
      editor.editComponent('cmp_post_card')
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data).toMatchObject({ pageId: 'pg_index', fileId: 'cmp_post_card' })
      // It is taken once: nothing is left for the next editor.
      expect(takeStart().data).toEqual({})
    } finally {
      off()
    }
  })

  it('carries a layout the same way, and not the component carried before it', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      const { editor } = await bootData({}, {}, 'data')
      editor.editComponent('cmp_post_card')
      expect(takeStart().data.fileId).toBe('cmp_post_card')
      // Back on the Data screen, another use is opened: the layout, not the component of the first.
      editor.mode = 'data'
      editor.editLayout('lay_main')
      expect(opened).toHaveBeenCalledTimes(2)
      expect(takeStart().data.fileId).toBe('lay_main')
    } finally {
      off()
    }
  })

  it('does not carry a file when a page is opened after one was', async () => {
    const off = registerScreens(() => undefined)
    try {
      const { editor } = await bootData({}, {}, 'data')
      editor.editComponent('cmp_post_card')
      expect(takeStart().data.fileId).toBe('cmp_post_card')
      editor.mode = 'data'
      editor.selectPage('pg_index')
      editor.mode = 'build'
      const start = takeStart().data
      expect(start.pageId).toBe('pg_index')
      expect(start.fileId).toBeUndefined()
      expect('fileId' in start).toBe(false)
    } finally {
      off()
    }
  })

  it('opens the component or layout a Data screen handed over, in its own view, on the page that was carried', async () => {
    const off = registerScreens(() => undefined)
    try {
      const { editor } = await bootData({}, {}, 'data')
      editor.selectPage('pg_index')
      editor.editComponent('cmp_post_card')
      // The Design screen's editor is made next: it takes what was handed over.
      const design = createDesign()
      const next = createEditor(design)
      disposers.push(() => design.dispose())
      await next.start()
      await settle()
      expect(next.mode).toBe('build')
      expect(next.componentId).toBe('cmp_post_card')
      expect(next.pageId).toBe('pg_index')
    } finally {
      off()
    }
  })

  it('opens a layout the same way', async () => {
    const off = registerScreens(() => undefined)
    try {
      const { editor } = await bootData({}, {}, 'data')
      editor.editLayout('lay_main')
      const design = createDesign()
      const next = createEditor(design)
      disposers.push(() => design.dispose())
      await next.start()
      await settle()
      expect(next.layoutId).toBe('lay_main')
    } finally {
      off()
    }
  })
})

describe('the Data location of a query or an action (S10)', () => {
  it('reads and writes the item and the tab, as for a collection', () => {
    expect(parseDataLocation({ item: 'query:q_featured_posts', tab: 'definition' })).toEqual({ item: { kind: 'query', id: 'q_featured_posts' }, tab: 'definition' })
    expect(parseDataLocation({ item: 'action:act_create_post', tab: 'overview' })).toEqual({ item: { kind: 'action', id: 'act_create_post' }, tab: 'overview' })
    expect(dataLocationQuery({ kind: 'query', id: 'q_all_posts' }, 'used')).toEqual({ item: 'query:q_all_posts', tab: 'used' })
    expect(parseDataLocation(dataLocationQuery({ kind: 'action', id: 'act_x' }, 'json'))).toEqual({ item: { kind: 'action', id: 'act_x' }, tab: 'json' })
  })
})

describe('All model files in the Data workspace (S3)', () => {
  it('is shown instead of the item, which it keeps, and has no tabs', async () => {
    const { editor } = await bootData()
    expect(editor.dataFiles).toBe(false)
    editor.dataFiles = true
    expect(editor.dataFiles).toBe(true)
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
    expect(editor.dataFile).toBeNull()
  })

  it('gives way to a collection or a connection chosen, however it is chosen', async () => {
    const { editor } = await bootData()
    editor.dataFiles = true
    editor.collectionId = 'ent_post'
    expect(editor.dataFiles).toBe(false)
    editor.dataFiles = true
    editor.connectionId = 'ds_quotes'
    expect(editor.dataFiles).toBe(false)
    expect(editor.dataItem).toEqual({ kind: 'connection', id: 'ds_quotes' })
  })

  it('is shown for a new collection, which is chosen', async () => {
    const { editor } = await bootData({}, { entity_create: () => ({ entityId: 'ent_untitled' }) })
    editor.dataFiles = true
    await editor.createCollection('Untitled')
    expect(editor.dataFiles).toBe(false)
  })
})
