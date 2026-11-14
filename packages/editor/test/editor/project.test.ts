import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, isReactive, isRef } from 'vue'
import { mount } from '@vue/test-utils'
import { settle } from '../helpers.ts'
import { boot, find, indexPage, ok, setupHarness } from './boot.ts'
import { EDITOR_KEY, provideEditor, useEditor } from '../../src/editor/useEditor.ts'

/**
 * The rest of the adapter (U2): theme, history, shortcuts, the app's data, the
 * hosted members that are dropped or not available yet, and the reactive shape the
 * ported components rely on.
 */

setupHarness()

const inputs = (actions: Awaited<ReturnType<typeof boot>>['actions'], name: string) => actions.named(name).map(call => call.input)

describe('theme', () => {
  it('previewTheme shows a draft in theme without writing; updateTheme is one theme_update and drops the draft', async () => {
    const { editor, actions, design } = await boot({ theme_update: ok() }, 'pg_index')
    const before = design.theme.value
    editor.previewTheme({ colors: { primary: 'rose' }, radius: '0.5rem' })
    expect(editor.theme.colors.primary).toBe('rose')
    expect(editor.theme.radius).toBe('0.5rem')
    expect(editor.themeDraft).not.toBeNull()
    expect(actions.named('theme_update')).toHaveLength(0)
    await editor.updateTheme({ colors: { primary: 'rose' }, radius: '0.5rem' })
    expect(inputs(actions, 'theme_update')).toEqual([{ colors: { primary: 'rose' }, radius: '0.5rem' }])
    expect(editor.themeDraft).toBeNull()
    expect(editor.theme).toEqual(before)
  })
})

describe('history', () => {
  it('undo and redo are the store\'s, and only when there is a step', async () => {
    const { editor, actions } = await boot({ history_undo: ok(), history_redo: ok(), history_get: () => ({ undo: [{}], redo: [] }) }, 'pg_index')
    expect(editor.history).toEqual({ undo: 1, redo: 0 })
    await editor.undo()
    await editor.redo()
    expect(actions.named('history_undo')).toHaveLength(1)
    expect(actions.named('history_redo')).toHaveLength(0)
  })
})

describe('shortcuts', () => {
  it('⌘Z, ⇧⌘Z, ⌘D, ⌘G, Delete and Escape do what the hosted editor does', async () => {
    const { editor, actions } = await boot({ history_undo: ok(), history_redo: ok(), node_duplicate: ok({ nodeIds: ['n_c'] }), node_delete: ok(), history_get: () => ({ undo: [{}], redo: [{}] }) }, 'pg_index')
    editor.selectedId = 'n_head'
    expect(editor.shortcut('z', true, false)).toBe(true)
    expect(editor.shortcut('z', true, true)).toBe(true)
    expect(editor.shortcut('d', true, false)).toBe(true)
    await settle()
    expect(actions.calls.map(call => call.name).filter(name => name.startsWith('history_') && name !== 'history_get')).toEqual(['history_undo', 'history_redo'])
    expect(inputs(actions, 'node_duplicate')).toEqual([{ file: 'pg_index', nodeId: 'n_head' }])
    editor.selectedId = 'n_h1'
    expect(editor.shortcut('Escape', false, false)).toBe(true)
    expect(editor.selectedIds).toEqual(['n_head'])
    expect(editor.shortcut('Escape', false, false)).toBe(true)
    expect(editor.selectedIds).toEqual(['n_page'])
    expect(editor.shortcut('Escape', false, false)).toBe(true)
    expect(editor.selectedIds).toEqual([])
    editor.selectedId = 'n_about'
    expect(editor.shortcut('Delete', false, false)).toBe(true)
    await settle()
    expect(inputs(actions, 'node_delete')).toEqual([{ file: 'pg_index', nodeId: 'n_about' }])
  })

  it('tool keys arm a tool, I opens Insert, ⌘K and ⌘F ask the panels, an unknown key is not taken', async () => {
    const { editor } = await boot({}, 'pg_index')
    expect(editor.shortcut('t', false, false)).toBe(true)
    expect(editor.tool).toBe('Text')
    expect(editor.shortcut('Escape', false, false)).toBe(true)
    expect(editor.tool).toBe('move')
    expect(editor.shortcut('i', false, false)).toBe(true)
    expect(editor.insertOpen).toBe(true)
    expect(editor.shortcut('k', true, false)).toBe(true)
    expect(editor.quickOpen).toBe(true)
    const before = editor.searchRequest
    expect(editor.shortcut('f', true, false)).toBe(true)
    expect(editor.searchRequest).toBe(before + 1)
    expect(editor.shortcut('F5', false, false)).toBe(false)
  })

  it('Enter and Tab navigate only where navigation is allowed, arrows move the selection', async () => {
    const { editor, actions } = await boot({ node_move_many: ok() }, 'pg_index')
    editor.selectedId = 'n_head'
    expect(editor.shortcut('Tab', false, false)).toBe(false)
    expect(editor.shortcut('Tab', false, false, true)).toBe(true)
    expect(editor.selectedId).toBe('n_list')
    expect(editor.shortcut('ArrowDown', false, false, true)).toBe(true)
    await settle()
    expect(inputs(actions, 'node_move_many')).toEqual([{ file: 'pg_index', moves: [{ nodeId: 'n_list', parentId: 'n_page', index: 2 }] }])
  })

  it('Escape while a handle drag previews asks the canvas to cancel it instead of clearing the selection', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    editor.selectedId = 'n_head'
    design.dragging.value = 'n_head'
    editor.shortcut('Escape', false, false)
    expect(editor.dragCancels).toBe(1)
    expect(editor.selectedIds).toEqual(['n_head'])
  })

  it('⌥ + digit edits another frame and ⌘P opens the app on the page', async () => {
    const { editor } = await boot({}, 'pg_index')
    editor.showFrame('desktop')
    editor.setDevice('mobile')
    expect(editor.shortcut('1', false, false, false, { code: 'Digit1', alt: true })).toBe(true)
    expect(editor.deviceId).toBe('desktop')
    expect(editor.frameRequest).toEqual({ deviceId: 'desktop' })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    editor.shortcut('p', true, false)
    expect(open.mock.calls).toEqual([['/', '_blank']])
    open.mockRestore()
  })

  it('the Data, Design and Settings views take none of the canvas shortcuts', async () => {
    const { editor } = await boot({}, 'pg_index')
    editor.mode = 'data'
    expect(editor.shortcut('t', false, false)).toBe(false)
    expect(editor.shortcut('k', true, false)).toBe(true)
  })
})

describe('add to agent', () => {
  it('reports the file and the selection with editor_context_set', async () => {
    const { editor, actions, toasts } = await boot({}, 'pg_index')
    editor.selectedId = 'n_head'
    await editor.addToAgent()
    expect(inputs(actions, 'editor_context_set').at(-1)).toEqual({ file: 'pg_index', nodeId: 'n_head', variant: '' })
    expect(toasts.map(toast => toast.title)).toEqual(['Added to agent'])
  })
})

describe('the app\'s data', () => {
  it('the detail page\'s records and picked record are the store\'s', async () => {
    const { editor, design } = await boot({}, 'pg_post_detail')
    expect(editor.detail).toEqual(design.detail.value)
    expect(editor.detailCollection).toEqual(design.detail.value)
    expect(editor.records).toEqual(design.records.value)
    const key = editor.records[0]?.slug
    await editor.setPreviewRecord(String(key))
    expect(editor.record).toEqual(design.record.value)
    expect(editor.previewRecord).toEqual(design.record.value)
  })

  it('env lists the variables env_status reports', async () => {
    const { editor } = await boot({ env_status: () => ({ variables: [{ name: 'NUXT_X', set: false, from: null }] }) }, 'pg_index')
    expect(editor.env.map(entry => entry.name)).toEqual(['NUXT_X'])
  })
})

describe('what is not here', () => {
  it('has no hosted member that wrote to the hosted server: publish, project delete, records, theme library', async () => {
    const { editor } = await boot({}, 'pg_index')
    for (const name of ['publish', 'projectId', 'project', 'runData', 'runEnv', 'reloadRecords', 'loadMoreRecords', 'recordsTotal', 'recordsHasMore', 'recordsLimit', 'recordsError', 'recordId', 'collectionId', 'collection', 'connectionId', 'connection', 'listCollections', 'lists', 'reloadListRecords', 'publicEnv', 'variantPage']) {
      expect(editor, name).not.toHaveProperty(name)
    }
  })

  it('a detail page cannot be made from here yet: it says so in the store\'s error and writes nothing', async () => {
    const { editor, actions } = await boot({}, 'pg_index')
    const before = actions.calls.length
    await editor.setPageCollection('posts', 'slug')
    expect(editor.error).toBe('Making a page a detail page is not available yet')
    expect(await editor.createDetailPage('posts')).toBeUndefined()
    expect(editor.error).toBe('Creating a detail page is not available yet')
    expect(actions.calls.length).toBe(before)
  })
})

describe('shape', () => {
  it('is a reactive object whose members read without .value', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    expect(isReactive(editor)).toBe(true)
    expect(isRef(editor.selectedIds)).toBe(false)
    expect(Array.isArray(editor.selectedIds)).toBe(true)
    expect(typeof editor.insert).toBe('function')
    expect(editor.loading).toBe(false)
    expect(editor.files.map(file => file.id)).toEqual(design.files.value.map(file => file.id))
    for (const name of ['selectedId', 'selectedIds', 'hoveredId', 'page', 'currentPage', 'pageId', 'componentId', 'layoutId', 'editStack', 'variantId', 'mode', 'tool', 'deviceId', 'device', 'theme', 'history', 'clipboard', 'frames', 'collapsed', 'quickOpen', 'previewUrl']) {
      expect(editor, name).toHaveProperty(name)
    }
  })

  it('is provided and injected like the hosted one', async () => {
    const { editor } = await boot({}, 'pg_index')
    let injected: unknown
    const Child = defineComponent({
      setup: () => {
        injected = useEditor()
        return () => h('i')
      }
    })
    const Parent = defineComponent({
      setup: () => {
        provideEditor(editor)
        return () => h(Child)
      }
    })
    mount(Parent)
    expect(injected).toBe(editor)
    expect(EDITOR_KEY.description).toBe('bildr-editor')
    expect(() => mount(Child)).toThrow('useEditor() called outside the editor')
  })

  it('holds no document of its own: nodes are the model\'s, read as they are', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    editor.selectedId = 'n_head'
    expect(editor.model).toEqual(design.model.value)
    expect(editor.selected).toEqual(find(indexPage().root, 'n_head'))
    expect(editor.page?.root).toEqual(indexPage().root)
  })
})
