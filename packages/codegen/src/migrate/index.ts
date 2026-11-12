import { allFields, datasourceOf, moduleContext, repositoryOf } from '../generate/context.ts'
import { tableName } from '../generate/repository.ts'
import { snake } from '../generate/text.ts'
import type { Model } from '../model/load.ts'

/**
 * Pure migration planning (T8, S9). drizzle-kit diffs schemas but asks a
 * human when a table both gains and loses columns ("is this a rename?").
 * bildr knows the answer from model ids, so it resolves renames itself and
 * leaves drizzle-kit only prompt-free diffs. The Node side (`@bildr/nuxt`)
 * runs drizzle-kit and writes the files.
 */

/** Where each stored entity and field lives in the database: entity id → table, field id → column. */
export interface SchemaIds {
  tables: Record<string, { table: string, columns: Record<string, string> }>
}

export const schemaIds = (model: Model): SchemaIds => {
  const tables: SchemaIds['tables'] = {}
  for (const name of Object.keys(model.modules).sort()) {
    const context = moduleContext(model, name)
    for (const entity of context.module.entities) {
      const repository = repositoryOf(context, entity)
      if (!repository || datasourceOf(context, repository).kind !== 'sqlite') continue
      tables[entity.id] = {
        table: tableName(context, entity, repository),
        columns: Object.fromEntries(allFields(entity).map(field => [field.id, snake(field.name)]))
      }
    }
  }
  return { tables }
}

export interface Renames {
  tables: Array<{ from: string, to: string }>
  /** `table` is the new table name: column renames run after table renames. */
  columns: Array<{ table: string, from: string, to: string }>
}

/** Tables and columns whose id stayed while their name changed. Added and removed ids are left to the schema diff. */
export const renamesBetween = (previous: SchemaIds, current: SchemaIds): Renames => {
  const renames: Renames = { tables: [], columns: [] }
  for (const [id, now] of Object.entries(current.tables)) {
    const before = previous.tables[id]
    if (!before) continue
    if (before.table !== now.table) renames.tables.push({ from: before.table, to: now.table })
    for (const [fieldId, column] of Object.entries(now.columns)) {
      const old = before.columns[fieldId]
      if (old !== undefined && old !== column) renames.columns.push({ table: now.table, from: old, to: column })
    }
  }
  return renames
}

export interface RenamePlan {
  /** The renames to apply to the previous snapshot (simultaneous: swaps are fine there). */
  renames: Renames
  /** The statements, with temporary names when a new name is another renamed column's or table's old one. */
  sql: string[]
  /** Renames onto a name something that is going away still holds: refused, the user splits the change. */
  conflicts: string[]
}

const TEMPORARY = (index: number) => `__bildr_rename_${index}`

/** Statements for one group of simultaneous renames: direct, or through temporary names when one's target is another's source (swaps, chains). */
const renameStatements = (renames: Array<{ from: string, to: string }>, statement: (from: string, to: string) => string, counter: { next: number }) => {
  const sources = new Set(renames.map(({ from }) => from))
  if (!renames.some(({ to }) => sources.has(to))) return renames.map(({ from, to }) => statement(from, to))
  const temporary = renames.map(() => TEMPORARY(counter.next++))
  return [...renames.map(({ from }, index) => statement(from, temporary[index]!)), ...renames.map(({ to }, index) => statement(temporary[index]!, to))]
}

/**
 * The renames between two ids maps that the previous snapshot can take:
 * sources it doesn't have are ignored (a hand-edited migrations folder), and
 * a target held by a table or column that isn't renamed away is a conflict.
 */
export const planRenames = (previous: SchemaIds, current: SchemaIds, snapshot: Snapshot): RenamePlan => {
  const raw = renamesBetween(previous, current)
  const conflicts: string[] = []
  const tables = raw.tables.filter(({ from }) => snapshot.tables[from])
  const tableSources = new Set(tables.map(({ from }) => from))
  for (const { from, to } of tables) {
    if (snapshot.tables[to] && !tableSources.has(to)) conflicts.push(`Table ${to} still exists: remove it in one change, then rename ${from} to ${to} in the next`)
  }
  const oldTable = new Map(tables.map(({ from, to }) => [to, from]))
  const columns = raw.columns.filter(({ table, from }) => snapshot.tables[oldTable.get(table) ?? table]?.columns[from])
  const byTable = new Map<string, Array<{ from: string, to: string }>>()
  for (const { table, from, to } of columns) byTable.set(table, [...(byTable.get(table) ?? []), { from, to }])
  for (const [table, renames] of byTable) {
    const before = snapshot.tables[oldTable.get(table) ?? table]!.columns
    const sources = new Set(renames.map(({ from }) => from))
    for (const { from, to } of renames) {
      if (before[to] && !sources.has(to)) conflicts.push(`Column ${table}.${to} still exists: remove it in one change, then rename ${table}.${from} to ${to} in the next`)
    }
  }
  const counter = { next: 0 }
  const sql = [
    ...renameStatements(tables, (from, to) => `ALTER TABLE ${quote(from)} RENAME TO ${quote(to)};`, counter),
    ...[...byTable].flatMap(([table, renames]) => renameStatements(renames, (from, to) => `ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(from)} TO ${quote(to)};`, counter))
  ]
  return { renames: { tables, columns }, sql, conflicts }
}

/** Statements SQLite refuses whatever the data: a NOT NULL column added without a default. */
export const unappliable = (statements: string[]): string[] => statements.flatMap((statement) => {
  const match = /^ALTER TABLE `([^`]+)` ADD `([^`]+)` (.*)$/s.exec(statement.trim())
  if (!match || !/\bNOT NULL\b/i.test(match[3]!) || /\bDEFAULT\b/i.test(match[3]!)) return []
  return [`${match[1]}.${match[2]} is required: give the field a default value, so existing rows get one`]
})

const IDENTIFIER = /^[A-Za-z_][\w]*$/
const quote = (name: string) => {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`)
  return `\`${name}\``
}

/** The statements for the renames, in drizzle-kit's SQLite style: tables first, then columns. */
export const renameSql = (renames: Renames): string[] => [
  ...renames.tables.map(({ from, to }) => `ALTER TABLE ${quote(from)} RENAME TO ${quote(to)};`),
  ...renames.columns.map(({ table, from, to }) => `ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(from)} TO ${quote(to)};`)
]

// ── drizzle-kit SQLite snapshots (only the parts bildr touches) ─────────

export interface SnapshotColumn { name: string, [key: string]: unknown }
export interface SnapshotIndex { name: string, columns: string[], [key: string]: unknown }
export interface SnapshotTable {
  name: string
  columns: Record<string, SnapshotColumn>
  indexes: Record<string, SnapshotIndex>
  [key: string]: unknown
}
export interface Snapshot {
  tables: Record<string, SnapshotTable>
  [key: string]: unknown
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** The previous snapshot as if the renames had already run, so drizzle-kit sees no rename to ask about. */
export const applyRenames = (snapshot: Snapshot, renames: Renames): Snapshot => {
  const tableName = new Map(renames.tables.map(({ from, to }) => [from, to]))
  const tables = Object.fromEntries(Object.entries(clone(snapshot.tables)).map(([key, table]) => {
    const name = tableName.get(key) ?? key
    const columnName = new Map(renames.columns.filter(rename => rename.table === name).map(({ from, to }) => [from, to]))
    const renamed = (column: string) => columnName.get(column) ?? column
    return [name, {
      ...table,
      name,
      columns: Object.fromEntries(Object.entries(table.columns).map(([column, entry]) => [renamed(column), { ...entry, name: renamed(column) }])),
      indexes: Object.fromEntries(Object.entries(table.indexes).map(([index, entry]) => [index, { ...entry, columns: entry.columns.map(renamed) }]))
    }]
  }))
  return { ...clone(snapshot), tables }
}

/**
 * `current` without what `base` doesn't have yet: new tables, new columns and
 * indexes on them. Diffing base → this is removals and changes only, and
 * this → current additions only; neither makes drizzle-kit ask.
 */
export const withoutAdditions = (current: Snapshot, base: Snapshot): Snapshot => {
  const tables = Object.fromEntries(Object.entries(clone(current.tables)).flatMap(([key, table]) => {
    const before = base.tables[key]
    if (!before) return []
    const columns = Object.fromEntries(Object.entries(table.columns).filter(([column]) => before.columns[column]))
    const indexes = Object.fromEntries(Object.entries(table.indexes).filter(([, index]) => index.columns.every(column => columns[column])))
    return [[key, { ...table, columns, indexes }]]
  }))
  return { ...clone(current), tables }
}

/** Whether a statement can lose data: a dropped table or column, or drizzle-kit's table rebuild (`__new_<table>`). */
export const isDestructive = (statement: string): boolean =>
  /^\s*DROP\s+TABLE\b/i.test(statement) || /\bDROP\s+COLUMN\b/i.test(statement) || /`__new_/.test(statement)
