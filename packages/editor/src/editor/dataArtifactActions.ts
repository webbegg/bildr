import type { RefusedField } from '../api.ts'
import type { UseEntry } from '../shared/dataArtifacts.ts'
import { itemOfUse } from '../shared/items.ts'
import { openItem } from './openItem.ts'
import type { Editor } from './useEditor.ts'

/**
 * What the Queries and Actions of the Data workspace (S10) ask of the editor, which the pure reads of
 * `shared/dataArtifacts.ts` cannot: how a dialog or a form runs a module action and takes its refusal, and the way a use is opened
 * on the Canvas.
 */

/**
 * Runs a module action and, when the module refuses it, takes the refusal for the caller to show where the user is typing
 * (a dialog, a form) instead of the screen's banner. `error` is its message, `code` the module's code for it (`conflict`, …), and
 * `field` the field of a list the refusal is about, when the module says (a state's fields).
 */
export async function attempt<T extends Record<string, unknown>>(editor: Editor, name: string, input: Record<string, unknown>, fallback: string): Promise<{ result: T } | Refusal> {
  const result = await editor.run(name, input) as T | undefined
  if (result) return { result }
  return takeRefusal(editor, fallback)
}

/** The refusal the editor holds (else `fallback`), taken off the screen's banner for the caller to show where the user is typing. */
export function takeRefusal(editor: Editor, fallback: string): Refusal {
  const error = editor.error ?? fallback
  const code = editor.errorCode ?? undefined
  const field = editor.errorField ?? undefined
  editor.dismissError()
  return { error, ...(code ? { code } : {}), ...(field ? { field } : {}) }
}

/** What a refusal the caller shows is: its message, the module's code for it and the field of a list it is about. */
export interface Refusal {
  error: string
  code?: string
  field?: RefusedField
}

/**
 * Opens the place a use is in: a page, component or layout on the Canvas, or an action, a query or a collection in the Data
 * workspace. The use says `entity` for a collection (the usage index's word); `openItem`, which every open goes through, says `collection`.
 */
export const openUse = (editor: Editor, use: Pick<UseEntry, 'kind' | 'id'>): Promise<boolean> => openItem(itemOfUse(use), { editor })
