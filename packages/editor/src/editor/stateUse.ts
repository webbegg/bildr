import type { ModelNode } from '@bildr/codegen/model'
import { stateChoiceNow, statePropExpect } from '../shared/stateBinding.ts'
import type { StateChoice } from '../shared/stateBinding.ts'
import { takeRefusal } from './dataArtifactActions.ts'
import { placeOf } from './useInteractionDraft.ts'
import type { Editor } from './useEditor.ts'

/**
 * Reading a State field from a page (B4, S3 and S4) is several edits of the module, and one thing for the user: the page has to use the
 * State (`page_use_add`, under the name `choice.alias`) before a prop or a condition can bind one of its fields. `withStateUse` makes
 * the use when the page has none, then runs `write`, the edit that reads the field. When `write` is refused the use is taken off
 * again, so a refused write leaves nothing behind. A use the page had before is never touched. Returns what `write` returns, undefined
 * when it, or the use, was refused.
 *
 * **Taking back.** Each edit that was made and is then not wanted is put back by `compensate`, the last one made first (a value that
 * reads the use goes before the use does: the module refuses the use while something reads it). The refusal that caused it stays on the
 * screen (the removal's own edit would otherwise clear it). A take-back the module refuses is said plainly, next to the refusal, and
 * the edits before it are not tried: they would be refused for the one that is still there. A `write` that made an edit of its own
 * and could not take it back returns `STUCK`.
 */

/** What a write returns when it failed and could not take back what it had made. */
export const STUCK = Symbol('could not take back')

/**
 * Takes back an edit made earlier in a write that has just been refused: `undo` runs the module action that puts it back and says
 * whether it did. The refusal on the editor is kept as the message; when `undo` is refused too, `failedMessage` (what could not be taken
 * off again) and the module's reason follow it. Returns `STUCK` when the edit is still there, undefined when it is gone.
 */
export async function compensate(editor: Editor, undo: () => Promise<unknown>, failedMessage: string): Promise<typeof STUCK | undefined> {
  const refusal = takeRefusal(editor, 'The edit was refused')
  if (await undo()) {
    editor.error = refusal.error
    return undefined
  }
  editor.error = `${refusal.error}. ${failedMessage}: ${editor.error ?? 'refused'}`
  return STUCK
}

export async function withStateUse<T>(editor: Editor, pageId: string, choice: Pick<StateChoice, 'state' | 'stateLabel' | 'alias' | 'used'>, write: () => Promise<T | typeof STUCK | undefined>): Promise<T | undefined> {
  const added = !choice.used
  if (added && !await editor.run('page_use_add', { page: pageId, as: choice.alias, state: choice.state })) return undefined
  const result = await write()
  if (result !== undefined && result !== STUCK) return result
  if (!added) return undefined
  if (result === STUCK) {
    editor.error = `${editor.error ?? 'The edit was refused'}. The State ${choice.stateLabel} added to this page was left as it is`
    return undefined
  }
  await compensate(editor, () => editor.run('page_use_remove', { page: pageId, as: choice.alias }), `The State ${choice.stateLabel} could not be taken off this page again`)
  return undefined
}

/**
 * Binds a prop of a node of the page to the State field `picked` (`{ $bind: 'alias.field' }`), adding the page's use of the State first
 * when it has none. The name and the use are the page's as it is when the field is picked, not as the menu was when it was built.
 */
export function bindPropToState(editor: Editor, node: ModelNode, prop: string, picked: Pick<StateChoice, 'state' | 'field'>) {
  const place = placeOf(editor, node.id)
  const expect = statePropExpect(node.type, prop, node.props)
  const choice = editor.model && expect ? stateChoiceNow(editor.model, place, expect, picked) : undefined
  if (!choice) {
    editor.error = `The field ${picked.field} is not there to bind any more`
    return Promise.resolve(undefined)
  }
  return withStateUse(editor, place.file, choice, () => editor.runOnPage('node_update_props', { nodeId: node.id, props: { [prop]: { $bind: choice.path } } }))
}
