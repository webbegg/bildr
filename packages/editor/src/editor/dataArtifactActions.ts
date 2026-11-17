import type { UseEntry } from '../shared/dataArtifacts.ts'
import type { Editor } from './useEditor.ts'

/**
 * What the Queries and Actions of the Data workspace (S10) ask of the editor, which the pure reads of
 * `shared/dataArtifacts.ts` cannot: how a dialog or a form runs a module action and takes its refusal, and the way a use is opened
 * on the Canvas.
 */

/**
 * Runs a module action and, when the module refuses it, takes the refusal for the caller to show where the user is typing
 * (a dialog, a form) instead of the screen's banner. `error` is its message, and `code` the module's code for it (`conflict`, …).
 */
export async function attempt<T extends Record<string, unknown>>(editor: Editor, name: string, input: Record<string, unknown>, fallback: string): Promise<{ result: T } | { error: string, code?: string }> {
  const result = await editor.run(name, input) as T | undefined
  if (result) return { result }
  const error = editor.error ?? fallback
  const code = editor.errorCode ?? undefined
  editor.dismissError()
  return { error, ...(code ? { code } : {}) }
}

/**
 * Opens the place a use is in: a page, component or layout on the Canvas (the Design screen, which opens it as it does for a
 * collection's detail page), or an action in the Data workspace.
 */
export function openUse(editor: Editor, use: Pick<UseEntry, 'kind' | 'id'>): void {
  if (use.kind === 'action') {
    editor.actionId = use.id
    editor.mode = 'data'
  } else if (use.kind === 'page') {
    editor.mode = 'build'
    editor.sidebarPanel = 'pages'
    editor.selectPage(use.id)
  } else {
    editor.sidebarPanel = 'assets'
    if (use.kind === 'component') editor.editComponent(use.id)
    else editor.editLayout(use.id)
  }
}
