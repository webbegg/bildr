import { apiUrlProblem } from '#shared/data/apiSource'
import { pageRequest, PAGING_MAX_RECORDS, withQuery } from '#shared/data/paging'
import type { PagedRecords, Paging } from '#shared/data/paging'
import { coerceValues, MAX_RECORD_BYTES, recordBytes } from '#shared/data/records'
import type { DataRecord, RecordValue } from '#shared/data/records'
import { bodyFor, buildEndpointUrl, missingEndpointMessage, readItem, readItems, remoteId, remoteRows } from '#shared/data/remote'
import type { EndpointOperation } from '#shared/data/remote'
import { headerValueProblem } from '#shared/document/schema'
import type { Collection, Connection, ConnectionEndpoints, ConnectionSource } from '#shared/document/schema'
import { allEnv, redact, resolveEnv, secretValues } from '#shared/env/variables'
import { ActionError } from '../actions/define'
import type { ApiFetcher, SendResponse } from './apiFetch'
import type { EnvStore } from './envStore'

/**
 * Connection collections on the server: each operation resolves the
 * connection's base URL, the endpoint path and the header values from the
 * project's variables (secrets included), builds the URL on the base URL's
 * origin (`buildEndpointUrl`) and sends it through the SSRF-guarded fetcher.
 * GET reads share the API sources' 60 s cache; writes are never cached and
 * drop the cached list (every page of it) and record of their collection.
 * A paged list's next URLs must stay on the base URL's origin. Every failure
 * message is redacted, so it never carries a secret value.
 */

type Endpoint = NonNullable<ConnectionEndpoints[EndpointOperation]>

interface Resolved {
  baseUrl: string
  headers: Record<string, string>
  values: Record<string, string>
  secrets: string[]
  connection: Connection
}

export interface EndpointTestInput {
  method: string
  path: string
  id?: string
  /** A GET then asks for the first page of this paging. */
  paging?: Paging
}

function sourceOf(collection: Collection): ConnectionSource {
  if (collection.source.type !== 'connection') throw new ActionError('invalid', `"${collection.name}" is not a connection collection`)
  return collection.source
}

function endpointOf<O extends EndpointOperation>(collection: Collection, operation: O): NonNullable<ConnectionEndpoints[O]> {
  return sourceOf(collection).endpoints[operation] ?? fail(missingEndpointMessage(operation))
}

function fail(message: string): never {
  throw new ActionError('invalid', message)
}

export function findConnection(connections: Connection[], connectionId: string): Connection {
  const connection = connections.find(c => c.id === connectionId)
  if (!connection) throw new ActionError('not_found', `Connection "${connectionId}" not found`)
  return connection
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const TOO_BIG = `A record can be at most ${MAX_RECORD_BYTES / 1024} KB`

/** The record limit of internal collections, measured on the record the values would make. */
function tooBig(values: Record<string, RecordValue>): boolean {
  const now = new Date().toISOString()
  return recordBytes({ id: '', createdAt: now, updatedAt: now, values }) > MAX_RECORD_BYTES
}

/**
 * The values of a published app's form for a connection collection, with
 * the checks of an internal one: `{ values }` only, declared fields only,
 * each fitting its type, at most 10 KB. Messages stay generic.
 */
export function publicRemoteValues(collection: Collection, body: unknown): { values: Record<string, RecordValue> } | { status: 400 | 413 | 422, message: string } {
  if (!isObject(body) || !isObject(body.values)) return { status: 400, message: 'Send JSON { "values": { "<field>": <value> } }' }
  const declared = Object.entries(body.values).filter(([key]) => collection.fields.some(f => f.key === key))
  const checked = coerceValues(collection.fields, Object.fromEntries(declared))
  if ('problems' in checked) return { status: 422, message: checked.problems.join('; ') }
  if (tooBig(checked.values)) return { status: 413, message: TOO_BIG }
  return { values: checked.values }
}

export function createRemote(api: ApiFetcher, env: EnvStore) {
  async function resolve(projectId: string, connection: Connection): Promise<Resolved> {
    const vars = await env.list(projectId)
    const values = allEnv(vars)
    const secrets = secretValues(vars)
    const onMissing = (name: string): never => fail(`The connection "${connection.name}" uses the variable "${name}", which is not set`)
    return redacted(secrets, async () => {
      const baseUrl = resolveEnv(connection.baseUrl, values, { onMissing })
      const problem = apiUrlProblem(baseUrl)
      if (problem) fail(`The base URL of "${connection.name}" is invalid: ${problem}`)
      const headers: Record<string, string> = {}
      for (const header of connection.headers) {
        const value = resolveEnv(header.value, values, { onMissing })
        const invalid = headerValueProblem(value)
        if (invalid) fail(`The header "${header.name}" has an invalid value: ${invalid}`)
        headers[header.name.toLowerCase()] = value
      }
      return { baseUrl, headers, values, secrets, connection }
    })
  }

  function urlFor(target: Resolved, path: string, id?: string): string {
    const resolved = resolveEnv(path, target.values, { onMissing: name => fail(`The connection "${target.connection.name}" uses the variable "${name}", which is not set`) })
    try {
      return buildEndpointUrl(target.baseUrl, resolved, { id })
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  /** Runs `task` with every failure message redacted. */
  async function redacted<T>(secrets: string[], task: () => Promise<T>): Promise<T> {
    try {
      return await task()
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), secrets)
      throw new ActionError(error instanceof ActionError ? error.code : 'invalid', message)
    }
  }

  /** List and Get read with GET through the cache, whatever method a document saved before they were GET-only has. */
  async function read(target: Resolved, url: string): Promise<{ json: unknown, fetchedAt: string }> {
    return api.fetchJson(url, { headers: target.headers })
  }

  /** Drops the cached list and record after a write; a path that no longer resolves has nothing cached. */
  async function forget(target: Resolved, collection: Collection, id?: string): Promise<void> {
    const { list, get } = sourceOf(collection).endpoints
    const drop = async (endpoint: Endpoint | undefined, recordId?: string) => {
      if (!endpoint) return
      try {
        await api.invalidate(urlFor(target, endpoint.path, recordId), { headers: target.headers })
      } catch {
        // Not resolvable, so never fetched.
      }
    }
    await drop(list)
    if (id !== undefined) await drop(get, id)
  }

  function toRecord(collection: Collection, item: unknown, at: string, fallbackId: string): DataRecord {
    const { idPath } = sourceOf(collection)
    const { values } = remoteRows([item], collection.fields, idPath)[0]!
    return { id: remoteId(item, idPath) ?? fallbackId, createdAt: at, updatedAt: at, values }
  }

  async function connectionTarget(projectId: string, connections: Connection[], collection: Collection): Promise<Resolved> {
    return resolve(projectId, findConnection(connections, sourceOf(collection).connectionId))
  }

  /** Items `offset` to `offset + limit - 1` of a paged list, within the paging caps. */
  async function page(projectId: string, connections: Connection[], collection: Collection, { offset, limit }: { offset: number, limit: number }): Promise<PagedRecords> {
    const endpoint = endpointOf(collection, 'list')
    const paging = endpoint.paging ?? fail(`"${collection.name}" has no paging`)
    const target = await connectionTarget(projectId, connections, collection)
    return redacted(target.secrets, async () => {
      const origin = new URL(target.baseUrl).origin
      const { items, total, hasMore, fetchedAt } = await api.fetchPages(urlFor(target, endpoint.path), { headers: target.headers, paging, itemsPath: endpoint.itemsPath, origin, offset, limit })
      const { idPath } = sourceOf(collection)
      const records = remoteRows(items, collection.fields, idPath).map((row, i) => ({ id: remoteId(items[i], idPath) ?? String(offset + i), createdAt: fetchedAt, updatedAt: fetchedAt, values: row.values }))
      return { records, total, hasMore }
    })
  }

  /** Every item of the list; for a paged one, the pages up to the caps. */
  async function list(projectId: string, connections: Connection[], collection: Collection): Promise<DataRecord[]> {
    const endpoint = endpointOf(collection, 'list')
    if (endpoint.paging) return (await page(projectId, connections, collection, { offset: 0, limit: PAGING_MAX_RECORDS })).records
    const target = await connectionTarget(projectId, connections, collection)
    return redacted(target.secrets, async () => {
      const { json, fetchedAt } = await read(target, urlFor(target, endpoint.path))
      const items = readItems(json, endpoint.itemsPath) ?? fail(`The API response has no list of items at "${endpoint.itemsPath ?? ''}"`)
      return remoteRows(items, collection.fields, sourceOf(collection).idPath).map(row => ({ id: row.id, createdAt: fetchedAt, updatedAt: fetchedAt, values: row.values }))
    })
  }

  async function get(projectId: string, connections: Connection[], collection: Collection, id: string): Promise<DataRecord> {
    const { endpoints } = sourceOf(collection)
    const notFound = (): never => {
      throw new ActionError('not_found', `Record "${id}" not found in "${collection.name}"`)
    }
    if (!endpoints.get) {
      if (!endpoints.list) fail(missingEndpointMessage('get'))
      return (await list(projectId, connections, collection)).find(r => r.id === id) ?? notFound()
    }
    const endpoint = endpoints.get
    const target = await connectionTarget(projectId, connections, collection)
    return redacted(target.secrets, async () => {
      const { json, fetchedAt } = await read(target, urlFor(target, endpoint.path, id))
      const item = readItem(json, endpoint.itemPath) ?? notFound()
      return toRecord(collection, item, fetchedAt, id)
    })
  }

  async function write(projectId: string, connections: Connection[], collection: Collection, operation: 'create' | 'update' | 'delete', id: string | undefined, body?: Record<string, unknown>): Promise<SendResponse> {
    const endpoint = endpointOf(collection, operation)
    const target = await connectionTarget(projectId, connections, collection)
    return redacted(target.secrets, async () => {
      const response = await api.send(urlFor(target, endpoint.path, id), { method: endpoint.method, headers: target.headers, body })
      await forget(target, collection, id)
      return response
    })
  }

  return {
    list,
    page,
    get,

    async create(projectId: string, connections: Connection[], collection: Collection, values: Record<string, RecordValue>): Promise<DataRecord> {
      if (tooBig(values)) fail(TOO_BIG)
      const { json } = await write(projectId, connections, collection, 'create', undefined, bodyFor(collection.fields, values))
      const now = new Date().toISOString()
      const item = readItem(json, endpointOf(collection, 'create').itemPath)
      return item ? toRecord(collection, item, now, '') : { id: '', createdAt: now, updatedAt: now, values }
    },

    /** PATCH (and POST) send the given values; PUT sends the whole record, read first. */
    async update(projectId: string, connections: Connection[], collection: Collection, id: string, values: Record<string, RecordValue>): Promise<DataRecord> {
      const endpoint = endpointOf(collection, 'update')
      if (tooBig(values)) fail(TOO_BIG)
      const merged = endpoint.method === 'PUT' ? { ...(await get(projectId, connections, collection, id)).values, ...values } : values
      if (tooBig(merged)) fail(TOO_BIG)
      const { json } = await write(projectId, connections, collection, 'update', id, bodyFor(collection.fields, merged))
      const now = new Date().toISOString()
      const item = readItem(json, endpoint.itemPath)
      return item ? toRecord(collection, item, now, id) : { id, createdAt: now, updatedAt: now, values: merged }
    },

    async remove(projectId: string, connections: Connection[], collection: Collection, id: string): Promise<void> {
      await write(projectId, connections, collection, 'delete', id)
    },

    /** One request to a connection, uncached, for endpoint_test; the caller decides which methods may run. */
    async test(projectId: string, connection: Connection, { method, path, id, paging }: EndpointTestInput): Promise<SendResponse> {
      const target = await resolve(projectId, connection)
      return redacted(target.secrets, async () => {
        const url = urlFor(target, path, id)
        return api.send(paging && method === 'GET' ? withQuery(url, pageRequest(paging, 0)) : url, { method, headers: target.headers })
      })
    },

    /** The page after a GET `test` answered `first`, uncached; null when there is none. */
    async testPageTwo(projectId: string, connection: Connection, { path, id, paging }: EndpointTestInput & { paging: Paging }, first: SendResponse): Promise<SendResponse | null> {
      const target = await resolve(projectId, connection)
      return redacted(target.secrets, async () => {
        const url = withQuery(urlFor(target, path, id), pageRequest(paging, 0))
        const next = api.pageTwoUrl(url, paging, first, new URL(target.baseUrl).origin)
        return next === null ? null : api.send(next, { method: 'GET', headers: target.headers })
      })
    }
  }
}

export type Remote = ReturnType<typeof createRemote>
