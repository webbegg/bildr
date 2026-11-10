import { ENV_NAME, ENV_NAME_HINT, ENV_REF, envRefs } from '../env/variables'
import type { Field } from '../document/schema'
import { itemsAt, mapItems, readPath } from './apiSource'
import type { ApiRow } from './apiSource'
import type { RecordValue } from './records'

/**
 * Connection collections: records read and written through a connection's
 * endpoints (a base URL plus one relative path per operation). These helpers
 * are pure; the server resolves env refs first, then builds each URL here,
 * so a path can never leave the base URL's origin or path.
 */

export const ENDPOINT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type EndpointMethod = typeof ENDPOINT_METHODS[number]

export const ENDPOINT_OPERATIONS = ['list', 'get', 'create', 'update', 'delete'] as const
export type EndpointOperation = typeof ENDPOINT_OPERATIONS[number]

export const OPERATION_LABELS: Record<EndpointOperation, string> = { list: 'List', get: 'Get', create: 'Create', update: 'Update', delete: 'Delete' }

export const ENDPOINT_PATH_MAX = 500
export const DEFAULT_ID_PATH = 'id'

export function missingEndpointMessage(operation: EndpointOperation): string {
  return `This collection has no ${OPERATION_LABELS[operation]} endpoint`
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const BAD_CHARS = /[\\\s#]/
const hasControl = (text: string) => [...text].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
const ID_REF = /\{id\}/g

/**
 * Why `path` cannot be an endpoint path, if it cannot: it must be relative
 * to the base URL (no scheme, no leading `//`, no `://` before the query),
 * without `\`, whitespace, `#`
 * or `.`/`..` segments. `{id}` and `{{ env.NAME }}` refs are allowed; the
 * server checks the resolved path again.
 */
export function endpointPathProblem(path: string): string | undefined {
  if (path.length > ENDPOINT_PATH_MAX) return `Paths can be at most ${ENDPOINT_PATH_MAX} characters`
  const bad = envRefs(path).find(name => !ENV_NAME.test(name))
  if (bad) return `"${bad}" is not a variable name: ${ENV_NAME_HINT}`
  const plain = path.replace(ENV_REF, 'x').replace(ID_REF, 'x')
  const pathPart = plain.split('?')[0]!
  if (SCHEME.test(plain) || plain.startsWith('//') || pathPart.includes('://')) return 'Use a path relative to the base URL, e.g. /posts, not a full URL'
  if (BAD_CHARS.test(plain) || hasControl(plain)) return 'Paths cannot contain spaces, \\ or #'
  const segments = pathPart.split('/')
  if (segments.some(s => ['.', '..'].includes(s.replace(/%2e/gi, '.')))) return 'Paths cannot contain . or .. segments'
  return undefined
}

/**
 * The URL of an endpoint: the base URL's path and `path` joined with exactly
 * one slash, `{id}` replaced by the encoded record id, and the base query
 * followed by the path's. Throws when the path is not a relative one or the
 * result is not on the base URL's origin.
 */
export function buildEndpointUrl(baseUrl: string, path: string, { id }: { id?: string } = {}): string {
  const problem = endpointPathProblem(path)
  if (problem) throw new Error(problem)
  const base = new URL(baseUrl)
  let resolved = path
  if (path.includes('{id}')) {
    if (id === undefined) throw new Error('This endpoint path needs a record id')
    const encoded = encodeURIComponent(id)
    if (!encoded || encoded === '.' || encoded === '..') throw new Error('Invalid record id')
    resolved = path.replaceAll('{id}', encoded)
  }
  const cut = resolved.indexOf('?')
  const rest = (cut < 0 ? resolved : resolved.slice(0, cut)).replace(/^\//, '')
  const query = cut < 0 ? '' : resolved.slice(cut + 1)
  const basePath = base.pathname.replace(/\/+$/, '')
  const url = new URL(`${base.origin}${rest ? `${basePath}/${rest}` : basePath || '/'}`)
  const search = [base.search.slice(1), query].filter(Boolean).join('&')
  url.search = search ? `?${search}` : ''
  if (url.origin !== base.origin) throw new Error('The endpoint is not on the connection\'s base URL')
  return url.href
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A create or update body: each given value at its field's path (dot paths nest), or at its key. */
export function bodyFor(fields: Field[], values: Record<string, RecordValue>): Record<string, unknown> {
  const body: Record<string, unknown> = Object.create(null)
  for (const field of fields) {
    if (!Object.hasOwn(values, field.key)) continue
    const segments = (field.path ?? field.key).split('.')
    let target = body
    for (const segment of segments.slice(0, -1)) {
      if (!Object.hasOwn(target, segment) || !isObject(target[segment])) target[segment] = Object.create(null)
      target = target[segment] as Record<string, unknown>
    }
    target[segments.at(-1)!] = values[field.key]
  }
  return body
}

/** The items array at `itemsPath` (the root by default), or undefined. */
export function readItems(json: unknown, itemsPath: string | undefined): unknown[] | undefined {
  return itemsAt(json, itemsPath ?? '')
}

/** The item object at `itemPath` (the root by default), or undefined. */
export function readItem(json: unknown, itemPath: string | undefined): Record<string, unknown> | undefined {
  const item = readPath(json, itemPath ?? '')
  return isObject(item) ? item : undefined
}

/** The id of an item at `idPath`, when it is a non-empty string or a number. */
export function remoteId(item: unknown, idPath = DEFAULT_ID_PATH): string | undefined {
  const id = readPath(item, idPath)
  return (typeof id === 'string' && id !== '') || typeof id === 'number' ? String(id) : undefined
}

/** Items mapped with the fields; each id read at `idPath`, else the item's index. */
export function remoteRows(items: unknown[], fields: Field[], idPath = DEFAULT_ID_PATH): ApiRow[] {
  return mapItems(items, fields).map((row, i) => ({ ...row, id: remoteId(items[i], idPath) ?? String(i) }))
}
