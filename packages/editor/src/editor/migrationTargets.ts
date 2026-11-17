import { isDestructive, schemaIds } from '@bildr/codegen/migrate'
import type { Model } from '@bildr/codegen/model'
import type { PendingMigration } from '../types.ts'

/**
 * Which collections a pending migration plan changes (S6), so the Data workspace can say so where the collection is.
 * The plan is the SQL drizzle-kit wrote (`PendingMigration.statements`); a statement is a collection's when the table it names
 * is the table a collection is stored in (`schemaIds` of `@bildr/codegen/migrate`: the repository's `table`, else the module's name
 * and the plural, which is also what the migration itself uses to resolve renames). What no collection owns (the table of a
 * collection that is gone, a table moved aside to be dropped) is kept in `other`; PRAGMAs, which only wrap a table rebuild, belong to nothing.
 */

export type ChangeKind = 'create' | 'drop' | 'alter'

/** What the plan does to one collection. */
export interface CollectionChange {
  /** What it does, in the order the plan first does each: a table created or dropped, or altered (a column, an index, a rename, a rebuild). */
  kinds: ChangeKind[]
  statements: string[]
  /** Whether any of its statements can lose data (a dropped table or column, a rebuild): the module's own rule (`isDestructive`). */
  losesData: boolean
}

export interface MigrationTargets {
  /** The collections the plan changes, by collection (entity) id. */
  collections: Record<string, CollectionChange>
  /** The statements that map to no collection. */
  other: string[]
  /** How many changes the plan makes: each collection once, and each statement of `other`. */
  count: number
}

interface Touch {
  kind: ChangeKind
  /** The tables the statement is about (a rename is about both names), `[]` when it names none. */
  tables: string[]
  /** A statement with no table in it, only an index's name (`DROP INDEX`). */
  index?: string
}

const REBUILD = /^__new_/
const unquoted = (name: string) => name.replace(REBUILD, '')

/** What a statement does and to which tables, or null for the ones that are not a change (PRAGMA). `rebuilt` are the tables the plan rebuilds: dropping one is half of the rebuild, an alteration. */
const touch = (statement: string, rebuilt: ReadonlySet<string>): Touch | null => {
  const sql = statement.trim()
  if (/^PRAGMA\b/i.test(sql)) return null
  const create = /^CREATE\s+TABLE\s+`([^`]+)`/i.exec(sql)
  if (create) return { kind: REBUILD.test(create[1]!) ? 'alter' : 'create', tables: [unquoted(create[1]!)] }
  const drop = /^DROP\s+TABLE\s+`([^`]+)`/i.exec(sql)
  if (drop) return { kind: rebuilt.has(drop[1]!) ? 'alter' : 'drop', tables: [drop[1]!] }
  const rename = /^ALTER\s+TABLE\s+`([^`]+)`\s+RENAME\s+TO\s+`([^`]+)`/i.exec(sql)
  if (rename) return { kind: 'alter', tables: [unquoted(rename[1]!), unquoted(rename[2]!)] }
  const alter = /^ALTER\s+TABLE\s+`([^`]+)`/i.exec(sql)
  if (alter) return { kind: 'alter', tables: [unquoted(alter[1]!)] }
  const index = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+`[^`]+`\s+ON\s+`([^`]+)`/i.exec(sql)
  if (index) return { kind: 'alter', tables: [index[1]!] }
  const dropIndex = /^DROP\s+INDEX\s+`([^`]+)`/i.exec(sql)
  if (dropIndex) return { kind: 'alter', tables: [], index: dropIndex[1]! }
  const copy = /^INSERT\s+INTO\s+`([^`]+)`/i.exec(sql)
  if (copy) return { kind: 'alter', tables: [unquoted(copy[1]!)] }
  return { kind: 'alter', tables: [] }
}

/** The collections `plan` changes, and what it does to each (see the file's note). */
export function migrationTargets(model: Model | null, plan: Pick<PendingMigration, 'statements'>): MigrationTargets {
  const owners = new Map<string, string>()
  if (model) for (const [id, stored] of Object.entries(schemaIds(model).tables)) owners.set(stored.table, id)
  // A dropped index is named `<table>_<columns>_<suffix>`: the longest table name it starts with is its table.
  const ownerOfIndex = (name: string) => [...owners.keys()].filter(table => name.startsWith(`${table}_`)).sort((a, b) => b.length - a.length)[0]

  const rebuilt = new Set(plan.statements.flatMap(statement => /^\s*CREATE\s+TABLE\s+`__new_([^`]+)`/i.exec(statement)?.[1] ?? []))
  const collections: Record<string, CollectionChange> = {}
  const other: string[] = []
  for (const statement of plan.statements) {
    const found = touch(statement, rebuilt)
    if (!found) continue
    const tables = found.index !== undefined ? [ownerOfIndex(found.index)].filter((table): table is string => table !== undefined) : found.tables
    const id = tables.map(table => owners.get(table)).find((owner): owner is string => owner !== undefined)
    if (id === undefined) {
      other.push(statement)
      continue
    }
    const change = collections[id] ??= { kinds: [], statements: [], losesData: false }
    if (!change.kinds.includes(found.kind)) change.kinds.push(found.kind)
    change.statements.push(statement)
    change.losesData ||= isDestructive(statement)
  }
  return { collections, other, count: Object.keys(collections).length + other.length }
}
