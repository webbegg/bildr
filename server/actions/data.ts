import { z } from 'zod'
import { detectItems, inferFields, mapItems } from '#shared/data/apiSource'
import { detectPaging, PAGING_MAX_PAGES, PAGING_MAX_RECORDS, pageSample, queryPaged, totalFrom } from '#shared/data/paging'
import type { PageTwo } from '#shared/data/paging'
import { coerceValues, MAX_RECORD_BYTES, MAX_RECORDS_PER_COLLECTION, queryRecords, readRecord, recordBytes, RECORD_META_FIELDS } from '#shared/data/records'
import type { DataRecord, RecordValue } from '#shared/data/records'
import { createCollection, fieldLabel, newId, slugify } from '#shared/document/factory'
import type { Operation } from '#shared/document/operations'
import { ApiHeadersSchema, ApiPathSchema, ApiUrlSchema, CollectionSourceSchema, FieldKeySchema, FieldTypeSchema, IdSchema, PagingSchema, SlugSchema } from '#shared/document/schema'
import type { Collection, Field, Project } from '#shared/document/schema'
import { createPublicRecord } from '../utils/publicData'
import type { PublicWriteResult } from '../utils/publicData'
import { findConnection, publicRemoteValues } from '../utils/remote'
import { ActionError, defineAction } from './define'
import type { ActionContext } from './define'
import { apiItems } from './services'

/**
 * Collections: the schema is part of the document (undoable, published with
 * the snapshot); records are live data outside it, so record actions never
 * bump the project version or the undo history. They emit `scope: 'data'`
 * change events instead, so open editors reload the records.
 */

const CollectionRef = z.string().min(1).max(64).describe('Collection id or slug')
const ValueSchema = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()])
const ValuesSchema = z.record(z.string(), ValueSchema)
const FIELD_TYPES_HINT = 'text (string), number, boolean, date (YYYY-MM-DD or ISO date-time) or image (http(s) URL or /path)'

const FieldInput = z.object({
  key: FieldKeySchema.describe('Record key, e.g. price or servedFrom; unique in the collection; "id" is reserved'),
  label: z.string().trim().min(1).max(100).optional().describe('Shown in the editor; defaults to the key in words'),
  type: FieldTypeSchema.describe(`Value type: ${FIELD_TYPES_HINT}`),
  path: ApiPathSchema.optional().describe('API and connection collections only: dot path of the value in each item, e.g. origin.name (also where create and update send it); defaults to the key')
})

const ItemsPathSchema = z.union([z.literal(''), ApiPathSchema]).describe('Dot path of the items array in the response, e.g. results; "" when the response is the array')
export const PAGING_HINT = `paging (optional, on an api source or a list endpoint) says how the API splits its items over requests: { type: "page", param = "page", start = 1, sizeParam?, size? }, { type: "offset", param = "offset", sizeParam = "limit", size }, { type: "cursor", param, cursorPath } (where the next cursor is in the response) or { type: "next", nextPath? } (where the next page URL is, e.g. info.next; the Link header without one); each with an optional totalPath (where the total count is, e.g. info.count). Take it from the paging that api_source_preview or endpoint_test proposes. record_list then reads only the pages it needs, at most ${PAGING_MAX_PAGES} pages and ${PAGING_MAX_RECORDS} items per call; next page URLs must stay on the same origin.`
const SourceInput = CollectionSourceSchema.describe(`Where records come from: { "type": "internal" } (stored in bildr, the default), { "type": "api", "url", "itemsPath", "headers"?, "paging"? } (read live from a JSON endpoint, read-only; get url, itemsPath, fields and paging from api_source_preview first) or { "type": "connection", "connectionId", "idPath"?, "endpoints": { "list"?, "get"?, "create"?, "update"?, "delete"? } } (read and written through a connection, see connection_create and endpoint_test; each endpoint { method: GET|POST|PUT|PATCH|DELETE, path relative to the base URL with {id} for the record id, itemsPath? and paging? (list) or itemPath? }; idPath is where the record id is in an item, default id). ${PAGING_HINT}`)
export const PagingInput = PagingSchema.describe('Test this paging instead of the proposed one')

const ENV_HINT = 'The url and header values may use {{ env.NAME }} (see env_list), resolved on the server at each fetch; put API keys in a secret variable, e.g. header Authorization: Bearer {{ env.API_KEY }}, never literally.'
const HeadersInput = ApiHeadersSchema.describe('Up to 10 request headers { name, value }, e.g. an API key')

const API_FLOW = `To build a collection from a JSON API: call api_source_preview with the URL (and headers), adjust the proposed fields (key, label, type, path), then call collection_create with source { type: "api", url, itemsPath, headers } and the fields. ${ENV_HINT}`

function toField({ key, label, type, path }: z.infer<typeof FieldInput>): Field {
  return path ? { key, label: label ?? fieldLabel(key), type, path } : { key, label: label ?? fieldLabel(key), type }
}

function findCollection(project: Project, ref: string): Collection {
  const collection = project.collections.find(c => c.id === ref) ?? project.collections.find(c => c.slug === ref)
  if (!collection) throw new ActionError('not_found', `Collection "${ref}" not found`)
  return collection
}

function checkValues(collection: Collection, values: Record<string, unknown>): Record<string, RecordValue> {
  const result = coerceValues(collection.fields, values)
  if ('problems' in result) throw new ActionError('invalid', result.problems.join('; '))
  return result.values
}

function checkSize(record: DataRecord): void {
  if (recordBytes(record) > MAX_RECORD_BYTES) throw new ActionError('invalid', `A record can be at most ${MAX_RECORD_BYTES / 1024} KB`)
}

/** Loads a collection and its records (fetched for API and connection collections); `write` refuses API collections first. */
async function loadCollection(ctx: ActionContext, projectId: string, ref: string, write = false) {
  const project = await ctx.services.loadProject(projectId)
  const collection = findCollection(project, ref)
  if (write && collection.source.type === 'api') {
    throw new ActionError('forbidden', `"${collection.name}" is read live from an API, so its records cannot be created, changed or deleted`)
  }
  return { project, collection, records: await ctx.services.collectionRecords(project.id, collection, project.connections) }
}

/** The collection when its records live behind a connection's endpoints, which record actions then go through. */
async function remoteCollection(ctx: ActionContext, projectId: string, ref: string) {
  const project = await ctx.services.loadProject(projectId)
  const collection = findCollection(project, ref)
  return collection.source.type === 'connection' ? { project, collection } : undefined
}

function findRecord(records: DataRecord[], recordId: string, collection: Collection): number {
  const index = records.findIndex(r => r.id === recordId)
  if (index < 0) throw new ActionError('not_found', `Record "${recordId}" not found in "${collection.name}"`)
  return index
}

export const apiSourcePreview = defineAction({
  name: 'api_source_preview',
  description: `Fetch a JSON API (http(s), GET, with optional headers; private and local addresses are refused) and propose a collection mapping: the items path it detected (results, data, items, records, or the root array), fields (key, label, type, path) inferred from up to 20 items, the first 10 raw items and the same items mapped with the fields (sample), the item count of this response, and the paging it detected (null for none). With a paging (detected or given), page one is fetched with it, pageTwo is page two: { count, sample } or { error }, and pagingTotal is the API's total item count when the paging has a totalPath. ${API_FLOW}`,
  input: z.object({
    projectId: IdSchema,
    url: ApiUrlSchema.describe('The endpoint, e.g. https://rickandmortyapi.com/api/character'),
    headers: HeadersInput.optional(),
    itemsPath: ItemsPathSchema.optional().describe('Read the items at this path instead of detecting them'),
    paging: PagingInput.optional()
  }),
  readOnly: true,
  run: async ({ projectId, url, headers, itemsPath, paging: given }, ctx) => {
    await ctx.services.loadProject(projectId)
    const first = await ctx.services.fetchApi(projectId, { url, headers }, given)
    const { json } = first
    const detected = itemsPath === undefined ? detectItems(json) : { itemsPath, items: apiItems(json, itemsPath) }
    if (!detected) throw new ActionError('invalid', 'No list of items found in the API response; pass itemsPath to point at one')
    const fields = inferFields(detected.items)
    const items = detected.items.slice(0, 10)
    const paging = detectPaging(json, first.headers, url)
    const result: Record<string, unknown> = { itemsPath: detected.itemsPath, fields, items, sample: mapItems(items, fields), total: detected.items.length, paging }
    const tested = given ?? paging
    const pagingTotal = tested ? totalFrom(tested, json) : undefined
    if (pagingTotal !== undefined) result.pagingTotal = pagingTotal
    if (tested) {
      result.pageTwo = await ctx.services.previewPageTwo(projectId, { url, headers }, tested, first).then(
        (page): PageTwo => (page ? pageSample(page.json, detected.itemsPath, fields) : { count: 0, sample: [] }),
        (error: Error): PageTwo => ({ error: error.message })
      )
    }
    return result
  }
})

export const collectionCreate = defineAction({
  name: 'collection_create',
  description: `Create a data collection (a table of records, e.g. a menu or contact messages) with typed fields: ${FIELD_TYPES_HINT}. The slug defaults to a slug of the name and must be unique. New collections are private (publicRead and publicCreate false). The schema is part of the document and undoable; records are not. ${API_FLOW} API collections are read-only and always show the API's current items.`,
  input: z.object({
    projectId: IdSchema,
    name: z.string().trim().min(1).max(100),
    slug: SlugSchema.optional(),
    fields: z.array(FieldInput).max(100).optional().describe('Initial fields, in order'),
    source: SourceInput.optional()
  }),
  run: async ({ projectId, name, slug, fields = [], source }, ctx) => {
    const collection = createCollection(name, slug ?? slugify(name), fields.map(toField), source)
    const project = await ctx.services.mutate(ctx, projectId, 'Create collection', [
      { op: 'addCollection', index: Number.MAX_SAFE_INTEGER, collection }
    ])
    return { version: project.version, collectionId: collection.id, slug: collection.slug, collection: findCollection(project, collection.id) }
  }
})

export const collectionUpdate = defineAction({
  name: 'collection_update',
  description: 'Rename a collection, change its slug, or set its flags: publicRead lets published apps list its records, publicCreate lets anonymous visitors of the published app add records (e.g. a contact form with a Form component). With publicCreate, anyone on the internet, including scripts on other websites, can post records to it (rate-limited, declared fields only, no update or delete); API collections never accept them, connection collections send them to their create endpoint. Flags take effect on the next publish. For API collections, source changes the URL, items path or headers (url and header values may use {{ env.NAME }}); for connection collections, it changes the endpoints or idPath. fields replaces the whole mapping of either (key, label, type, path; use api_source_preview or endpoint_test to see the items). Properties left out keep their value. One undo step.',
  input: z.object({
    projectId: IdSchema,
    collection: CollectionRef,
    name: z.string().trim().min(1).max(100).optional(),
    slug: SlugSchema.optional(),
    publicRead: z.boolean().optional().describe('Published apps may read the records'),
    publicCreate: z.boolean().optional().describe('Anonymous visitors of the published app (and any other website) may create records'),
    source: SourceInput.optional(),
    fields: z.array(FieldInput).max(100).optional().describe('API and connection collections only: the new mapping, in order')
  }),
  run: async ({ projectId, collection: ref, source, fields, ...patch }, ctx) => {
    const current = findCollection(await ctx.services.loadProject(projectId), ref)
    const { id } = current
    const ops: Operation[] = [{ op: 'updateCollection', collectionId: id, ...patch }]
    if (source || fields) {
      const nextSource = source ?? current.source
      if (fields && nextSource.type === 'internal') {
        throw new ActionError('invalid', 'Only API and connection collections take a fields mapping; change an internal collection\'s fields with field_add, field_update and field_remove')
      }
      ops.push({ op: 'setSource', collectionId: id, source: nextSource, fields: fields ? fields.map(toField) : current.fields })
    }
    const project = await ctx.services.mutate(ctx, projectId, 'Update collection', ops)
    return { version: project.version, collection: findCollection(project, id) }
  }
})

export const collectionDelete = defineAction({
  name: 'collection_delete',
  description: 'Delete a collection from the document. Its records are kept so that undo brings the collection back with them.',
  input: z.object({ projectId: IdSchema, collection: CollectionRef }),
  run: async ({ projectId, collection: ref }, ctx) => {
    const { id } = findCollection(await ctx.services.loadProject(projectId), ref)
    const project = await ctx.services.mutate(ctx, projectId, 'Delete collection', [{ op: 'removeCollection', collectionId: id }])
    return { version: project.version }
  }
})

export const fieldAdd = defineAction({
  name: 'field_add',
  description: `Add a field to a collection. Types: ${FIELD_TYPES_HINT}. Existing records read it as null until set. Undoable.`,
  input: FieldInput.extend({
    projectId: IdSchema,
    collection: CollectionRef,
    index: z.number().int().nonnegative().optional().describe('Position in the field list; defaults to the end')
  }),
  run: async ({ projectId, collection: ref, index, ...field }, ctx) => {
    const { id } = findCollection(await ctx.services.loadProject(projectId), ref)
    const project = await ctx.services.mutate(ctx, projectId, 'Add field', [
      { op: 'addField', collectionId: id, index: index ?? Number.MAX_SAFE_INTEGER, field: toField(field) }
    ])
    return { version: project.version, collection: findCollection(project, id) }
  }
})

export const fieldUpdate = defineAction({
  name: 'field_update',
  description: 'Change a field\'s label and/or type (the key cannot change). Records are not rewritten: stored values that do not fit the new type read as null, and come back if the type is changed back. Undoable.',
  input: z.object({
    projectId: IdSchema,
    collection: CollectionRef,
    key: z.string().describe('Key of the field to change'),
    label: z.string().trim().min(1).max(100).optional(),
    type: FieldTypeSchema.optional().describe(`New value type: ${FIELD_TYPES_HINT}`),
    path: ApiPathSchema.optional().describe('API collections only: new dot path of the value in each item')
  }),
  run: async ({ projectId, collection: ref, key, label, type, path }, ctx) => {
    const { id } = findCollection(await ctx.services.loadProject(projectId), ref)
    const project = await ctx.services.mutate(ctx, projectId, 'Update field', [{ op: 'updateField', collectionId: id, key, label, type, path }])
    return { version: project.version, collection: findCollection(project, id) }
  }
})

export const fieldMove = defineAction({
  name: 'field_move',
  description: 'Move a field to another position in its collection\'s field list (0 is first; the index is where the field ends up). Records are unchanged. Undoable.',
  input: z.object({
    projectId: IdSchema,
    collection: CollectionRef,
    key: z.string().describe('Key of the field to move'),
    index: z.number().int().nonnegative().describe('New position, from 0 to the field count minus one')
  }),
  run: async ({ projectId, collection: ref, key, index }, ctx) => {
    const { id } = findCollection(await ctx.services.loadProject(projectId), ref)
    const project = await ctx.services.mutate(ctx, projectId, 'Move field', [{ op: 'moveField', collectionId: id, key, index }])
    return { version: project.version, collection: findCollection(project, id) }
  }
})

export const fieldRemove = defineAction({
  name: 'field_remove',
  description: 'Remove a field from a collection. Records keep the stored value hidden, so undo restores it. Undoable.',
  input: z.object({ projectId: IdSchema, collection: CollectionRef, key: z.string().describe('Key of the field to remove') }),
  run: async ({ projectId, collection: ref, key }, ctx) => {
    const { id } = findCollection(await ctx.services.loadProject(projectId), ref)
    const project = await ctx.services.mutate(ctx, projectId, 'Remove field', [{ op: 'removeField', collectionId: id, key }])
    return { version: project.version, collection: findCollection(project, id) }
  }
})

export const recordList = defineAction({
  name: 'record_list',
  description: `List a collection's records ({ id, createdAt, updatedAt, values }, one value per field, null when empty) with the total count. Optional: filter by field equality, sort by a field (or createdAt/updatedAt; empty values last), limit and offset. Without a sort, records are in creation order. API collections, and connection collections through their list endpoint, return the fetched page of items (cached 60 s, refreshed after each write) mapped with their fields; the query applies to that page. With paging, offset and limit select remote items and only the pages holding them are fetched (at most ${PAGING_MAX_PAGES} pages and ${PAGING_MAX_RECORDS} items per call; past that the result is cut); a filter or sort applies to the pages read from the start within those caps. Paged results add hasMore (more items follow), and total is the API's total when the paging has a totalPath, else the number of items known so far.`,
  input: z.object({
    projectId: IdSchema,
    collection: CollectionRef,
    filter: ValuesSchema.optional().describe('Field key → value; records whose values all match, e.g. { "vegan": true }'),
    sort: z.object({
      field: z.string().describe('A field key, createdAt or updatedAt'),
      direction: z.enum(['asc', 'desc']).default('asc')
    }).optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().nonnegative().default(0)
  }),
  readOnly: true,
  run: async ({ projectId, collection: ref, filter, sort, limit, offset }, ctx) => {
    const project = await ctx.services.loadProject(projectId)
    const collection = findCollection(project, ref)
    if (sort && !collection.fields.some(f => f.key === sort.field) && !(RECORD_META_FIELDS as readonly string[]).includes(sort.field)) {
      throw new ActionError('invalid', `Cannot sort by "${sort.field}": not a field of "${collection.name}"`)
    }
    if (ctx.services.isPaged(collection)) {
      const load = async (from: number, count: number) => {
        const page = await ctx.services.collectionPage(project.id, collection, project.connections, { offset: from, limit: count })
        return { ...page, records: page.records.map(r => readRecord(collection.fields, r)) }
      }
      return queryPaged(load, { filter: filter && checkValues(collection, filter), sort, limit, offset })
    }
    const records = await ctx.services.collectionRecords(project.id, collection, project.connections)
    return queryRecords(records.map(r => readRecord(collection.fields, r)), {
      filter: filter && checkValues(collection, filter),
      sort,
      limit,
      offset
    })
  }
})

export const recordGet = defineAction({
  name: 'record_get',
  description: 'Get one record of a collection by id. Connection collections use their get endpoint, or their list endpoint filtered by id.',
  input: z.object({ projectId: IdSchema, collection: CollectionRef, recordId: IdSchema }),
  readOnly: true,
  run: async ({ projectId, collection: ref, recordId }, ctx) => {
    const remote = await remoteCollection(ctx, projectId, ref)
    if (remote) return readRecord(remote.collection.fields, await ctx.services.remote.get(remote.project.id, remote.project.connections, remote.collection, recordId))
    const { collection, records } = await loadCollection(ctx, projectId, ref)
    return readRecord(collection.fields, records[findRecord(records, recordId, collection)]!)
  }
})

export const recordCreate = defineAction({
  name: 'record_create',
  description: `Add a record to a collection. values maps field keys to values checked against the field types (${FIELD_TYPES_HINT}); form strings such as "3.5" or "true" are accepted, fields left out are null. At most ${MAX_RECORD_BYTES / 1024} KB per record and ${MAX_RECORDS_PER_COLLECTION} records per collection. API collections are read-only. Connection collections send the values to their create endpoint as JSON (each at its field's path) and return the record the API answers; that write goes to an external system. Not undoable.`,
  input: z.object({ projectId: IdSchema, collection: CollectionRef, values: ValuesSchema.describe('Field key → value') }),
  run: async ({ projectId, collection: ref, values }, ctx) => {
    const remote = await remoteCollection(ctx, projectId, ref)
    if (remote) {
      const record = await ctx.services.remote.create(remote.project.id, remote.project.connections, remote.collection, checkValues(remote.collection, values))
      ctx.notifyData(remote.project.id, remote.project.version, remote.collection.id)
      return readRecord(remote.collection.fields, record)
    }
    const { project, collection, records } = await loadCollection(ctx, projectId, ref, true)
    const checked = checkValues(collection, values)
    if (records.length >= MAX_RECORDS_PER_COLLECTION) throw new ActionError('forbidden', `A collection can hold at most ${MAX_RECORDS_PER_COLLECTION} records`)
    const now = new Date().toISOString()
    const record: DataRecord = { id: newId('rec'), createdAt: now, updatedAt: now, values: checked }
    checkSize(record)
    await ctx.services.records.save(project.id, collection.id, [...records, record])
    ctx.notifyData(project.id, project.version, collection.id)
    return readRecord(collection.fields, record)
  }
})

/**
 * A record from a published app's Form, for the public data endpoint only
 * (`publicOnly`: not on MCP or `/api/actions`; agents use record_create). It
 * runs under the project lock like record_create and tells open editors.
 */
export const publicRecordCreate = defineAction({
  name: 'public_record_create',
  description: 'Add a record to a publicCreate internal or connection collection of the PUBLISHED app, as an anonymous visitor.',
  input: z.object({ projectId: IdSchema, collection: z.string().max(64), body: z.unknown() }),
  publicOnly: true,
  run: async ({ projectId, collection: slug, body }, ctx): Promise<PublicWriteResult> => {
    const snapshot = await ctx.services.publishedSnapshot(projectId)
    if (!snapshot) return { ok: false, status: 404, message: 'Collection not found' }
    const published = snapshot.project.collections.find(c => c.slug === slug)
    let result: PublicWriteResult
    if (published?.publicCreate && published.source.type === 'connection') {
      // Only the create endpoint: visitors never reach update or delete.
      if (!published.source.endpoints.create) return { ok: false, status: 403, message: 'This collection does not accept new records' }
      findConnection(snapshot.project.connections, published.source.connectionId)
      const checked = publicRemoteValues(published, body)
      if (!('values' in checked)) return { ok: false, ...checked }
      result = { ok: true, record: await ctx.services.remote.create(projectId, snapshot.project.connections, published, checked.values) }
    } else {
      result = await createPublicRecord({ snapshot, collectionSlug: slug, body, store: ctx.services.records })
    }
    if (result.ok) {
      const project = await ctx.services.loadProject(projectId)
      ctx.notifyData(projectId, project.version, snapshot.project.collections.find(c => c.slug === slug)!.id)
    }
    return result
  }
})

export const recordUpdate = defineAction({
  name: 'record_update',
  description: 'Change some values of a record; keys left out keep their value and null clears one. Values are checked against the field types. Connection collections send them to their update endpoint (a PUT endpoint gets the whole record, read first). Not undoable.',
  input: z.object({ projectId: IdSchema, collection: CollectionRef, recordId: IdSchema, values: ValuesSchema.describe('Field key → new value') }),
  run: async ({ projectId, collection: ref, recordId, values }, ctx) => {
    const remote = await remoteCollection(ctx, projectId, ref)
    if (remote) {
      const record = await ctx.services.remote.update(remote.project.id, remote.project.connections, remote.collection, recordId, checkValues(remote.collection, values))
      ctx.notifyData(remote.project.id, remote.project.version, remote.collection.id)
      return readRecord(remote.collection.fields, record)
    }
    const { project, collection, records } = await loadCollection(ctx, projectId, ref, true)
    const index = findRecord(records, recordId, collection)
    const record: DataRecord = { ...records[index]!, updatedAt: new Date().toISOString() }
    record.values = { ...record.values, ...checkValues(collection, values) }
    checkSize(record)
    records[index] = record
    await ctx.services.records.save(project.id, collection.id, records)
    ctx.notifyData(project.id, project.version, collection.id)
    return readRecord(collection.fields, record)
  }
})

export const recordDelete = defineAction({
  name: 'record_delete',
  description: 'Delete a record. Connection collections call their delete endpoint, on the external system. Not undoable.',
  input: z.object({ projectId: IdSchema, collection: CollectionRef, recordId: IdSchema }),
  run: async ({ projectId, collection: ref, recordId }, ctx) => {
    const remote = await remoteCollection(ctx, projectId, ref)
    if (remote) {
      await ctx.services.remote.remove(remote.project.id, remote.project.connections, remote.collection, recordId)
      ctx.notifyData(remote.project.id, remote.project.version, remote.collection.id)
      return { recordId }
    }
    const { project, collection, records } = await loadCollection(ctx, projectId, ref, true)
    records.splice(findRecord(records, recordId, collection), 1)
    await ctx.services.records.save(project.id, collection.id, records)
    ctx.notifyData(project.id, project.version, collection.id)
    return { recordId }
  }
})
