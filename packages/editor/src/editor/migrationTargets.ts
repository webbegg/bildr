import { isDestructive, schemaIds } from '@bildr/codegen/migrate'
import type { Model } from '@bildr/codegen/model'
import { entityById } from '../shared/dataModel.ts'
import type { PendingMigration } from '../types.ts'

/**
 * Which collections a pending migration plan changes (S6), and what it loses in their words, so the Data workspace can say so where
 * the collection is. The plan is the SQL drizzle-kit wrote (`PendingMigration.statements`); a statement is a collection's when the
 * table it names is the table a collection is stored in (`schemaIds` of `@bildr/codegen/migrate`: the repository's `table`, else the
 * module's name and the plural, which is also what the migration itself uses to resolve renames). What no collection owns (the table
 * of a collection that is gone, a table moved aside to be dropped) is only counted (`other`); PRAGMAs, which only wrap a table
 * rebuild, belong to nothing and are not counted.
 *
 * What the plan loses is the module's own list (`PendingMigration.losing`, by table and column), told by the collection's name:
 * "Post · body" instead of "the data of blog_posts.body". A line this does not know, or a table no collection owns, is kept as the
 * module wrote it (the raw name is the fallback).
 */

/** What the plan does to one collection. */
export interface CollectionChange {
  /** The collection's name. */
  name: string
  /** Whether it loses data: one of its statements can (the module's own rule, `isDestructive`, or its `destructive` list), or the plan says it loses something of it. */
  losesData: boolean
  /** What it loses, one line each ("Post · body"). */
  losing: string[]
}

export interface MigrationTargets {
  /** The collections the plan changes, by collection (entity) id. */
  collections: Record<string, CollectionChange>
  /** How many statements map to no collection. */
  other: number
  /** What the whole plan loses, in the collections' words. */
  losing: string[]
}

/** The tables a statement is about (a rename is about both names), `[]` when it names none; `index` is a dropped index's name (`DROP INDEX` has no table); null for the statements that are not a change (PRAGMA). */
interface Touch {
  tables: string[]
  index?: string
}

const REBUILD = /^__new_/
const unquoted = (name: string) => name.replace(REBUILD, '')

const touch = (statement: string): Touch | null => {
  const sql = statement.trim()
  if (/^PRAGMA\b/i.test(sql)) return null
  const create = /^CREATE\s+TABLE\s+`([^`]+)`/i.exec(sql)
  if (create) return { tables: [unquoted(create[1]!)] }
  const drop = /^DROP\s+TABLE\s+`([^`]+)`/i.exec(sql)
  if (drop) return { tables: [drop[1]!] }
  const rename = /^ALTER\s+TABLE\s+`([^`]+)`\s+RENAME\s+TO\s+`([^`]+)`/i.exec(sql)
  if (rename) return { tables: [unquoted(rename[1]!), unquoted(rename[2]!)] }
  const alter = /^ALTER\s+TABLE\s+`([^`]+)`/i.exec(sql)
  if (alter) return { tables: [unquoted(alter[1]!)] }
  const index = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+`[^`]+`\s+ON\s+`([^`]+)`/i.exec(sql)
  if (index) return { tables: [index[1]!] }
  const dropIndex = /^DROP\s+INDEX\s+`([^`]+)`/i.exec(sql)
  if (dropIndex) return { tables: [], index: dropIndex[1]! }
  const copy = /^INSERT\s+INTO\s+`([^`]+)`/i.exec(sql)
  if (copy) return { tables: [unquoted(copy[1]!)] }
  return { tables: [] }
}

/** The collections `plan` changes, and what it loses (see the file's note). */
export function migrationTargets(model: Model | null, plan: Pick<PendingMigration, 'statements' | 'losing' | 'destructive'>): MigrationTargets {
  const owners = new Map<string, string>()
  if (model) for (const [id, stored] of Object.entries(schemaIds(model).tables)) owners.set(stored.table, id)
  // A dropped index is named `<table>_<columns>_<suffix>`: the longest table name it starts with is its table.
  const ownerOfIndex = (name: string) => [...owners.keys()].filter(table => name.startsWith(`${table}_`)).sort((a, b) => b.length - a.length)[0]
  const nameOf = (id: string | undefined) => (model && id !== undefined ? entityById(model, id)?.name : undefined)

  const destructive = new Set(plan.destructive)
  const collections: Record<string, CollectionChange> = {}
  let other = 0
  for (const statement of plan.statements) {
    const found = touch(statement)
    if (!found) continue
    const tables = found.index !== undefined ? [ownerOfIndex(found.index)].filter((table): table is string => table !== undefined) : found.tables
    const id = tables.map(table => owners.get(table)).find((owner): owner is string => owner !== undefined)
    if (id === undefined) {
      other++
      continue
    }
    const change = collections[id] ??= { name: nameOf(id) ?? id, losesData: false, losing: [] }
    change.losesData ||= isDestructive(statement) || destructive.has(statement)
  }

  /** One of the module's lines of what is lost, told by the collection's name (the owner is the collection it is about, when one is). */
  const told = (line: string): { id?: string, text: string } => {
    const column = /^the data of (\w+)\.(\w+)$/.exec(line)
    if (column) {
      const id = owners.get(column[1]!)
      return { id, text: `${nameOf(id) ?? column[1]} · ${column[2]}` }
    }
    const table = /^the table (\w+)$/.exec(line)
    if (table) {
      const id = owners.get(table[1]!)
      return { id, text: `${nameOf(id) ?? table[1]} · all its rows` }
    }
    const rebuild = /^a rebuild of (\w+) to change its columns/.exec(line)
    if (rebuild) {
      const id = owners.get(rebuild[1]!)
      return { id, text: `${nameOf(id) ?? rebuild[1]} · values that don't fit its changed fields are lost or refused` }
    }
    return { text: line }
  }
  const losing: string[] = []
  for (const line of plan.losing) {
    const { id, text } = told(line)
    losing.push(text)
    const change = id === undefined ? undefined : collections[id]
    if (change) {
      change.losing.push(text)
      change.losesData = true
    }
  }
  return { collections, other, losing }
}
