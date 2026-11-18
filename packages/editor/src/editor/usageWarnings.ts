import type { ConfirmOptions, Editor } from './useEditor.ts'
import { UPDATED_AUTOMATICALLY } from '../shared/dataArtifacts.ts'
import type { UseEntry } from '../shared/dataArtifacts.ts'
import { blockingUses, collectionUses, fieldUses, stateFieldUses, them, usedInWords } from '../shared/dataUsage.ts'

/**
 * The warnings before a delete or a rename of a collection or a field that is used: each asks through the editor's confirm, with the
 * places that use it as links, and resolves whether to go on. They ask nothing when nothing outside uses it.
 *
 * What the module does decides what is said. Deleting a collection and removing a field are refused while a page, a component, a
 * query or an action outside uses what is deleted, and so is renaming a field: pages and queries name a field directly, and the
 * module does not rewrite them. Those are `blocked`: the dialog says so and has only a Close button, with the places as links to
 * change first. A collection is the other way round: pages refer to the collection itself, not to its name, so renaming it breaks
 * nothing, and the dialog only says what to change by hand. The places the module changes itself (`follows`: a collection's own
 * actions, an action's pick of a field: every create action picks every field) are listed beside the others, tagged "Updated
 * automatically", but not counted, and alone they ask nothing.
 */

/** The line that says why some rows of a list are not counted. */
const NOT_COUNTED = `Places marked “${UPDATED_AUTOMATICALLY}” are changed for you and not counted.`

/** The line after a list that has automatic places: they are not among the ones counted. */
const notCounted = (uses: UseEntry[]): string => uses.some(use => use.follows) ? ` ${NOT_COUNTED}` : ''

/** The dialog of a change the module refuses while `name` is used: the title says so, one Close button, and the places to change first. */
function blocked(name: string, uses: UseEntry[], count: number, how: string): ConfirmOptions {
  return {
    title: `“${name}” is used in ${count} ${count === 1 ? 'place' : 'places'}`,
    description: `${how} Open ${count === 1 ? 'the place' : 'each place'} below, change ${them(count)}, then try again.${notCounted(uses)}`,
    uses,
    blocked: true,
    confirmLabel: 'Close'
  }
}

/** Delete: `uses` blocks it while a place outside uses the collection; otherwise it is the usual confirmation. */
export function confirmDeleteCollection(editor: Editor, collection: { id: string, name: string }): Promise<boolean> {
  const uses = collectionUses(editor.model, collection.id)
  const count = blockingUses(uses).length
  if (count) return editor.confirm(blocked(collection.name, uses, count, 'A collection can\'t be deleted while it is used.'))
  return editor.confirm({ title: `Delete collection "${collection.name}"?`, description: 'The collection goes with its queries, its create action and its sample data. Undo brings it back.', confirmLabel: 'Delete collection', danger: true })
}

/** Rename of the collection's name or plural: only warns, the places keep working. */
export function confirmRenameCollection(editor: Editor, collection: { id: string, name: string }, change: 'name' | 'plural', next: string): Promise<boolean> {
  const uses = collectionUses(editor.model, collection.id)
  const count = blockingUses(uses).length
  if (!count) return Promise.resolve(true)
  const which = change === 'name' ? 'name' : 'plural'
  return editor.confirm({
    title: change === 'name' ? `Rename collection "${collection.name}" to "${next}"?` : `Change the plural of "${collection.name}" to "${next}"?`,
    description: `${usedInWords(count)}.${notCounted(uses)} They follow the collection itself, not its ${which}, so they keep working. Code you wrote yourself that uses its ${which} must be renamed too.`,
    uses,
    confirmLabel: 'Rename'
  })
}

/** Remove a field: `rows` is whether the collection has rows, whose stored values stay. */
export function confirmRemoveField(editor: Editor, collection: { id: string }, field: string, { rows }: { rows: boolean }): Promise<boolean> {
  const uses = fieldUses(editor.model, collection.id, field)
  const count = blockingUses(uses).length
  if (count) return editor.confirm(blocked(field, uses, count, 'A field can\'t be removed while it is used.'))
  if (!rows) return Promise.resolve(true)
  return editor.confirm({ title: `Remove the field "${field}"?`, description: 'Its values stay in the rows already stored. Undo brings the field back.', confirmLabel: 'Remove field', danger: true })
}

/**
 * Remove a field of a state (B2): blocked while a page binds it or a step sets it, as the module refuses `state_update` for it; the places
 * are listed as links to change first. Resolves whether to go on: nothing is asked for a field nothing uses (it is only taken out of the
 * draft, and nothing is written until Save).
 */
export function confirmRemoveStateField(editor: Editor, state: { id: string }, field: string): Promise<boolean> {
  const uses = stateFieldUses(editor.model, state.id, field)
  const count = blockingUses(uses).length
  if (!count) return Promise.resolve(true)
  return editor.confirm(blocked(field, uses, count, 'A field can\'t be removed while it is used.'))
}

/**
 * Rename a field: blocked while it is used. Unlike a collection, a field is named directly by the pages and queries that use it,
 * so a new name would leave them pointing at nothing.
 */
export function confirmRenameField(editor: Editor, collection: { id: string }, field: string, next: string): Promise<boolean> {
  const uses = fieldUses(editor.model, collection.id, field)
  const count = blockingUses(uses).length
  if (!count) return Promise.resolve(true)
  return editor.confirm(blocked(field, uses, count, `A field can't be renamed to “${next}” while it is used: pages and queries name it directly, so they would stop working.`))
}
