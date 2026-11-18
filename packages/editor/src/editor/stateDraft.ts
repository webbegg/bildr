import type { StateFile, Value } from '@bildr/codegen/model'
import type { FieldType } from '../shared/dataModel.ts'
import { sameJson } from './draftJson.ts'

/**
 * The State Fields form's draft (B2, S1): a state's fields as the form holds them (a text in every default box, a choice for
 * whether it is required) and what saving them asks of `state_update`. A state's fields are saved as one list, so the input is the
 * whole list, each field with its id (so the module matches it to the field it is, even renamed), in the order the draft has: a
 * field left out is removed. `changesOf` is that list, or null when nothing changed, or the problems a box has that make it
 * unsendable. The module checks the rest (a default that fits the type, a name that is free, a field a page still uses) and its
 * refusal is shown next to the field it names (`fieldOfRefusal`).
 */

type StateField = StateFile['fields'][number]

export interface DraftField {
  /** What names the row in the form: the field's id, or `new_<n>` for one added here. */
  key: string
  /** The field's id; `''` for a field that is not saved yet. */
  id: string
  name: string
  type: FieldType
  required: boolean
  /** The default as typed (`''`: none); a toggle's is `true` or `false`, a date's `YYYY-MM-DD`, a date and time's `YYYY-MM-DDTHH:MM`. */
  default: string
}

export interface StateDraft {
  fields: DraftField[]
}

const textOf = (value: Value | undefined): string => value === undefined || value === null ? '' : String(value)

const fieldDraftOf = (field: StateField): DraftField => ({ key: field.id, id: field.id, name: field.name, type: field.type as FieldType, required: field.required === true, default: textOf(field.default) })

/** The draft of a state as it is now. */
export const draftOf = (state: StateFile): StateDraft => ({ fields: state.fields.map(fieldDraftOf) })

let made = 0
/** A field the form adds: a text field with no name and no default, which has no id until it is saved. */
export const newField = (): DraftField => ({ key: `new_${++made}`, id: '', name: '', type: 'text', required: false, default: '' })

/** The draft with the field at `from` moved to position `to`. */
export function moveField(draft: StateDraft, from: number, to: number): StateDraft {
  const fields = [...draft.fields]
  const [moved] = fields.splice(from, 1)
  if (moved) fields.splice(to, 0, moved)
  return { fields }
}

const DATETIME_LOCAL = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/

/** The default a text stands for in a field of `type`: its value, none (an empty box), or what the text is not. */
function valueOfDefault(type: FieldType, text: string): { value: Value } | { none: true } | { problem: string } {
  const typed = String(text).trim()
  if (typed === '') return { none: true }
  if (type === 'integer') return /^[+-]?\d+$/.test(typed) ? { value: Number(typed) } : { problem: 'a whole number' }
  if (type === 'number') return Number.isFinite(Number(typed)) ? { value: Number(typed) } : { problem: 'a number' }
  if (type === 'boolean') return typed === 'true' || typed === 'false' ? { value: typed === 'true' } : { problem: 'true or false' }
  // The browser's date and time box has no seconds or zone: the state keeps them as UTC.
  if (type === 'datetime' && DATETIME_LOCAL.test(typed)) return { value: `${typed}:00Z` }
  return { value: text }
}

export interface StateChanges {
  /** The `state_update` `fields` input, in the draft's order; null when nothing changed or the draft can't be sent. */
  fields: Array<Record<string, unknown>> | null
  /** What stops the draft from being sent, for each box that has such a problem. */
  problems: string[]
}

/**
 * What saving `draft` asks of the module: the whole list of fields, or the problems that stop it. `base` is the state the draft
 * started from (when it was opened or last saved), not the state as stored now. A field the user did not touch is sent as it is
 * stored, never converted back from its text; a touched one keeps its stored default when its box was not touched.
 */
export function changesOf(draft: StateDraft, base: StateFile): StateChanges {
  const opened = draftOf(base).fields
  if (sameJson(draft.fields, opened)) return { fields: null, problems: [] }
  const problems: string[] = []
  const fields = draft.fields.map((field) => {
    const before = base.fields.find(entry => entry.id === field.id)
    const first = opened.find(entry => entry.key === field.key)
    if (before && first && sameJson(field, first)) return { id: before.id, name: before.name, type: before.type, ...before.required ? { required: true } : {}, ...before.default !== undefined ? { default: before.default } : {} }
    const name = field.name.trim()
    if (!name && !problems.includes('Name every field')) problems.push('Name every field')
    let given: Record<string, unknown> = {}
    if (before && first && field.default === first.default && field.type === before.type) {
      if (before.default !== undefined) given = { default: before.default }
    } else {
      const converted = valueOfDefault(field.type, field.default)
      if ('problem' in converted) problems.push(`${name || '(unnamed)'}: its default is ${converted.problem}`)
      else if ('value' in converted) given = { default: converted.value }
    }
    return { ...field.id ? { id: field.id } : {}, name, type: field.type, ...field.required ? { required: true } : {}, ...given }
  })
  return problems.length ? { fields: null, problems } : { fields, problems }
}

/** The part of a field the form edits. */
const editable = (field: StateField) => ({ id: field.id, name: field.name, type: field.type, required: field.required === true, default: field.default ?? null })

/**
 * Whether the state as it is stored now differs, in a part the form edits (its fields: their order, names, types, defaults and
 * whether they are required), from the state the draft started from. Its label, its persistence or its name changing is not one.
 */
export const changedOutside = (base: StateFile, stored: StateFile): boolean => !sameJson(base.fields.map(editable), stored.fields.map(editable))

/**
 * The draft after the user chose to keep their edits over a state that changed under them: a field they did not touch shows the
 * stored one's (and is gone when it was removed elsewhere), a field they touched or added stays, a field they removed stays removed,
 * and a field added elsewhere is added at the end. So, saved against the stored state as the new base, only what they did is theirs.
 */
export function rebaseDraft(draft: StateDraft, base: StateFile, stored: StateFile): StateDraft {
  const before = draftOf(base).fields
  const now = draftOf(stored).fields
  const fields: DraftField[] = []
  for (const field of draft.fields) {
    const opened = before.find(entry => entry.key === field.key)
    if (opened && sameJson(field, opened)) {
      const current = now.find(entry => entry.key === field.key)
      if (current) fields.push(current)
    } else if (opened && !now.some(entry => entry.key === field.key)) {
      // Touched here, removed elsewhere: it is a new field again.
      fields.push({ ...field, id: '' })
    } else {
      fields.push(field)
    }
  }
  const addedElsewhere = now.filter(entry => !before.some(known => known.key === entry.key) && !fields.some(kept => kept.key === entry.key))
  return { fields: [...fields, ...addedElsewhere] }
}

/**
 * The field a refusal of `state_update` is about, by the key of its row: the module names it ("The field showDrafts of the state …
 * is still used", "perPage: the default … doesn't fit", "Two fields are named …"). It names a saved field by the name it has saved
 * (`saved`, the state's fields), which the draft may have renamed. Null for a refusal about something else.
 */
export function fieldOfRefusal(message: string, fields: readonly DraftField[], saved: ReadonlyArray<{ id: string, name: string }> = []): string | null {
  const name = /^The field (\S+) of the state /.exec(message)?.[1] ?? /^Two fields are named "([^"]+)"/.exec(message)?.[1] ?? /^(\S+): /.exec(message)?.[1]
  if (!name) return null
  return (fields.find(field => field.name.trim() === name) ?? fields.find(field => field.id !== '' && saved.find(entry => entry.id === field.id)?.name === name))?.key ?? null
}
