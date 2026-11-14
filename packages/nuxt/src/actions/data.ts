import { z } from 'zod'
import { datasourceEnvVars, detectItems, inferFields, remoteUrl } from '@bildr/codegen/edit'
import { redact } from '@bildr/codegen/env'
import { ArtifactIdSchema, loadModel, REPOSITORY_OPERATIONS } from '@bildr/codegen/model'
import type { InferredField } from '@bildr/codegen/edit'
import type { DataSourceFile, Model } from '@bildr/codegen/model'
import { readModelFiles } from '../node/project.ts'
import { authHeaders, envSource, fetchJson, readDotEnv, RemoteError, resolveSettings } from '../node/remote.ts'
import { ActionError, defineAction } from './define.ts'
import type { ActionDef } from './define.ts'

/**
 * Data actions that reach outside the model (P3c): a look at what a REST data source
 * answers (`datasource_preview`, `repository_endpoint_test`) and which env vars the data
 * sources need (`env_status`). Read-only: they never write the model. Requests are GETs
 * under the source's base URL only, with its auth from the env; secret values are never
 * returned, nor are env values.
 */

const loaded = (root: string): Model => {
  const result = loadModel(readModelFiles(root))
  if (!result.ok) throw new ActionError('invalid', 'The model has problems: fix them first', result.problems)
  return result.model
}

const restSource = (model: Model, id: string): DataSourceFile => {
  const source = model.datasources.find(entry => entry.id === id)
  if (!source) throw new ActionError('not_found', `No data source "${id}"`)
  if (source.kind !== 'rest') throw new ActionError('invalid_input', `${id} is a ${source.kind} data source: only REST sources answer requests`)
  return source
}

const SAMPLE_ITEMS = 10

/** GETs `path` of `source` and returns its JSON with the secrets redacted out of everything. */
const get = async (root: string, source: DataSourceFile, path: string) => {
  const settings = resolveSettings(root, source)
  const target = remoteUrl(settings.baseUrl ?? '', path)
  if (!target.ok) throw new ActionError('invalid_input', target.message)
  const { headers, secrets } = authHeaders(source, settings)
  try {
    const { status, json } = await fetchJson(target.url, { baseUrl: settings.baseUrl!, headers })
    const clean = <T>(value: T): T => secrets.length ? JSON.parse(redact(JSON.stringify(value), secrets)) as T : value
    return { status, json: clean(json), clean }
  } catch (error) {
    if (error instanceof RemoteError) throw new ActionError('upstream', secrets.length ? redact(error.message, secrets) : error.message)
    throw error
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Items found at `itemsPath` (or detected), with the fields they suggest; a single object otherwise. */
const itemsAt = (json: unknown, itemsPath: string) => {
  const found = itemsPath === '' ? json : isObject(json) ? json[itemsPath] : undefined
  if (!Array.isArray(found)) throw new ActionError('invalid', `The response has no list of items at "${itemsPath}"`)
  return { itemsPath, items: found as unknown[] }
}

interface Described {
  status: number
  itemsPath?: string
  count?: number
  fields: InferredField[]
  items?: unknown[]
  item?: unknown
  sample: unknown
}

const describeResponse = (status: number, json: unknown, itemsPath?: string): Described => {
  const items = itemsPath === undefined ? detectItems(json) : itemsAt(json, itemsPath)
  if (!items) return { status, item: json, fields: isObject(json) ? inferFields([json]) : [], sample: json }
  const first = items.items.slice(0, SAMPLE_ITEMS)
  const sample = items.itemsPath === '' ? first : { ...(json as Record<string, unknown>), [items.itemsPath]: first }
  return { status, itemsPath: items.itemsPath, count: items.items.length, fields: inferFields(items.items), items: first, sample }
}

const PathInput = z.string().min(1).max(2000).describe('Relative to the data source\'s base URL, e.g. "/posts" or "/posts?limit=5"')

const datasourcePreview = defineAction({
  name: 'datasource_preview',
  description: `GET a path of a REST data source (under its base URL only, with its auth from the env; at most 10 s and 1 MB; redirects outside the base URL are refused) and propose an entity: the items path it found (results, data, items, records, the root array or the first array of objects) or itemsPath, the item count, the fields (name, type, remote key) from up to 20 items, the first ${SAMPLE_ITEMS} items and the response (sample). For a single object: the item and its fields. Secret values are never returned. Then: entity_create { source, fields, endpoints: { list: { path, itemsPath } } }.`,
  input: z.object({
    datasource: ArtifactIdSchema.describe('A REST data source id, e.g. "ds_api"'),
    path: PathInput,
    itemsPath: z.string().regex(/^$|^[A-Za-z_$][\w$]*$/, 'Use a top-level key, like "items" ("" for the root array)').optional().describe('Read the items at this top-level key instead of detecting them')
  }),
  readOnly: true,
  run: async ({ datasource, path, itemsPath }, { root }) => {
    const source = restSource(loaded(root), datasource)
    const { status, json } = await get(root, source, path)
    return describeResponse(status, json, itemsPath)
  }
})

const DEFAULT_METHODS = { list: 'GET', get: 'GET', create: 'POST', update: 'PUT', delete: 'DELETE' } as const

const repositoryEndpointTest = defineAction({
  name: 'repository_endpoint_test',
  description: 'Send the endpoint of one operation of a REST repository, as the generated adapter does, and compare the answer with the entity: list (its first page: 10 items at offset 0) or get (with id). Returns the status, the path, the items (or the item), the fields they suggest and mapping: for each entity field, its remote key and whether the items have it. GET only: create, update and delete could change the API\'s data, so they are refused. Same limits as datasource_preview.',
  input: z.object({
    repository: ArtifactIdSchema.describe('A REST repository id, e.g. "repo_task"'),
    op: z.enum(REPOSITORY_OPERATIONS),
    id: z.string().min(1).max(200).optional().describe('get: the key of the row to get')
  }),
  readOnly: true,
  run: async ({ repository: id, op, id: key }, { root }) => {
    const model = loaded(root)
    const mod = Object.values(model.modules).find(entry => entry.repositories.some(repository => repository.id === id))
    const repository = mod?.repositories.find(entry => entry.id === id)
    if (!mod || !repository) throw new ActionError('not_found', `No repository "${id}"`)
    const source = restSource(model, repository.datasource)
    if (!repository.operations.includes(op)) throw new ActionError('invalid_input', `${id} has no ${op} operation`)
    const rest = (repository.rest ?? {}) as Record<string, { method?: string, path: string, itemsPath?: string } | undefined> & { paging?: { limitParam?: string, offsetParam?: string }, fieldMap?: Record<string, string> }
    const endpoint = rest[op]
    if (!endpoint) throw new ActionError('invalid', `${id} has no endpoint for ${op}`)
    const method = endpoint.method ?? DEFAULT_METHODS[op]
    if (method !== 'GET') throw new ActionError('forbidden', `repository_endpoint_test only sends GET: a ${method} to the API could change its data`)
    let path = endpoint.path
    let query = ''
    if (op === 'list') {
      query = `?${new URLSearchParams({ [rest.paging?.limitParam ?? 'limit']: '10', [rest.paging?.offsetParam ?? 'offset']: '0' })}`
    } else {
      if (key === undefined) throw new ActionError('invalid_input', `Give the id of a row to ${op}`)
      if (key === '.' || key === '..') throw new ActionError('invalid_input', `"${key}" is not a valid id for a REST path`)
      path = path.replace(':id', encodeURIComponent(key))
    }
    const { status, json } = await get(root, source, `${path}${query}`)
    const described = describeResponse(status, json, op === 'list' ? endpoint.itemsPath : undefined)
    const entity = mod.entities.find(entry => entry.id === repository.entity)!
    const rows = (described.items ?? [described.item]).filter(isObject)
    const fields = [...(entity.idStrategy === 'uuid' ? ['id'] : []), ...entity.fields.map(field => field.name)]
    const mapping = fields.map((field) => {
      const remote = rest.fieldMap?.[field] ?? field
      return { field, remote, found: rows.some(row => Object.hasOwn(row, remote)) }
    })
    return { method, path, ...described, mapping }
  }
})

const envStatus = defineAction({
  name: 'env_status',
  description: 'List the env vars the data sources read at runtime (name, data source, setting, whether it is the auth secret, whether the model has a default) and whether each is set in the dev server\'s env or the project\'s .env. Values are never returned: the user edits .env.',
  input: z.object({}),
  readOnly: true,
  run: (_input, { root }) => {
    const model = loaded(root)
    const dotEnv = readDotEnv(root)
    return {
      variables: datasourceEnvVars(model).map((entry) => {
        const from = envSource(entry.name, dotEnv)
        return { ...entry, set: from !== null, from }
      })
    }
  }
})

export const DATA_ACTIONS: readonly ActionDef[] = [datasourcePreview, repositoryEndpointTest, envStatus] as ActionDef[]
