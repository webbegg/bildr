import type { ConfirmOptions, Editor } from './useEditor.ts'
import { collectionUses, fieldUses, outsideOf, usedInWords } from '../shared/dataUsage.ts'

/**
 * The warnings before a delete or a rename of a collection or a field that is used (S5, DW-4): each asks through the editor's
 * confirm, with the places that use it as links, and resolves whether to go on. They ask nothing when nothing outside uses it.
 *
 * What the module does decides what is said. `entity_delete` and `entity_field_remove` refuse while a page, a component, a query
 * or an action outside uses what is deleted (`blocked`: the button is disabled, with the places as the reason), and
 * `entity_field_update` refuses a rename for the same places: it does not rewrite a binding, a condition or a step, so those are
 * changed first. The places it changes itself (`follows`: a collection's own actions, an action's pick of a field: every create action
 * picks every field) are listed beside the others, but not counted, and alone they ask nothing. `entity_update` renames a collection by its id: its places keep working, and hand-written code that imports the
 * generated names is the only thing to change.
 */

const them = (count: number) => count === 1 ? 'it' : 'them'

/** Delete: `description` is what the delete says when nothing blocks it. */
export function confirmDeleteCollection(editor: Editor, collection: { id: string, name: string }): Promise<boolean> {
  const uses = collectionUses(editor.model, collection.id)
  const count = outsideOf(uses).length
  const options: ConfirmOptions = { title: `Delete collection "${collection.name}"?`, description: 'The collection goes with its repository, queries, create action and sample data. Undo brings it back.', confirmLabel: 'Delete collection', danger: true }
  if (!count) return editor.confirm(options)
  return editor.confirm({
    ...options,
    description: `${usedInWords(count)}. A collection can't be deleted while it is used: change ${them(count)} first.`,
    uses,
    followsLabel: 'Goes with it',
    blocked: `${usedInWords(count)}: change ${them(count)} first`
  })
}

/** Rename of the collection's name or plural: only warns, the places keep working. */
export function confirmRenameCollection(editor: Editor, collection: { id: string, name: string }, change: 'name' | 'plural', next: string): Promise<boolean> {
  const uses = outsideOf(collectionUses(editor.model, collection.id))
  if (!uses.length) return Promise.resolve(true)
  const code = change === 'name' ? 'Hand-written code that imports its generated names' : 'The plural names the generated code and the list route: hand-written code that imports them'
  return editor.confirm({
    title: change === 'name' ? `Rename collection "${collection.name}" to "${next}"?` : `Change the plural of "${collection.name}" to "${next}"?`,
    description: `${usedInWords(uses.length)}. They refer to it by id, so they keep working. ${code} needs the same rename.`,
    uses,
    confirmLabel: 'Rename'
  })
}

/** Remove a field: `rows` is whether the collection has rows, whose stored values stay. */
export function confirmRemoveField(editor: Editor, collection: { id: string }, field: string, rows: boolean): Promise<boolean> {
  const uses = fieldUses(editor.model, collection.id, field)
  const count = outsideOf(uses).length
  const options: ConfirmOptions = { title: `Remove the field "${field}"?`, description: 'Its values stay in the rows already stored. Undo brings the field back.', confirmLabel: 'Remove field', danger: true }
  if (count) {
    return editor.confirm({
      ...options,
      description: `${usedInWords(count)}. A field can't be removed while it is used: change ${them(count)} first.`,
      uses,
      followsLabel: 'Follows it',
      blocked: `${usedInWords(count)}: change ${them(count)} first`
    })
  }
  return rows ? editor.confirm(options) : Promise.resolve(true)
}

/** Rename a field: refused while it is used, since the places that name it are not rewritten. */
export function confirmRenameField(editor: Editor, collection: { id: string }, field: string, next: string): Promise<boolean> {
  const uses = fieldUses(editor.model, collection.id, field)
  const count = outsideOf(uses).length
  const options: ConfirmOptions = { title: `Rename the field "${field}" to "${next}"?`, confirmLabel: 'Rename field' }
  if (count) {
    return editor.confirm({
      ...options,
      description: `${usedInWords(count)}. A field can't be renamed while it is used: the places that name it are not rewritten. Change ${them(count)} first.`,
      uses,
      followsLabel: 'Follows it',
      blocked: `${usedInWords(count)}: change ${them(count)} first`
    })
  }
  return Promise.resolve(true)
}
