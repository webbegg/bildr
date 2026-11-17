import { z } from 'zod'
import { ValueSchema } from '../model/schemas.ts'
import type { EntityFile, FieldSchema, FixturesFile, Value } from '../model/schemas.ts'
import { defineEdit, fail, kebab } from './core.ts'
import type { Draft } from './core.ts'
import { datasourceById } from './datasources.ts'
import { entityById, EntityRef, fits, repositoryOf } from './entities.ts'

/**
 * Sample data (D4, S4): the rows of an entity's fixtures file, one edit per change. A row is validated against its
 * entity's fields (type, required, read-only, bounds and pattern) before it is written, and the whole model must still
 * load and generate, like every edit. The edits only ever change the fixtures file, under `.bildr/`: they never touch
 * the app's own rows (E2). A REST collection has no fixtures. Rows are found by their `id`, or, for a row that has none,
 * by its place among the rows (`fixtureRowKey`, which the editor's table uses too).
 */

type Field = z.infer<typeof FieldSchema>
type Row = FixturesFile['rows'][number]

/** A version 4 uuid: the platform's (the package has no DOM or Node types, and runs in both), else one made of `Math.random` (a sample row's id needs to be unique, not secret). */
const randomUuid = (): string => {
  const platform = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (platform?.randomUUID) return platform.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const digit = Math.floor(Math.random() * 16)
    return (char === 'x' ? digit : (digit & 0x3) | 0x8).toString(16)
  })
}

/** Where a new row's id and timestamps come from: replaced in tests so they are deterministic. */
export const fixtureSource = {
  newId: randomUuid,
  now: (): string => new Date().toISOString()
}

const RowRef = z.string().min(1).max(200).describe('The row\'s id (a row without one: its place among the rows, counting from 0)')
const Values = z.record(z.string().min(1).max(60), ValueSchema)

/** A row's key: its `id` when it has one, else its place among the rows. */
export const fixtureRowKey = (row: Record<string, unknown>, index: number): string => typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : String(index)

const TYPE_LABELS: Record<Field['type'], string> = {
  text: 'text',
  integer: 'a whole number',
  number: 'a number',
  boolean: 'true or false',
  date: 'a date like 2026-01-15',
  datetime: 'a date and time like 2026-01-15T09:30:00Z',
  image: 'text (an image address)',
  uuid: 'a uuid'
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Why `value` can't be stored for `field` (as a sentence), or undefined when it can. */
const valueProblem = (field: Field, value: Value): string | undefined => {
  if (value === null) return field.required && !field.nullable ? `${field.name} is required` : undefined
  if (!fits(field.type, value, true)) return `${field.name} must be ${TYPE_LABELS[field.type]}`
  const text = typeof value === 'string'
  if (field.type === 'text' || field.type === 'image') {
    if (text && field.min !== undefined && value.length < field.min) return `${field.name} must be at least ${plural(field.min, 'character')}`
    if (text && field.max !== undefined && value.length > field.max) return `${field.name} must be at most ${plural(field.max, 'character')}`
  } else if (field.type === 'integer' || field.type === 'number') {
    if (typeof value === 'number' && field.min !== undefined && value < field.min) return `${field.name} must be at least ${field.min}`
    if (typeof value === 'number' && field.max !== undefined && value > field.max) return `${field.name} must be at most ${field.max}`
  }
  if (text && field.pattern !== undefined && !patternOf(field.pattern)?.test(value)) return `${field.name}: ${field.patternMessage ?? `must match ${field.pattern}`}`
  return undefined
}

/** A field's pattern, or undefined for one that isn't a regular expression (the model's own checks decide what to do about it). */
const patternOf = (pattern: string): RegExp | undefined => {
  try {
    return new RegExp(pattern)
  } catch {
    return undefined
  }
}

const sampleOf = (draft: Draft, entityId: string): { entity: EntityFile, module: string } => {
  const found = entityById(draft, entityId)
  const repository = repositoryOf(draft, entityId)
  if (repository && datasourceById(draft, repository.datasource).kind === 'rest') fail('invalid', 'A REST collection has no sample data')
  return found
}

const fixturesOf = (draft: Draft, entityId: string): FixturesFile | undefined =>
  Object.values(draft.model.modules).flatMap(mod => mod.fixtures).find(fixtures => fixtures.entity === entityId)

/** The entity's fixtures file, made (empty, next to the entity) when it has none. */
const ensureFixtures = (draft: Draft, entity: EntityFile, module: string): FixturesFile => {
  const existing = fixturesOf(draft, entity.id)
  if (existing) return existing
  const fixtures: FixturesFile = { entity: entity.id, rows: [] }
  draft.module(module).fixtures.push(fixtures)
  draft.place(`fixtures:${entity.id}`, `.bildr/modules/${module}/fixtures`, kebab(entity.name))
  return fixtures
}

/**
 * What a new row holds in a required field that has no default and was not given: the empty value of its type, to be
 * filled in (a number the bounds allow, today, now). It is a placeholder: it may not satisfy a pattern, a minimum length
 * or `unique` until it is edited, which an edit of the cell checks.
 */
const blankOf = (field: Field): Value => {
  switch (field.type) {
    case 'integer':
    case 'number':
      return Math.min(Math.max(0, field.min ?? 0), field.max ?? Infinity)
    case 'boolean':
      return false
    case 'date':
      return fixtureSource.now().slice(0, 10)
    case 'datetime':
      return fixtureSource.now()
    case 'uuid':
      return fixtureSource.newId()
    default:
      return ''
  }
}

const TIMESTAMPS = ['createdAt', 'updatedAt']

const unknownField = (entity: EntityFile, name: string) => `Entity ${entity.name} has no field "${name}"`

/** The row with this key; an unknown or ambiguous key is refused. */
const rowIndex = (fixtures: FixturesFile | undefined, entity: EntityFile, key: string): number => {
  const found = (fixtures?.rows ?? []).flatMap((row, index) => fixtureRowKey(row, index) === key ? [index] : [])
  if (!found.length) return fail('not_found', `${entity.name} has no sample row "${key}"`)
  if (found.length > 1) return fail('invalid', `${entity.name} has ${found.length} sample rows with the id "${key}": make the ids differ in the JSON tab first`)
  return found[0]!
}

/**
 * Checks `values` as the new content of fields of `entity`, returning what to store. A null on a field that can't hold one
 * (not nullable, not required) leaves the key out of the row (`undefined`), as the generated type has it.
 */
const checked = (entity: EntityFile, values: Record<string, Value>, problems: string[]): Record<string, Value | undefined> => {
  const out: Record<string, Value | undefined> = {}
  for (const [name, value] of Object.entries(values)) {
    const field = entity.fields.find(entry => entry.name === name)
    if (!field) {
      problems.push(TIMESTAMPS.includes(name) && entity.timestamps ? `${name} is read-only: it records when the row was made or changed` : unknownField(entity, name))
    } else if (field.readonly) {
      problems.push(`${name} is read-only: the app sets it, not a client`)
    } else {
      const problem = valueProblem(field, value)
      if (problem) problems.push(problem)
      else out[name] = value === null && !field.nullable ? undefined : value
    }
  }
  return out
}

const refuseWith = (problems: string[]): void => {
  if (problems.length) fail('invalid', problems.join('; '))
}

const without = (row: Record<string, Value | undefined>): Row => Object.fromEntries(Object.entries(row).filter((entry): entry is [string, Value] => entry[1] !== undefined))

// ── fixture_row_create ───────────────────────────────────────────────────

export const fixtureRowCreate = defineEdit({
  input: z.object({
    entity: EntityRef,
    values: Values.optional().describe('The values of the new row, by field name, e.g. { "title": "Hello" }. What it leaves out gets the field\'s default (a field that can be null: null; a required field with no default: an empty value of its type, to fill in). A uuid entity gets a new id unless "id" is given (a uuid no row has). Read-only fields can\'t be given')
  }),
  apply: (draft, { entity: entityId, values = {} }) => {
    const { entity, module } = sampleOf(draft, entityId)
    const rows = fixturesOf(draft, entityId)?.rows ?? []
    const problems: string[] = []
    const { id: given, ...rest } = values
    const external = entity.idStrategy === 'external'
    const own = checked(entity, external ? values : rest, problems)

    let id: Value | undefined
    if (external) {
      id = own.id
      if (id === undefined || id === null) problems.push('id is required: it is the key rows are found by')
    } else {
      id = given ?? fixtureSource.newId()
      if (!fits('uuid', id, false)) problems.push('id must be a uuid')
    }
    if (typeof id === 'string' || typeof id === 'number') {
      if (rows.some(row => (typeof row.id === 'string' || typeof row.id === 'number') && String(row.id) === String(id))) problems.push(`${entity.name} already has a row with the id "${String(id)}"`)
    }

    const row: Record<string, Value | undefined> = external ? {} : { id }
    for (const field of entity.fields) {
      if (field.name in own) row[field.name] = own[field.name]
      else if (external && field.name === 'id') row.id = id
      else if (field.default !== undefined) row[field.name] = field.default
      else if (field.nullable) row[field.name] = null
      else if (field.required) row[field.name] = blankOf(field)
    }
    if (entity.timestamps) {
      row.createdAt = fixtureSource.now()
      row.updatedAt = row.createdAt
    }
    refuseWith(problems)
    const fixtures = ensureFixtures(draft, entity, module)
    fixtures.rows.push(without(row))
    return { rowId: String(id), fixturesPath: draft.model.paths[`fixtures:${entityId}`] }
  }
})

// ── fixture_row_update ───────────────────────────────────────────────────

export const fixtureRowUpdate = defineEdit({
  input: z.object({
    entity: EntityRef,
    row: RowRef,
    values: Values.refine(values => Object.keys(values).length > 0, 'Give at least one value to change').describe('The fields to change, by name, e.g. { "title": "Hello again" }; the others stay. null empties a field that may be empty. The id and read-only fields can\'t change')
  }),
  apply: (draft, { entity: entityId, row: key, values }) => {
    const { entity } = sampleOf(draft, entityId)
    const fixtures = fixturesOf(draft, entityId)
    const index = rowIndex(fixtures, entity, key)
    const problems: string[] = []
    if ('id' in values) problems.push('id is the key the row is found by: it can\'t be changed')
    const { id: _id, ...rest } = values
    const next = checked(entity, rest, problems)
    refuseWith(problems)
    const current = fixtures!.rows[index]!
    const row: Record<string, Value | undefined> = { ...current }
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) Reflect.deleteProperty(row, name)
      else row[name] = value
    }
    fixtures!.rows[index] = without(row)
    return { rowId: key }
  }
})

// ── fixture_rows_delete ──────────────────────────────────────────────────

export const fixtureRowsDelete = defineEdit({
  input: z.object({
    entity: EntityRef,
    rows: z.array(RowRef).min(1).max(500).describe('The ids of the rows to delete (one, or several for a bulk delete); all or none: an unknown row refuses the whole delete')
  }),
  apply: (draft, { entity: entityId, rows: keys }) => {
    const { entity } = sampleOf(draft, entityId)
    const fixtures = fixturesOf(draft, entityId)
    const unique = [...new Set(keys)]
    const missing = unique.filter(key => !(fixtures?.rows ?? []).some((row, index) => fixtureRowKey(row, index) === key))
    if (missing.length) fail('not_found', `${entity.name} has no sample ${missing.length === 1 ? 'row' : 'rows'} ${missing.map(key => `"${key}"`).join(', ')}`)
    const doomed = new Set(unique.map(key => rowIndex(fixtures, entity, key)))
    fixtures!.rows = fixtures!.rows.filter((_row, index) => !doomed.has(index))
    return { deleted: unique }
  }
})
