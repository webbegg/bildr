import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesign } from '../../src/design/store.ts'
import { createEditor } from '../../src/editor/useEditor.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { liveRows } from '../../src/design/liveRows.ts'
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
    expect(editor.rowsSource).toBe('fixtures')
    expect(editor.recordsError).toBe('could not be reached')
    expect(editor.recordsTotal).toBe(2)
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
      expect(editor.rowsSource).toBe('fixtures')
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

  it('closes the open record when another collection is shown', async () => {
    const { editor } = await bootData()
    editor.recordId = 'x'
    editor.collectionId = 'ent_quote'
    await settle()
    expect(editor.recordId).toBeNull()
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

  it('without a shell the view just changes', async () => {
    const { editor } = await bootData()
    editor.mode = 'data'
    expect(editor.mode).toBe('data')
  })
})
