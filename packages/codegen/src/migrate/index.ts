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
  /** Renames onto a name held by a table or column bildr has no id for (added by hand): refused. */
  conflicts: string[]
}

const TEMPORARY = (index: number) => `__bildr_rename_${index}`
const REPLACED = (index: number) => `__bildr_replaced_${index}`

/** Statements for one group of simultaneous renames: direct, or through temporary names when one's target is another's source (swaps, chains). */
const renameStatements = (renames: Array<{ from: string, to: string }>, statement: (from: string, to: string) => string, counter: { next: number }) => {
  const sources = new Set(renames.map(({ from }) => from))
  if (!renames.some(({ to }) => sources.has(to))) return renames.map(({ from, to }) => statement(from, to))
  const temporary = renames.map(() => TEMPORARY(counter.next++))
  return [...renames.map(({ from }, index) => statement(from, temporary[index]!)), ...renames.map(({ to }, index) => statement(temporary[index]!, to))]
}

/**
 * The renames between two ids maps that the previous snapshot can take.
 * - Sources the snapshot doesn't have are ignored (a hand-edited migrations folder).
 * - Swaps and chains go through temporary names.
 * - A name a removed entity or field held, now taken (by a rename or by a new
 *   id), is first moved to `__bildr_replaced_N`: drizzle-kit then drops it, which
 *   is destructive and waits for confirmation, and the new owner starts empty
 *   instead of inheriting someone else's data.
 * - A target held by something with no id (added by hand) is a conflict.
 */
export const planRenames = (previous: SchemaIds, current: SchemaIds, snapshot: Snapshot): RenamePlan => {
  const raw = renamesBetween(previous, current)
  const conflicts: string[] = []
  const replacedCounter = { next: 0 }

  // Tables of removed entities whose name a current entity takes.
  const currentTables = new Set(Object.values(current.tables).map(({ table }) => table))
  const replacedTables = Object.entries(previous.tables)
    .filter(([id, { table }]) => !current.tables[id] && currentTables.has(table) && snapshot.tables[table])
    .map(([, { table }]) => ({ from: table, to: REPLACED(replacedCounter.next++) }))
  const freedTables = new Set(replacedTables.map(({ from }) => from))

  const tables = raw.tables.filter(({ from }) => snapshot.tables[from])
  const tableSources = new Set(tables.map(({ from }) => from))
  for (const { from, to } of tables) {
    if (snapshot.tables[to] && !tableSources.has(to) && !freedTables.has(to)) conflicts.push(`Table ${to} exists but isn't in the model: remove it by hand, then rename ${from} to ${to}`)
  }
  const oldTable = new Map(tables.map(({ from, to }) => [to, from]))
  const columnsBefore = (table: string) => snapshot.tables[oldTable.get(table) ?? table]?.columns ?? {}

  // Columns of removed fields (of entities that stay) whose name a current field of the same entity takes.
  const replacedColumns: Array<{ table: string, from: string, to: string }> = []
  for (const [id, now] of Object.entries(current.tables)) {
    const before = previous.tables[id]
    if (!before || freedTables.has(now.table)) continue
    const names = new Set(Object.values(now.columns))
    for (const [fieldId, column] of Object.entries(before.columns)) {
      if (now.columns[fieldId] === undefined && names.has(column) && columnsBefore(now.table)[column]) {
        replacedColumns.push({ table: now.table, from: column, to: REPLACED(replacedCounter.next++) })
      }
    }
  }

  const columns = raw.columns.filter(({ table, from }) => columnsBefore(table)[from])
  const byTable = new Map<string, Array<{ from: string, to: string }>>()
  for (const { table, from, to } of columns) byTable.set(table, [...(byTable.get(table) ?? []), { from, to }])
  for (const [table, renames] of byTable) {
    const sources = new Set(renames.map(({ from }) => from))
    const freed = new Set(replacedColumns.filter(entry => entry.table === table).map(({ from }) => from))
    for (const { from, to } of renames) {
      if (columnsBefore(table)[to] && !sources.has(to) && !freed.has(to)) conflicts.push(`Column ${table}.${to} exists but isn't in the model: remove it by hand, then rename ${table}.${from} to ${to}`)
    }
  }

  const counter = { next: 0 }
  const tableSql = (from: string, to: string) => `ALTER TABLE ${quote(from)} RENAME TO ${quote(to)};`
  const columnSql = (table: string) => (from: string, to: string) => `ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(from)} TO ${quote(to)};`
  const sql = [
    ...replacedTables.map(({ from, to }) => tableSql(from, to)),
    ...renameStatements(tables, tableSql, counter),
    ...replacedColumns.map(({ table, from, to }) => columnSql(table)(from, to)),
    ...[...byTable].flatMap(([table, renames]) => renameStatements(renames, columnSql(table), counter))
  ]
  return { renames: { tables: [...replacedTables, ...tables], columns: [...replacedColumns, ...columns] }, sql, conflicts }
}

/**
 * Every `DROP INDEX` first: drizzle-kit diffs indexes table by table, so when
 * two tables swap names one would create an index whose name the other still
 * holds. Dropping an index early loses no data; the CREATE statements follow.
 */
export const dropIndexesFirst = (statements: string[]): string[] => [
  ...statements.filter(statement => /^\s*DROP\s+INDEX\b/i.test(statement)),
  ...statements.filter(statement => !/^\s*DROP\s+INDEX\b/i.test(statement))
]

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
