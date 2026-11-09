import { fieldLabel } from '../document/factory'
import type { Field, FieldType } from '../document/schema'
import { coerce, isDate } from './records'
import type { RecordValue } from './records'

/**
 * API sources: a collection whose records are read live from a JSON
 * endpoint. These helpers are pure, so the server (which fetches) and the
 * editor (which previews an edited mapping) map items the same way: find the
 * items array, propose fields, then map each item through the fields' paths.
 */

/** A field of an API collection; `path` (default: the key) is a dot path into the item, e.g. `origin.name`. */
export type ApiField = Field

/** A mapped item, shaped like a record without timestamps. */
export interface ApiRow {
  id: string
  values: Record<string, RecordValue>
}

export const API_URL_MAX = 2000
export const API_PORTS = ['80', '443', '8080', '8443']
export const API_PATH_MAX = 200
/** Dot-separated segments of word characters, `$`, `@`, `:` or `-`, e.g. `origin.name`. */
export const API_PATH = /^[\w$@:-]+(?:\.[\w$@:-]+)*$/
export const API_PATH_HINT = 'Use a dot path such as origin.name'

const ITEM_NAMES = ['results', 'data', 'items', 'records']
const SAMPLE_SIZE = 20
const MAX_FIELDS = 50
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg|avif)$/i
const IMAGE_KEY = /image|avatar|photo|thumbnail|picture/i
const PATH_SEGMENT = /^[\w$@:-]+$/

/**
 * The part of the SSRF rules that needs no DNS: http(s) only, no
 * credentials, and only the default or common alternative ports. The server
 * also checks every resolved address (`server/utils/urlGuard`).
 */
export function apiUrlProblem(url: string): string | undefined {
  if (url.length > API_URL_MAX) return `URLs can be at most ${API_URL_MAX} characters`
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Only http and https URLs can be fetched'
  if (parsed.username || parsed.password) return 'URLs with a user name or password are not allowed'
  if (parsed.port && !API_PORTS.includes(parsed.port)) return `Port ${parsed.port} is not allowed; use 80, 443, 8080 or 8443`
  return undefined
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isPrimitive = (value: unknown): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value)
const isItemArray = (value: unknown): value is unknown[] => Array.isArray(value) && value.some(isObject)

/** The value at a dot path (`''` is the value itself); numeric segments index arrays. */
export function readPath(value: unknown, path: string): unknown {
  if (path === '') return value
  let current = value
  for (const segment of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)]
    else if (isObject(current) && Object.hasOwn(current, segment)) current = current[segment]
    else return undefined
  }
  return current
}

/** The array at `itemsPath` in a response, or undefined when there is none. */
export function itemsAt(json: unknown, itemsPath: string): unknown[] | undefined {
  const items = readPath(json, itemsPath)
  return Array.isArray(items) ? items : undefined
}

/**
 * Finds the items in a response: `results`, `data`, `items` or `records`,
 * else the root array, else the first array of objects one level deep.
 * `itemsPath` is `''` for the root; null when there is no array of items.
 */
export function detectItems(json: unknown): { itemsPath: string, items: unknown[] } | null {
  if (Array.isArray(json)) return { itemsPath: '', items: json }
  if (!isObject(json)) return null
  for (const name of ITEM_NAMES) {
    if (Array.isArray(json[name])) return { itemsPath: name, items: json[name] }
  }
  for (const [key, value] of Object.entries(json)) {
    if (PATH_SEGMENT.test(key) && isItemArray(value)) return { itemsPath: key, items: value }
  }
  for (const [key, value] of Object.entries(json)) {
    if (!PATH_SEGMENT.test(key) || !isObject(value)) continue
    for (const [inner, items] of Object.entries(value)) {
      if (PATH_SEGMENT.test(inner) && isItemArray(items)) return { itemsPath: `${key}.${inner}`, items }
    }
  }
  return null
}

/** `origin name` / `avatar_url` / `firstName` → `originName` / `avatarUrl` / `firstName`; valid as a field key. */
function camelKey(raw: string): string {
  const words = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w.toLowerCase())
  let key = words.map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join('').slice(0, 60)
  if (!key) key = 'field'
  if (/^\d/.test(key)) key = `f${key}`
  // `id` is reserved for the record id.
  return key === 'id' ? 'externalId' : key
}

function isImageValue(key: string, value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return IMAGE_FILE.test(url.pathname) || IMAGE_KEY.test(key)
}

function fits(type: FieldType, key: string, value: string | number | boolean): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'date':
      return typeof value === 'string' && isDate(value)
    case 'image':
      return typeof value === 'string' && isImageValue(key, value)
    default:
      return true
  }
}

interface Column {
  path: string
  /** Raw key or `parent child`, turned into the field key. */
  name: string
  values: (string | number | boolean)[]
  isList: boolean
  skip: boolean
}

/**
 * Proposes fields from up to 20 items: every top-level value, and the values
 * of nested objects one level down (`origin.name` → `originName`). A type
 * fits when every non-empty sampled value has it; arrays of primitives read
 * as text, arrays of objects are skipped. Keys are unique and never `id`
 * (the API's `id` becomes `externalId`).
 */
export function inferFields(items: unknown[]): ApiField[] {
  const columns = new Map<string, Column>()
  const visit = (path: string, name: string, value: unknown) => {
    let column = columns.get(path)
    if (!column) {
      column = { path, name, values: [], isList: false, skip: false }
      columns.set(path, column)
    }
    if (Array.isArray(value)) {
      column.isList = true
      if (!value.every(isPrimitive)) column.skip = true
    } else if (isPrimitive(value) && value !== '') {
      column.values.push(value)
    } else if (isObject(value)) {
      column.skip = true
    }
  }
  for (const item of items.slice(0, SAMPLE_SIZE)) {
    if (!isObject(item)) continue
    for (const [key, value] of Object.entries(item)) {
      if (!PATH_SEGMENT.test(key)) continue
      if (!isObject(value)) {
        visit(key, key, value)
        continue
      }
      for (const [inner, innerValue] of Object.entries(value)) {
        if (PATH_SEGMENT.test(inner) && !isObject(innerValue)) visit(`${key}.${inner}`, `${key} ${inner}`, innerValue)
      }
    }
  }

  const used = new Set<string>()
  const fields: ApiField[] = []
  for (const column of columns.values()) {
    if (column.skip || fields.length >= MAX_FIELDS) continue
    const base = camelKey(column.name)
    let key = base
    for (let n = 2; used.has(key); n++) key = `${base}${n}`
    used.add(key)
    const leaf = column.path.split('.').at(-1)!
    const type: FieldType = column.isList || !column.values.length
      ? 'text'
      : (['number', 'boolean', 'date', 'image'] as const).find(t => column.values.every(v => fits(t, leaf, v))) ?? 'text'
    fields.push({ key, label: fieldLabel(key), type, path: column.path })
  }
  return fields
}

function mapValue(type: FieldType, raw: unknown): RecordValue {
  let value = raw
  if (Array.isArray(value)) value = value.every(isPrimitive) ? value.map(String).join(', ') : null
  if (value === undefined || isObject(value)) return null
  if (type === 'text' && (typeof value === 'number' || typeof value === 'boolean')) return String(value)
  return coerce(type, value) ?? null
}

/**
 * Maps items to rows through the fields' paths. A row's id is the item's
 * `id` when it has one, else its index. Values are coerced to the field type;
 * missing values and values that do not fit read as null.
 */
export function mapItems(items: unknown[], fields: ApiField[]): ApiRow[] {
  return items.map((item, index) => {
    const ownId = isObject(item) ? item.id : undefined
    const id = (typeof ownId === 'string' && ownId !== '') || typeof ownId === 'number' ? String(ownId) : String(index)
    const values: Record<string, RecordValue> = {}
    for (const field of fields) values[field.key] = mapValue(field.type, readPath(item, field.path ?? field.key))
    return { id, values }
  })
}
