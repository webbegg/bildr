import { slugify } from '../document/factory'
import type { CollectionSource, ConnectionEndpoints } from '../document/schema'
import type { EndpointMethod, EndpointOperation } from './remote'

/** `name`, or `name 2`, `name 3`… : the first whose slug no collection has (slugs are unique). */
export function uniqueCollectionName(name: string, collections: readonly { slug: string }[]): string {
  const taken = new Set(collections.map(c => c.slug))
  let candidate = name
  for (let n = 2; taken.has(slugify(candidate)); n++) candidate = `${name} ${n}`
  return candidate
}

/** What the editor can do with a collection's records; `live` ones are read from a remote API on each load. */
export interface CollectionCaps {
  create: boolean
  update: boolean
  delete: boolean
  get: boolean
  live: boolean
}

/** A collection's source as far as its capabilities go (visitor snapshots carry only the type). */
interface CapsSource {
  source: { type: CollectionSource['type'], endpoints?: ConnectionEndpoints }
}

/**
 * Internal collections can do everything, API ones only read, and connection
 * ones what they have endpoints for (a record opens through `get`, or the
 * list it was read from).
 */
export function collectionCaps({ source }: CapsSource): CollectionCaps {
  if (source.type === 'internal') return { create: true, update: true, delete: true, get: true, live: false }
  if (source.type === 'api') return { create: false, update: false, delete: false, get: true, live: true }
  const endpoints = source.endpoints ?? {}
  return { create: !!endpoints.create, update: !!endpoints.update, delete: !!endpoints.delete, get: !!(endpoints.get || endpoints.list), live: true }
}

/**
 * Whether a Form can add records to the collection. Visitor snapshots strip
 * connection endpoints, so there a connection collection is offered and the
 * public endpoint refuses it when it has no create endpoint.
 */
export function takesFormRecords(collection: CapsSource): boolean {
  if (collection.source.type === 'connection' && !collection.source.endpoints) return true
  return collectionCaps(collection).create
}

const DEFAULT_METHODS: Record<EndpointOperation, EndpointMethod> = { list: 'GET', get: 'GET', create: 'POST', update: 'PATCH', delete: 'DELETE' }

/** An operation's REST default next to the list path (without its query): `/posts`, `/posts/{id}`. */
export function defaultEndpoint(operation: EndpointOperation, listPath: string | undefined): { method: EndpointMethod, path: string } {
  const base = `/${(listPath ?? '').split('?')[0]!.replace(/^\/+|\/+$/g, '')}`
  const one = operation === 'get' || operation === 'update' || operation === 'delete'
  return { method: DEFAULT_METHODS[operation], path: one ? `${base.replace(/\/$/, '')}/{id}` : base }
}
