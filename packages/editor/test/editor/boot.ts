import { afterEach } from 'vitest'
import { createDesign } from '../../src/design/store.ts'
import { createEditor } from '../../src/editor/useEditor.ts'
import type { EditorToast } from '../../src/editor/useEditor.ts'
import { mockActions, settle } from '../helpers.ts'
import { baseHandlers, setupHarness } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'

export { world, find, indexPage, postCard, mainLayout, FakeEventSource } from '../design/harness.ts'
export { Failure } from '../helpers.ts'

/**
 * The adapter's test harness (U2): the blog fixture served by the mocked
 * actions (the harness of the Design screen, which also checks every call
 * against the real action schemas), a store, and the adapter over it.
 * `ok()` answers a write; each test reads the calls the adapter made.
 */

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

export { setupHarness }

export const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })

/** Boots the store and the adapter on the fixture's first page (or `file`). */
export const boot = async (extra: Handlers = {}, file?: string) => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...extra })
  const design = createDesign()
  const toasts: EditorToast[] = []
  const editor = createEditor(design, { toast: toast => toasts.push(toast) })
  disposers.push(() => design.dispose())
  await editor.start()
  await settle()
  if (file) {
    editor.selectPage(file)
    await settle()
  }
  return { actions, design, editor, toasts }
}

/** Opens a component or layout in the editor (as Assets does). */
export const openIn = async (editor: Awaited<ReturnType<typeof boot>>['editor'], kind: 'component' | 'layout', id: string) => {
  if (kind === 'component') editor.editComponent(id)
  else editor.editLayout(id)
  await settle()
}
