import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import { editorCommands } from '../../src/shared/commands.ts'
import { openItem } from '../../src/editor/openItem.ts'
import { EDITOR_KEY } from '../../src/editor/useEditor.ts'
import type { Editor } from '../../src/editor/useEditor.ts'
import { takeStart } from '../../src/editor/views.ts'
import App from '../../src/App.vue'
import DesignView from '../../src/views/DesignView.vue'
import SimpleDataView from '../../src/views/SimpleDataView.vue'
import { mockActions, mountWithApp, settle } from '../helpers.ts'
import { baseHandlers, setupHarness } from '../design/harness.ts'
import { q, stateModule } from './dataKit.ts'

/**
 * Where an item opened from one Data screen or another lands (simple data, SD-1), through the real path: `openItem` on the editor of the
 * screen that is open, the editor's hand-over (`views.ts`), the shell's router (`App.vue`) and the screen that opens. The simple section
 * (`/data`) is what a hand-over opens unless it names something only the workspace has (a collection, a connection, a query, an action,
 * or a dialog of the workspace: New collection, Import from URL), which opens `/data/advanced` on it.
 */

setupHarness()

afterEach(() => {
  takeStart()
})

/** The App mounted at `path` over the mocked actions. */
const boot = async (path: string) => {
  mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...stateModule() })
  return mountWithApp(App, path)
}

/** The editor a screen made (what `useEditor()` gives the components below it). */
const editorOf = (wrapper: VueWrapper, screen: Component): Editor => {
  const found = wrapper.findComponent(screen)
  if (!found.exists()) throw new Error('that screen is not open')
  return (found.vm.$ as unknown as { provides: Record<symbol, Editor> }).provides[EDITOR_KEY as symbol]!
}

const command = (editor: Editor, id: string) => {
  const ctx = { editor, insertTypes: [], openShortcuts: vi.fn() }
  const found = editorCommands(ctx as never).find(entry => entry.id === id)
  if (!found) throw new Error(`no command ${id}`)
  return () => found.run(ctx as never)
}

const where = (router: { currentRoute: { value: { path: string, query: Record<string, unknown> } } }) => router.currentRoute.value

describe('an item opened from the Design screen', () => {
  it('opens a collection in the workspace, on that collection', async () => {
    const { wrapper, router } = await boot('/design')
    await openItem({ kind: 'collection', id: 'ent_quote' }, { editor: editorOf(wrapper, DesignView) })
    await vi.waitFor(() => expect(where(router).path).toBe('/data/advanced'))
    await settle()
    expect(where(router).query.item).toBe('collection:ent_quote')
    expect(q('[data-testid="data"]')).not.toBeNull()
    expect(q('[data-testid="simple-data"]')).toBeNull()
  })

  it('opens a query in the workspace, on that query', async () => {
    const { wrapper, router } = await boot('/design')
    await openItem({ kind: 'query', id: 'q_featured_posts' }, { editor: editorOf(wrapper, DesignView) })
    await vi.waitFor(() => expect(where(router).path).toBe('/data/advanced'))
    await settle()
    expect(where(router).query.item).toBe('query:q_featured_posts')
    expect(q('[data-testid="data"]')).not.toBeNull()
  })

  it('opens an action and a connection in the workspace too', async () => {
    const action = await boot('/design')
    await openItem({ kind: 'action', id: 'act_create_post' }, { editor: editorOf(action.wrapper, DesignView) })
    await vi.waitFor(() => expect(where(action.router).path).toBe('/data/advanced'))
    await settle()
    expect(where(action.router).query.item).toBe('action:act_create_post')
    action.wrapper.unmount()
    const connection = await boot('/design')
    await openItem({ kind: 'connection', id: 'ds_quotes' }, { editor: editorOf(connection.wrapper, DesignView) })
    await vi.waitFor(() => expect(where(connection.router).path).toBe('/data/advanced'))
    await settle()
    expect(where(connection.router).query.item).toBe('connection:ds_quotes')
  })

  it('opens the simple section on a store, and shows that store', async () => {
    const { wrapper, router } = await boot('/design')
    const editor = editorOf(wrapper, DesignView)
    editor.stateId = 'st_preferences'
    editor.mode = 'data'
    await vi.waitFor(() => expect(where(router).path).toBe('/data'))
    await settle()
    expect(where(router).query).toEqual({ item: 'state:st_preferences' })
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_preferences')
  })

  it('opens the simple section with nothing chosen when the Data view is chosen with no item', async () => {
    const { wrapper, router } = await boot('/design')
    editorOf(wrapper, DesignView).mode = 'data'
    await vi.waitFor(() => expect(where(router).path).toBe('/data'))
    await settle()
    expect(where(router).query).toEqual({})
    expect(q('[data-simple-store-form]')).toBeNull()
  })

  it.each([
    ['New collection', 'data:new-collection', '[data-new-collection-name]'],
    ['Import from URL', 'data:import-api', '[data-api-url]']
  ])('opens the workspace on the %s dialog from ⌘K', async (_label, id, dialog) => {
    const { wrapper, router } = await boot('/design')
    command(editorOf(wrapper, DesignView), id)()
    await vi.waitFor(() => expect(where(router).path).toBe('/data/advanced'))
    await settle()
    expect(q('[data-testid="data"]')).not.toBeNull()
    expect(q(dialog)).not.toBeNull()
  })
})

describe('a request made in the simple section', () => {
  it.each([
    ['New collection', 'data:new-collection', '[data-new-collection-name]'],
    ['Import from URL', 'data:import-api', '[data-api-url]']
  ])('⌘K %s opens the workspace, and the dialog', async (_label, id, dialog) => {
    const { wrapper, router } = await boot('/data')
    command(editorOf(wrapper, SimpleDataView), id)()
    await vi.waitFor(() => expect(where(router).path).toBe('/data/advanced'))
    await settle()
    expect(q('[data-testid="data"]')).not.toBeNull()
    expect(q(dialog)).not.toBeNull()
  })
})
