import { apiUrlProblem } from '#shared/data/apiSource'
import { coerceValues } from '#shared/data/records'
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
 * drop the cached list (and record) of their collection. Every failure
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

/**
 * The values of a published app's form for a connection collection, with
 * the checks of an internal one: `{ values }` only, declared fields only,
 * each fitting its type. Messages stay generic.
 */
export function publicRemoteValues(collection: Collection, body: unknown): { values: Record<string, RecordValue> } | { status: 400 | 422, message: string } {
  if (!isObject(body) || !isObject(body.values)) return { status: 400, message: 'Send JSON { "values": { "<field>": <value> } }' }
  const declared = Object.entries(body.values).filter(([key]) => collection.fields.some(f => f.key === key))
  const checked = coerceValues(collection.fields, Object.fromEntries(declared))
  if ('problems' in checked) return { status: 422, message: checked.problems.join('; ') }
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

  /** A GET endpoint reads through the cache; any other method is sent every time. */
  async function read(target: Resolved, endpoint: Endpoint, url: string): Promise<{ json: unknown, fetchedAt: string }> {
    if (endpoint.method === 'GET') return api.fetchJson(url, { headers: target.headers })
    const { json } = await api.send(url, { method: endpoint.method, headers: target.headers })
    return { json, fetchedAt: new Date().toISOString() }
  }

  /** Drops the cached list and record after a write; a path that no longer resolves has nothing cached. */
  async function forget(target: Resolved, collection: Collection, id?: string): Promise<void> {
    const { list, get } = sourceOf(collection).endpoints
    const drop = async (endpoint: Endpoint | undefined, recordId?: string) => {
      if (endpoint?.method !== 'GET') return
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

  async function list(projectId: string, connections: Connection[], collection: Collection): Promise<DataRecord[]> {
    const endpoint = endpointOf(collection, 'list')
    const target = await connectionTarget(projectId, connections, collection)
    return redacted(target.secrets, async () => {
      const { json, fetchedAt } = await read(target, endpoint, urlFor(target, endpoint.path))
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
      const { json, fetchedAt } = await read(target, endpoint, urlFor(target, endpoint.path, id))
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
    get,

    async create(projectId: string, connections: Connection[], collection: Collection, values: Record<string, RecordValue>): Promise<DataRecord> {
      const { json } = await write(projectId, connections, collection, 'create', undefined, bodyFor(collection.fields, values))
      const now = new Date().toISOString()
      const item = readItem(json, endpointOf(collection, 'create').itemPath)
      return item ? toRecord(collection, item, now, '') : { id: '', createdAt: now, updatedAt: now, values }
    },

    /** PATCH (and POST) send the given values; PUT sends the whole record, read first. */
    async update(projectId: string, connections: Connection[], collection: Collection, id: string, values: Record<string, RecordValue>): Promise<DataRecord> {
      const endpoint = endpointOf(collection, 'update')
      const merged = endpoint.method === 'PUT' ? { ...(await get(projectId, connections, collection, id)).values, ...values } : values
      const { json } = await write(projectId, connections, collection, 'update', id, bodyFor(collection.fields, merged))
      const now = new Date().toISOString()
      const item = readItem(json, endpoint.itemPath)
      return item ? toRecord(collection, item, now, id) : { id, createdAt: now, updatedAt: now, values: merged }
    },

    async remove(projectId: string, connections: Connection[], collection: Collection, id: string): Promise<void> {
      await write(projectId, connections, collection, 'delete', id)
    },

    /** One request to a connection, uncached, for endpoint_test; the caller decides which methods may run. */
    async test(projectId: string, connection: Connection, { method, path, id }: EndpointTestInput): Promise<SendResponse> {
      const target = await resolve(projectId, connection)
      return redacted(target.secrets, async () => api.send(urlFor(target, path, id), { method, headers: target.headers }))
    }
  }
}

export type Remote = ReturnType<typeof createRemote>
