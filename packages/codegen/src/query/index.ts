import { kebab } from '../generate/text.ts'
import type { Model } from '../model/load.ts'
import type { QueryFile } from '../model/schemas.ts'

/**
 * `@bildr/codegen/query`: what a Query returns over a list of rows (V4). The
 * generated query composables run a TanStack DB live query over the entity's
 * client collection; the editor canvas has no collection, only the rows of
 * the app's list route (or the fixtures), so it runs this instead. The two
 * must agree, and `test/query/parity.test.ts` checks that against the real
 * live queries: a null field matches no condition (`ne` too), nulls sort
 * first (both ways), words sort by `localeCompare` but a condition compares them by
 * code unit (`<`, as the live query's `lt`/`gte` do: capitals before lower case), a
 * limited query without an ordering is ordered by the key (`id`, as the generated
 * composable adds), `like` is case-sensitive with `%` and `_`, a missing parameter
 * matches nothing. Pure: no Vue, no DOM, no fs.
 */

export type Row = Record<string, unknown>

/** The parts of a query that decide its rows. */
export type QueryShape = Pick<QueryFile, 'params' | 'where' | 'orderBy' | 'limit' | 'result'>

export interface QueryRun {
  /** The rows after the condition, ordering and limit (at most one for a `one` query). */
  rows: Row[]
  /** How many rows matched the condition, before the limit. */
  total: number
  /** What the page binds: the rows, or for a `one` query the first row or null. */
  value: Row[] | Row | null
}

const isParam = (value: unknown): value is { $param: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { $param?: unknown }).$param === 'string'

/** The value of a query expression: a literal, or the argument (else the default) of a `$param`. */
const resolve = (value: unknown, query: QueryShape, args: Record<string, unknown>): unknown => {
  if (!isParam(value)) return value
  const given = args[value.$param]
  return given !== undefined ? given : query.params.find(param => param.name === value.$param)?.default
}

const nil = (value: unknown): value is null | undefined => value === null || value === undefined
const plain = (value: unknown): unknown => value instanceof Date ? value.getTime() : value

/** Orders two values: null and undefined first (a descending order doesn't move them), numbers and booleans by value, anything else as words. */
const compare = (a: unknown, b: unknown): number => {
  if (nil(a) || nil(b)) return nil(a) ? (nil(b) ? 0 : -1) : 1
  const x = plain(a)
  const y = plain(b)
  if (typeof x === 'number' && typeof y === 'number') return x - y
  if (typeof x === 'boolean' && typeof y === 'boolean') return Number(x) - Number(y)
  return String(x).localeCompare(String(y))
}

/** How a condition compares two values: JavaScript's `<` and `>` (words by code unit), as the live query's `lt`/`gte` do. */
const order = (a: unknown, b: unknown): number => {
  const x = plain(a) as number | string | boolean
  const y = plain(b) as number | string | boolean
  return x < y ? -1 : x > y ? 1 : 0
}

const same = (a: unknown, b: unknown): boolean => {
  const x = plain(a)
  const y = plain(b)
  return x === y || (typeof x === 'object' && typeof y === 'object' && JSON.stringify(x) === JSON.stringify(y))
}

const likePattern = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 's')

type Op = NonNullable<QueryShape['where']>['op']

/** Whether a row's field satisfies the condition; a null field never does, whatever the operator (as in SQL). */
const matches = (op: Op, field: unknown, value: unknown): boolean => {
  if (nil(field)) return false
  switch (op) {
    case 'eq': return same(field, value)
    case 'ne': return !same(field, value)
    case 'lt': return !nil(value) && order(field, value) < 0
    case 'lte': return !nil(value) && order(field, value) <= 0
    case 'gt': return !nil(value) && order(field, value) > 0
    case 'gte': return !nil(value) && order(field, value) >= 0
    case 'in': return Array.isArray(value) && value.some(entry => same(field, entry))
    case 'like': return typeof value === 'string' && likePattern(value).test(String(field))
    default: return false
  }
}

/** Runs `query` over `rows`, with the page's `args` for its parameters. The rows are not changed. */
export function evaluateQuery(query: QueryShape, rows: readonly Row[], args: Record<string, unknown> = {}): QueryRun {
  let found = [...rows]
  if (query.where) {
    const { op, field } = query.where
    const value = resolve(query.where.value, query, args)
    found = found.filter(row => matches(op, row[field], value))
  }
  const total = found.length
  // The generated composable orders a limited query by the key when it has no ordering (a live query refuses a limit without one).
  const ordering = query.orderBy?.length ? query.orderBy : query.limit !== undefined ? [{ field: 'id', direction: 'asc' as const }] : []
  if (ordering.length) {
    found = found
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        for (const { field, direction } of ordering) {
          const [x, y] = [a.row[field], b.row[field]]
          // Nulls come first whichever way it goes (TanStack DB's default).
          const result = nil(x) || nil(y) ? compare(x, y) : direction === 'desc' ? compare(y, x) : compare(x, y)
          if (result) return result
        }
        return a.index - b.index
      })
      .map(entry => entry.row)
  }
  const limit = resolve(query.limit, query, args)
  if (typeof limit === 'number' && Number.isInteger(limit) && limit >= 0) found = found.slice(0, limit)
  if (query.result === 'one') found = found.slice(0, 1)
  return { rows: found, total, value: query.result === 'one' ? found[0] ?? null : found }
}

/**
 * The route of an entity's generated list endpoint (`GET <route>?limit&offset`, a `{ items, total }` page), the
 * one the app's client collection reads; undefined when the repository doesn't expose its list.
 */
export function listRoute(model: Model, entityId: string): string | undefined {
  for (const [name, module] of Object.entries(model.modules)) {
    const entity = module.entities.find(entry => entry.id === entityId)
    if (!entity) continue
    const repository = module.repositories.find(entry => entry.entity === entityId)
    return repository?.expose?.list && repository.operations.includes('list') ? `/api/${name}/${kebab(entity.plural)}` : undefined
  }
  return undefined
}
