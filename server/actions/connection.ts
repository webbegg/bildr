import { z } from 'zod'
import { detectItems, inferFields, mapItems } from '#shared/data/apiSource'
import { ENDPOINT_METHODS, readItem, readItems } from '#shared/data/remote'
import { createConnection } from '#shared/document/factory'
import type { Operation } from '#shared/document/operations'
import { ApiHeadersSchema, ApiUrlSchema, EndpointPathSchema, IdSchema, ItemsPathSchema } from '#shared/document/schema'
import type { Connection, Project } from '#shared/document/schema'
import { findConnection } from '../utils/remote'
import { ActionError, defineAction } from './define'

/**
 * Connections: a remote API (base URL and headers) that connection
 * collections read and write through, one endpoint per record operation.
 * They are part of the document (undoable); secrets stay in env variables,
 * referenced as {{ env.NAME }} and resolved on the server only.
 */

const ENV_HINT = 'The base URL and header values may use {{ env.NAME }} (see env_list); put API keys in a secret variable, e.g. header Authorization: Bearer {{ env.API_KEY }}, never literally. Requests only ever go to the resolved base URL\'s origin.'
const FLOW = 'To build a remote collection: connection_create, then endpoint_test on the list path (e.g. GET /posts) to see the items and the proposed fields, then collection_create with source { type: "connection", connectionId, idPath?, endpoints: { list?, get?, create?, update?, delete? } } (each endpoint { method, path, itemsPath? for list, itemPath? for the others }; paths are relative to the base URL and may use {id} and {{ env.NAME }}) and the fields (key, label, type, path).'

const ConnectionRef = z.string().min(1).max(64).describe('Connection id')

function connectionIn(project: Project, connectionId: string): Connection {
  return findConnection(project.connections, connectionId)
}

export const connectionCreate = defineAction({
  name: 'connection_create',
  description: `Create a connection to a remote JSON API: a name, an absolute http(s) base URL (e.g. https://api.example.com/v1) and up to 10 headers sent with every request. ${ENV_HINT} ${FLOW} Undoable.`,
  input: z.object({
    projectId: IdSchema,
    name: z.string().trim().min(1).max(100),
    baseUrl: ApiUrlSchema.describe('Absolute http(s) URL that endpoint paths are relative to'),
    headers: ApiHeadersSchema.optional().describe('Up to 10 request headers { name, value }')
  }),
  run: async ({ projectId, name, baseUrl, headers }, ctx) => {
    const connection = createConnection(name, baseUrl, headers)
    const project = await ctx.services.mutate(ctx, projectId, 'Create connection', [{ op: 'addConnection', index: Number.MAX_SAFE_INTEGER, connection }])
    return { version: project.version, connectionId: connection.id, connection: connectionIn(project, connection.id) }
  }
})

export const connectionUpdate = defineAction({
  name: 'connection_update',
  description: `Rename a connection or change its base URL or headers (headers replaces the whole list). Properties left out keep their value. ${ENV_HINT} Undoable.`,
  input: z.object({
    projectId: IdSchema,
    connectionId: ConnectionRef,
    name: z.string().trim().min(1).max(100).optional(),
    baseUrl: ApiUrlSchema.optional(),
    headers: ApiHeadersSchema.optional()
  }),
  run: async ({ projectId, connectionId, ...patch }, ctx) => {
    const { id } = connectionIn(await ctx.services.loadProject(projectId), connectionId)
    const project = await ctx.services.mutate(ctx, projectId, 'Update connection', [{ op: 'updateConnection', connectionId: id, ...patch }])
    return { version: project.version, connection: connectionIn(project, id) }
  }
})

export const connectionDelete = defineAction({
  name: 'connection_delete',
  description: 'Delete a connection. Refused while collections use it, unless force is true: then those collections are deleted too. One undo step brings everything back. Nothing is deleted on the remote API.',
  input: z.object({
    projectId: IdSchema,
    connectionId: ConnectionRef,
    force: z.boolean().optional().describe('Also delete the collections that use the connection')
  }),
  run: async ({ projectId, connectionId, force }, ctx) => {
    const current = await ctx.services.loadProject(projectId)
    const { id } = connectionIn(current, connectionId)
    const users = force ? current.collections.filter(c => c.source.type === 'connection' && c.source.connectionId === id) : []
    const ops: Operation[] = [...users.map(c => ({ op: 'removeCollection' as const, collectionId: c.id })), { op: 'removeConnection', connectionId: id }]
    const project = await ctx.services.mutate(ctx, projectId, 'Delete connection', ops)
    return { version: project.version, deletedCollections: users.map(c => c.id) }
  }
})

export const endpointTest = defineAction({
  name: 'endpoint_test',
  description: 'Send one request to a connection endpoint and propose a collection mapping. Read-only: not recorded in the history. Only GET runs by default; any other method can change data on the remote API (it cannot be undone), so it needs confirm: true. Returns the HTTP status and, when the response holds a list, the items path it found (or itemsPath), the first 10 raw items, the proposed fields (key, label, type, path) and the items mapped with them (sample), with the item count; for a single object, the item, the proposed fields and the sample.',
  input: z.object({
    projectId: IdSchema,
    connectionId: ConnectionRef,
    method: z.enum(ENDPOINT_METHODS),
    path: EndpointPathSchema.describe('Relative to the base URL, e.g. /posts or /posts/{id}'),
    id: IdSchema.optional().describe('Replaces {id} in the path'),
    itemsPath: ItemsPathSchema.optional().describe('Read the items at this path instead of detecting them'),
    itemPath: ItemsPathSchema.optional().describe('For a single item: where it is in the response'),
    confirm: z.boolean().optional().describe('Required for any method but GET')
  }),
  readOnly: true,
  run: async ({ projectId, connectionId, method, path, id, itemsPath, itemPath, confirm }, ctx) => {
    if (method !== 'GET' && confirm !== true) {
      throw new ActionError('invalid', `endpoint_test only sends GET unless confirm is true: a ${method} can change data on the remote API, and it cannot be undone`)
    }
    const connection = connectionIn(await ctx.services.loadProject(projectId), connectionId)
    const { status, json } = await ctx.services.remote.test(projectId, connection, { method, path, id })
    const items = itemsPath === undefined ? undefined : readItems(json, itemsPath)
    if (itemsPath !== undefined && !items) throw new ActionError('invalid', `The API response has no list of items at "${itemsPath}"`)
    const detected = items ? { itemsPath, items } : itemPath === undefined ? detectItems(json) : null
    if (detected) {
      const fields = inferFields(detected.items)
      const first = detected.items.slice(0, 10)
      return { status, itemsPath: detected.itemsPath, fields, items: first, sample: mapItems(first, fields), total: detected.items.length }
    }
    const item = readItem(json, itemPath)
    const fields = item ? inferFields([item]) : []
    return { status, item: item ?? json, fields, sample: item ? mapItems([item], fields) : [] }
  }
})
