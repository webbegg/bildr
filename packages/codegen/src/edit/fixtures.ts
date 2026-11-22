import { z } from 'zod'
import { FixturesFileSchema, ValueSchema } from '../model/schemas.ts'
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
/** A row as the caller saw it: any row a fixtures file holds, so the file's own row schema (a key of any length, even an empty one). */
const RowBase = FixturesFileSchema.shape.rows.element
const BASE_NOTE = 'the row as the caller saw it: when the row at that key is not this one (the rows changed since, so a place among them now names another row), nothing is written and it is refused as a conflict (409)'

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
  uuid: 'a uuid',
  email: 'an email address like ana@example.com',
  url: 'a web address that starts with http:// or https://',
  phone: 'a phone number like +34 600 123 456',
  color: 'a hex color like #336699',
  money: 'an amount (a number)',
  percent: 'a percentage (a number)',
  select: 'one of its options'
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Why `value` can't be stored for `field` (as a sentence), or undefined when it can. */
const valueProblem = (field: Field, value: Value): string | undefined => {
  if (value === null) return field.required && !field.nullable && field.default === undefined ? `${field.name} is required` : undefined
  if (!fits(field.type, value, true, field.options)) return `${field.name} must be ${field.type === 'select' ? `one of ${(field.options ?? []).join(', ')}` : TYPE_LABELS[field.type]}`
  const text = typeof value === 'string'
  if (field.type === 'text' || field.type === 'image') {
    if (text && field.min !== undefined && value.length < field.min) return `${field.name} must be at least ${plural(field.min, 'character')}`
    if (text && field.max !== undefined && value.length > field.max) return `${field.name} must be at most ${plural(field.max, 'character')}`
  } else if (field.type === 'integer' || field.type === 'number' || field.type === 'money' || field.type === 'percent') {
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
    case 'money':
    case 'percent':
      return Math.min(Math.max(0, field.min ?? 0), field.max ?? Infinity)
    case 'boolean':
      return false
    case 'select':
      return field.options?.[0] ?? ''
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

/** A value some other row (not `except`) already has in this field. */
const taken = (rows: Row[], name: string, value: Value, except?: number): boolean => rows.some((row, index) => index !== except && row[name] === value)

/**
 * What a new row holds in a required field that has no default, was not given, and must be unique: the placeholder of
 * its type if no row has it, else the next one free (text: untitled, untitled-2, …; a number: the next whole number; a
 * date: the next day; a date and time: the next second).
 */
const freeBlank = (field: Field, rows: Row[]): Value => {
  const blank = blankOf(field)
  if (!field.unique || !taken(rows, field.name, blank)) return blank
  /** The `n`th other placeholder of the type (a uuid is new each time, a boolean has no other). */
  const another = (n: number): Value | undefined => {
    switch (field.type) {
      case 'text':
      case 'image':
        return n === 1 ? 'untitled' : `untitled-${n}`
      case 'integer':
      case 'number':
      case 'money':
      case 'percent':
        return Number(blank) + n
      case 'select':
        return field.options?.[n]
      case 'date':
        return new Date(Date.parse(`${String(blank)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
      case 'datetime':
        return new Date(Date.parse(String(blank)) + n * 1000).toISOString()
      default:
        return undefined
    }
  }
  for (let n = 1; n <= rows.length + 1; n++) {
    const candidate = another(n)
    if (candidate === undefined) break
    if (!taken(rows, field.name, candidate) && valueProblem(field, candidate) === undefined) return candidate
  }
  return blank
}

/** The unique fields among `names` whose value in `row` another row (not `except`) already has. */
const uniqueProblems = (entity: EntityFile, rows: Row[], row: Record<string, Value | undefined>, names: string[], except?: number): string[] =>
  entity.fields.filter(field => field.unique && names.includes(field.name)).flatMap((field) => {
    const value = row[field.name]
    return value === undefined || value === null || !taken(rows, field.name, value, except) ? [] : [`${field.name} must be unique: another sample row already has ${JSON.stringify(value)}`]
  })

/** What emptying a field stores: null where the field can hold one, else its default, else nothing (the key is left out, which the generated type allows only for a field that is neither required, nullable nor defaulted). */
const emptied = (field: Field): Value | undefined => field.nullable ? null : field.default

/** A value in one canonical text (object keys sorted), to compare rows by content. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : item)

const TIMESTAMPS = ['createdAt', 'updatedAt']

const unknownField = (entity: EntityFile, name: string) => `Entity ${entity.name} has no field "${name}"`

/**
 * The row with this key; an unknown or ambiguous key is refused. With `base` (the row as the caller saw it), a row that
 * differs is a `conflict`: the key is a place among the rows for a row with no id, and the rows may have changed since.
 */
const rowIndex = (fixtures: FixturesFile | undefined, entity: EntityFile, key: string, base?: Record<string, Value>): number => {
  const rows = fixtures?.rows ?? []
  const found = rows.flatMap((row, index) => fixtureRowKey(row, index) === key ? [index] : [])
  if (!found.length) return fail('not_found', `${entity.name} has no sample row "${key}"`)
  if (found.length > 1) {
    const named = found.filter(index => typeof rows[index]!.id === 'string' || typeof rows[index]!.id === 'number')
    return fail('invalid', named.length === found.length
      ? `${entity.name} has ${found.length} sample rows with the id "${key}": make the ids differ in the JSON tab first`
      : `"${key}" is the id of one row and the place of another (a row with no id) in ${entity.name}'s sample data, so it can't say which one: give the rows an id in the JSON tab first`)
  }
  const index = found[0]!
  if (base && canonical(base) !== canonical(rows[index])) fail('conflict', `${entity.name} sample row "${key}" changed since you loaded it: reload the rows and try again`)
  return index
}

/** The actions whose generated test loads a row of this entity from its seed (`<entity>Seed[0]!.id`): they can't run with no sample row. */
const needingARow = (draft: Draft, entityId: string): string[] => {
  const modules = Object.values(draft.model.modules)
  return modules.flatMap(mod => mod.actions.flatMap((action) => {
    if (action.input.entity) return []
    const load = action.steps.find(step => step.kind === 'load')
    const repository = modules.flatMap(entry => entry.repositories).find(entry => entry.id === load?.repository)
    return repository?.entity === entityId ? [action.name] : []
  }))
}

/**
 * Checks `values` as the new content of fields of `entity`, returning what to store. A null is stored as what emptying the
 * field means (`emptied`): null, the field's default, or, for a field that is neither, nothing (`undefined`: the key leaves
 * the row). The generated seed is typed by the entity (`Post[]`), where a field with a default or that can be null is a
 * required key: it is never dropped.
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
      else out[name] = value === null ? emptied(field) : value
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
      // A given id that is empty or of the wrong type was already refused above, by its field.
      if (!('id' in values)) problems.push('id is required: it is the key rows are found by')
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
      else if (field.required) row[field.name] = freeBlank(field, rows)
    }
    if (entity.timestamps) {
      row.createdAt = fixtureSource.now()
      row.updatedAt = row.createdAt
    }
    problems.push(...uniqueProblems(entity, rows, row, entity.fields.map(field => field.name)))
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
    base: RowBase.optional().describe(`The row \`row\` names, ${BASE_NOTE}`),
    values: Values.refine(values => Object.keys(values).length > 0, 'Give at least one value to change').describe('The fields to change, by name, e.g. { "title": "Hello again" }; the others stay. null empties a field: it becomes null where the field can be null, else its default, else the value is left out; refused on a required field with no default. The id and read-only fields can\'t change')
  }),
  apply: (draft, { entity: entityId, row: key, base, values }) => {
    const { entity } = sampleOf(draft, entityId)
    const fixtures = fixturesOf(draft, entityId)
    const index = rowIndex(fixtures, entity, key, base)
    const problems: string[] = []
    if ('id' in values) problems.push('id is the key the row is found by: it can\'t be changed')
    const { id: _id, ...rest } = values
    const next = checked(entity, rest, problems)
    const current = fixtures!.rows[index]!
    const row: Record<string, Value | undefined> = { ...current }
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) Reflect.deleteProperty(row, name)
      else row[name] = value
    }
    problems.push(...uniqueProblems(entity, fixtures!.rows, row, Object.keys(next), index))
    refuseWith(problems)
    fixtures!.rows[index] = without(row)
    return { rowId: key }
  }
})

// ── fixture_rows_delete ──────────────────────────────────────────────────

export const fixtureRowsDelete = defineEdit({
  input: z.object({
    entity: EntityRef,
    rows: z.array(RowRef).min(1).max(500).describe('The ids of the rows to delete (one, or several for a bulk delete); all or none: an unknown row refuses the whole delete. The last row can\'t go while an action\'s generated test loads a row of the entity'),
    base: z.record(RowRef, RowBase).optional().describe(`By row key, the rows as the caller saw them: ${BASE_NOTE}; the whole delete is refused`)
  }),
  apply: (draft, { entity: entityId, rows: keys, base }) => {
    const { entity } = sampleOf(draft, entityId)
    const fixtures = fixturesOf(draft, entityId)
    const unique = [...new Set(keys)]
    const missing = unique.filter(key => !(fixtures?.rows ?? []).some((row, index) => fixtureRowKey(row, index) === key))
    if (missing.length) fail('not_found', `${entity.name} has no sample ${missing.length === 1 ? 'row' : 'rows'} ${missing.map(key => `"${key}"`).join(', ')}`)
    const doomed = new Set(unique.map(key => rowIndex(fixtures, entity, key, base?.[key])))
    if (doomed.size === fixtures!.rows.length) {
      const needers = needingARow(draft, entityId)
      if (needers.length) fail('invalid', `Keep at least one sample row: ${needers.join(', ')} tests use it`)
    }
    fixtures!.rows = fixtures!.rows.filter((_row, index) => !doomed.has(index))
    return { deleted: unique }
  }
})
