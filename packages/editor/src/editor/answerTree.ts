import { detectItems } from '@bildr/codegen/edit'

/**
 * Try it's answer as a tree (api-calls T2, S5).
 *
 * `answerLists` is the lists in an answer that a query can take its items from: lists of objects reached by keys only (the dotted path
 * "Where the list is" reads, `data.items`; empty for an answer that is the list), at most 6 keys down. One is recommended: the one the
 * module finds (`detectItems`: `results`, `data`, `items` or `records`, else the first top-level list of objects), else, going down level
 * by level, the first one named like that, else the first one found. It comes first; the others follow in the answer's order.
 *
 * `treeRows` is the rows of the tree as the user has folded it (`open`, by `rowId`). A container shows at most 50 entries, then how many
 * more there are.
 */

const KEY = /^[\w$@:-]+$/
const ITEM_NAMES = new Set(['results', 'data', 'items', 'records'])
const MAX_DEPTH = 6
const MAX_ENTRIES = 50
const MAX_TEXT = 80

export interface AnswerList {
  path: string
  count: number
  recommended: boolean
}

export interface TreeRow {
  /** Tells a row from another (`rowId` of the keys to it). */
  id: string
  key: string
  depth: number
  kind: 'object' | 'array' | 'value' | 'more'
  summary: string
  /** A container that is open. */
  open?: boolean
  /** The list a query can take its items from, when this row is one. */
  list?: AnswerList
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isItemList = (value: unknown): value is unknown[] => Array.isArray(value) && value.some(isObject)

/** The id of the row at `keys`: keys with dots in them stay apart from nested ones. */
export const rowId = (keys: readonly (string | number)[]): string => JSON.stringify(keys.map(String))

export function answerLists(json: unknown): AnswerList[] {
  if (isItemList(json)) return [{ path: '', count: json.length, recommended: true }]
  // In the answer's order, top to bottom.
  const found: { path: string, count: number, depth: number, named: boolean }[] = []
  const walk = (value: Record<string, unknown>, keys: string[]) => {
    for (const [key, inner] of Object.entries(value)) {
      if (!KEY.test(key)) continue
      const here = [...keys, key]
      if (isItemList(inner)) found.push({ path: here.join('.'), count: inner.length, depth: here.length, named: ITEM_NAMES.has(key) })
      else if (isObject(inner) && here.length < MAX_DEPTH) walk(inner, here)
    }
  }
  if (isObject(json)) walk(json, [])
  const shallowest = (lists: typeof found) => lists.reduce<(typeof found)[number] | undefined>((best, list) => !best || list.depth < best.depth ? list : best, undefined)
  const module = detectItems(json)?.itemsPath
  const pick = found.find(list => list.path === module) ?? shallowest(found.filter(list => list.named)) ?? shallowest(found)
  return [...(pick ? [pick] : []), ...found.filter(list => list !== pick)].map(list => ({ path: list.path, count: list.count, recommended: list === pick }))
}

/** The rows open at first: the way to the recommended list, and the list itself. */
export function initialOpen(json: unknown, lists: readonly AnswerList[]): Set<string> {
  const open = new Set<string>()
  const recommended = lists.find(list => list.recommended)
  if (!recommended?.path || !isObject(json)) return open
  const keys = recommended.path.split('.')
  for (let at = 1; at <= keys.length; at++) open.add(rowId(keys.slice(0, at)))
  return open
}

const valueText = (value: unknown): string => {
  if (typeof value === 'string' && value.length > MAX_TEXT) return `${JSON.stringify(value.slice(0, MAX_TEXT)).slice(0, -1)}…"`
  return value === undefined ? 'undefined' : JSON.stringify(value)
}
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const summaryOf = (value: unknown): string => Array.isArray(value) ? count(value.length, 'item', 'items') : isObject(value) ? count(Object.keys(value).length, 'field', 'fields') : valueText(value)
const kindOf = (value: unknown): TreeRow['kind'] => Array.isArray(value) ? 'array' : isObject(value) ? 'object' : 'value'

export function treeRows(json: unknown, open: ReadonlySet<string>, lists: readonly AnswerList[]): TreeRow[] {
  if (!isObject(json) && !Array.isArray(json)) return [{ id: rowId([]), key: 'answer', depth: 0, kind: 'value', summary: valueText(json) }]
  const byPath = new Map(lists.map(list => [list.path, list]))
  const rows: TreeRow[] = []
  // `dotted` is the list path to here, or null once a list was gone through (a list in an item is not where items are).
  const walk = (container: Record<string, unknown> | unknown[], keys: string[], dotted: string[] | null, depth: number) => {
    const entries: [string, unknown][] = Array.isArray(container) ? container.map((value, at) => [String(at), value]) : Object.entries(container)
    for (const [key, value] of entries.slice(0, MAX_ENTRIES)) {
      const here = [...keys, key]
      const path = dotted && !Array.isArray(container) ? [...dotted, key] : null
      const id = rowId(here)
      const kind = kindOf(value)
      const list = path ? byPath.get(path.join('.')) : undefined
      const isOpen = kind !== 'value' && open.has(id)
      rows.push({ id, key, depth, kind, summary: summaryOf(value), ...(kind !== 'value' ? { open: isOpen } : {}), ...(list ? { list } : {}) })
      if (isOpen) walk(value as Record<string, unknown> | unknown[], here, Array.isArray(value) ? null : path, depth + 1)
    }
    if (entries.length > MAX_ENTRIES) rows.push({ id: rowId([...keys, '…']), key: '…', depth, kind: 'more', summary: `${entries.length - MAX_ENTRIES} more` })
  }
  walk(json, [], Array.isArray(json) ? null : [], 0)
  return rows
}
