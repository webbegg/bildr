import type { StateFile, Value } from '@bildr/codegen/model'
import type { RefusedField } from '../api.ts'
import type { FieldType } from '../shared/dataModel.ts'
import { sameJson } from './draftJson.ts'

/**
 * The State Fields form's draft (B2, S1): a state's fields as the form holds them (a text in every default box, a choice for
 * whether it is required) and what saving them asks of `state_update`. A state's fields are saved as one list, so the input is the
 * whole list, each saved field with its id (so the module matches it to the field it is, even renamed, and a field added with a
 * saved field's old name is a new one), a field added here with none, in the order the draft has: a field left out is removed.
 * `changesOf` is that list, or null when nothing changed, or the problems a box has that make it unsendable. The module checks the
 * rest (a default that fits the type, a name that is free, a field a page still uses) and says which field a refusal is about
 * (`field`: its id, else its name), which is shown next to that field (`fieldOfRefusal`).
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
  /** The default as typed (`''`: none or empty text); a toggle's is `true` or `false`, a date's `YYYY-MM-DD`, a date and time's `YYYY-MM-DDTHH:MM`. */
  default: string
  /** A text field that starts as an empty text, which is a default (`''`), not the absence of one. Only a text field has it. */
  emptyDefault: boolean
}

export interface StateDraft {
  fields: DraftField[]
}

/** What the browser's date and time box holds: `YYYY-MM-DDTHH:MM`, no seconds and no zone. */
const DATETIME_BOX_LENGTH = 'YYYY-MM-DDTHH:MM'.length
/** What it can hand back: the minutes, or with seconds. */
const DATETIME_BOX_VALUE = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/
/** A number as it is written in a box: digits with a point and an exponent, and nothing else `Number()` would take (`0x10`, `Infinity`, `1_000`). */
const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/** What the date and time box shows of a stored date and time: its minutes, whatever seconds or zone it has. */
const boxOfDatetime = (stored: string): string => stored.slice(0, DATETIME_BOX_LENGTH)
/** The stored date and time of what the box holds: the state keeps it as UTC, with seconds. */
const datetimeOfBox = (typed: string): string => `${typed.length === DATETIME_BOX_LENGTH ? `${typed}:00` : typed}Z`

const textOf = (field: StateField): string => {
  const value: Value | undefined = field.default
  if (value === undefined || value === null) return ''
  return field.type === 'datetime' && typeof value === 'string' ? boxOfDatetime(value) : String(value)
}

const fieldDraftOf = (field: StateField): DraftField => ({
  key: field.id,
  id: field.id,
  name: field.name,
  type: field.type as FieldType,
  required: field.required === true,
  default: textOf(field),
  emptyDefault: field.type === 'text' && field.default === ''
})

/** The draft of a state as it is now. */
export const draftOf = (state: StateFile): StateDraft => ({ fields: state.fields.map(fieldDraftOf) })

let newFieldCount = 0
/** A field the form adds: a text field with no name and no default, which has no id until it is saved. */
export const newField = (): DraftField => ({ key: `new_${++newFieldCount}`, id: '', name: '', type: 'text', required: false, default: '', emptyDefault: false })

/** The draft with the field at `from` moved to position `to`. */
export function moveField(draft: StateDraft, from: number, to: number): StateDraft {
  const fields = [...draft.fields]
  const [moved] = fields.splice(from, 1)
  if (moved) fields.splice(to, 0, moved)
  return { fields }
}

/** Gives `field` a type. What was typed for another type may not fit this one: a toggle starts on no (its checkbox starts unchecked), the others empty. */
export function setFieldType(field: DraftField, type: FieldType) {
  field.type = type
  field.default = type === 'boolean' ? 'false' : ''
  field.emptyDefault = false
}

/** Types `text` into the default box: a text there is the default, so it is not an empty one any more. */
export function setDefault(field: DraftField, text: string) {
  field.default = text
  if (text.trim() !== '') field.emptyDefault = false
}

/** Switches a text field between no default and an empty text as its default (the box is empty either way). */
export function toggleEmptyDefault(field: DraftField) {
  field.default = ''
  field.emptyDefault = !field.emptyDefault
}

/**
 * The default a box stands for in a field of its type, trimmed whatever the type: its value, none (an empty box), or what the text
 * is not. A number is written as digits, a point and an exponent (`1e3` is 1000, for a whole number too when it comes out whole),
 * and a whole number is one the number type holds exactly. An empty box is none, unless a text field asked for the empty text.
 */
function valueOfDefault(field: Pick<DraftField, 'type' | 'default' | 'emptyDefault'>): { value: Value } | { none: true } | { problem: string } {
  const typed = field.default.trim()
  if (typed === '') return field.type === 'text' && field.emptyDefault ? { value: '' } : { none: true }
  if (field.type === 'integer' || field.type === 'number') {
    const number = NUMBER_TEXT.test(typed) ? Number(typed) : Number.NaN
    // `+ 0` makes minus zero zero: JSON has no minus zero, and it would not be the same default twice.
    if (field.type === 'integer') return Number.isSafeInteger(number) ? { value: number + 0 } : { problem: 'a whole number' }
    return Number.isFinite(number) ? { value: number + 0 } : { problem: 'a number' }
  }
  if (field.type === 'boolean') return typed === 'true' || typed === 'false' ? { value: typed === 'true' } : { problem: 'true or false' }
  if (field.type === 'datetime' && DATETIME_BOX_VALUE.test(typed)) return { value: datetimeOfBox(typed) }
  return { value: typed }
}

export interface StateChanges {
  /** The `state_update` `fields` input, in the draft's order; null when nothing changed or the draft can't be sent. */
  fields: Array<Record<string, unknown>> | null
  /** What stops the draft from being sent, for each box that has such a problem. */
  problems: string[]
}

/** A field as it is stored, for one the user did not touch: it never goes through its text and back. */
const asStored = (before: StateField): Record<string, unknown> => ({
  id: before.id,
  name: before.name,
  type: before.type,
  ...before.required ? { required: true } : {},
  ...before.default !== undefined ? { default: before.default } : {}
})

/**
 * The default to send for a touched field: its stored default when its box was not touched (and its type is the same), so a stored
 * date and time with seconds or a zone is not rounded to the box's minutes; else what the box stands for (a problem is added to
 * `problems`).
 */
function defaultToSend(field: DraftField, name: string, before: StateField | undefined, first: DraftField | undefined, problems: string[]): { default?: Value } {
  if (before && first && field.default === first.default && field.emptyDefault === first.emptyDefault && field.type === before.type) {
    return before.default !== undefined ? { default: before.default } : {}
  }
  const converted = valueOfDefault(field)
  if ('problem' in converted) {
    problems.push(`${name || '(unnamed)'}: its default is ${converted.problem}`)
    return {}
  }
  return 'value' in converted ? { default: converted.value } : {}
}

/** One entry of the list to send: an untouched saved field as stored, any other as the form has it, with its id when it has one. */
function fieldToSend(field: DraftField, base: StateFile, opened: DraftField[], problems: string[]): Record<string, unknown> {
  const before = base.fields.find(entry => entry.id === field.id)
  const first = opened.find(entry => entry.key === field.key)
  if (before && first && sameJson(field, first)) return asStored(before)
  const name = field.name.trim()
  if (!name && !problems.includes('Name every field')) problems.push('Name every field')
  return {
    ...field.id ? { id: field.id } : {},
    name,
    type: field.type,
    ...field.required ? { required: true } : {},
    ...defaultToSend(field, name, before, first, problems)
  }
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
  const fields = draft.fields.map(field => fieldToSend(field, base, opened, problems))
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
 *
 * A field is touched or not as a whole (not part by part): when they changed one part of it (its name) and another part changed
 * elsewhere (its default), theirs stays and the other change is not merged into it.
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
 * The row (its key) a refusal of `state_update` is about, by the field the module names in it (`field`): the saved field of that
 * id, whatever the draft calls it now, or, for an entry that had no id (a field added here), the row with that name as it was sent,
 * a new one before a saved one. Null for a refusal about something else, or about a field the draft does not have. The message is
 * not read: it is for the user, and may change.
 */
export function fieldOfRefusal(refused: RefusedField | undefined, fields: readonly DraftField[]): string | null {
  if (!refused) return null
  if (refused.id !== undefined) return fields.find(field => field.id === refused.id)?.key ?? null
  const named = (field: DraftField) => field.name.trim() === refused.name
  return (fields.find(field => field.id === '' && named(field)) ?? fields.find(named))?.key ?? null
}
