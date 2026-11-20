import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesign } from '../../src/design/store.ts'
import { openTarget } from '../../src/editor/openTarget.ts'
import type { FileTarget, Target } from '../../src/editor/findingTargets.ts'
import { createEditor } from '../../src/editor/useEditor.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { mockActions, settle } from '../helpers.ts'
import { baseHandlers, setupHarness, world } from '../design/harness.ts'

/**
 * How each kind of target is opened (S8): a generated file in Code or a model file in All model files is a route that is pushed (after asking about
 * unsaved edits when an editor is there); any other target is an item, opened as every item is (`openItem.test.ts` is where each kind is checked).
 */

setupHarness()

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  takeStart()
})

const code: FileTarget = { kind: 'code', id: 'layers/blog/app/pages/index.vue', label: 'Open file in Code', to: { path: '/code', query: { path: '.bildr/modules/blog/pages/index.json', file: 'layers/blog/app/pages/index.vue' } } }
const files: FileTarget = { kind: 'files', id: '.bildr/layouts/main.json', label: 'Open in All model files', to: { path: '/data/advanced', query: { item: 'files', file: '.bildr/layouts/main.json' } } }

const boot = async () => {
  mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }) })
  const design = createDesign()
  const editor = createEditor(design, { view: 'data' })
  disposers.push(() => design.dispose())
  await editor.start()
  await settle()
  return editor
}

describe('opening a target', () => {
  it.each([[code], [files]])('pushes the route of %j', async (target) => {
    const push = vi.fn()
    expect(await openTarget(target, { editor: null, push, model: world.model, notify: vi.fn() })).toBe(true)
    expect(push).toHaveBeenCalledWith(target.to)
  })

  it('opens an item as every item is opened: the Data workspace is pushed on it where there is no editor', async () => {
    const push = vi.fn()
    const target: Target = { kind: 'collection', id: 'ent_post', label: 'Open collection “Post”' }
    await openTarget(target, { editor: null, push, model: world.model, notify: vi.fn() })
    expect(push).toHaveBeenCalledWith({ path: '/data/advanced', query: { item: 'collection:ent_post' } })
  })

  it('opens the Design screen on a page where there is no editor', async () => {
    const open = vi.fn()
    disposers.push(registerScreens(open))
    await openTarget({ kind: 'page', id: 'pg_index', label: 'x' }, { editor: null, push: vi.fn(), model: world.model, notify: vi.fn() })
    expect(open).toHaveBeenLastCalledWith('design')
    expect(takeStart()).toEqual({ view: 'build', data: { pageId: 'pg_index' } })
  })

  it('asks first before a route leaves unsaved edits of the Data workspace, and does not push it when they are kept', async () => {
    const editor = await boot()
    editor.reportDirty().set('Post (JSON)')
    const push = vi.fn()
    const opened = openTarget(code, { editor, push })
    await settle()
    expect(editor.confirmRequest?.title).toBe('Discard unsaved changes to Post (JSON)?')
    expect(push).not.toHaveBeenCalled()
    editor.confirmRequest?.answer(false)
    expect(await opened).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('pushes the route once the unsaved edits are given up', async () => {
    const editor = await boot()
    editor.reportDirty().set('Post (JSON)')
    const push = vi.fn()
    const opened = openTarget(files, { editor, push })
    await settle()
    editor.confirmRequest?.answer(true)
    expect(await opened).toBe(true)
    expect(push).toHaveBeenCalledWith(files.to)
  })
})
