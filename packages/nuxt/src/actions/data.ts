import { z } from 'zod'
import { datasourceEnvVars, detectItems, inferApiModels, inferFields, isApiSource, remoteUrl } from '@bildr/codegen/edit'
import { redact } from '@bildr/codegen/env'
import { apiHeaderProblem, apiHeaderValueProblem, ArtifactIdSchema, CamelNameSchema, headerNameOf, loadModel, MAX_CALL_HEADERS, PascalNameSchema, REPOSITORY_OPERATIONS } from '@bildr/codegen/model'
import type { ApiSource, InferredField } from '@bildr/codegen/edit'
import type { ApiHeader, ApiParam, ApiQuery, DataSourceFile, Model } from '@bildr/codegen/model'
import { readModelFiles } from '../node/project.ts'
import { authHeaders, envSource, fetchJson, fetchRemote, readDotEnv, RemoteError, resolveSettings } from '../node/remote.ts'
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

/**
 * `value` with the secrets redacted out of every string and key. Redacting the
 * parsed values, not their JSON text: JSON escapes a secret holding `"` or `\`,
 * and the escaped form wouldn't match.
 */
const redactValue = (value: unknown, secrets: string[]): unknown => {
  if (typeof value === 'string') return redact(value, secrets)
  if (Array.isArray(value)) return value.map(item => redactValue(item, secrets))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key, secrets), redactValue(item, secrets)]))
  }
  return value
}

/** GETs `path` of `source` and returns its JSON with the secrets redacted out of everything. */
const get = async (root: string, source: DataSourceFile, path: string) => {
  const settings = resolveSettings(root, source)
  const target = remoteUrl(settings.baseUrl ?? '', path)
  if (!target.ok) throw new ActionError('invalid_input', target.message)
  const { headers, secrets } = authHeaders(source, settings)
  try {
    const { status, json } = await fetchJson(target.url, { baseUrl: settings.baseUrl!, headers })
    const clean = <T>(value: T): T => secrets.length ? redactValue(value, secrets) as T : value
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

// ── api_try (simple data): one call of an API data source ───────────────────

const MAX_TEXT = 10_000
const MAX_HEADER_VALUE = 500
const MAX_HEADERS = 60
/** Headers that carry a sign-in or a session: never given back, whatever their value. */
const HIDDEN_HEADERS = new Set(['set-cookie', 'set-cookie2', 'cookie', 'authorization', 'proxy-authorization'])

/**
 * The headers of an answer as the editor may show them (api-calls T1): without the sign-ins and sessions (`HIDDEN_HEADERS`, and the
 * header the source sends its key in, should the API echo it), the secret masked in any other, each value cut to its first 500
 * characters, at most 60 of them.
 */
const shownHeaders = (headers: Record<string, string>, source: ApiSource, secrets: string[]): Record<string, string> => {
  const ownKey = source.auth?.type === 'header' ? source.auth.header?.toLowerCase() : undefined
  const shown: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers).slice(0, MAX_HEADERS)) {
    if (HIDDEN_HEADERS.has(name) || name === ownKey) continue
    const clean = secrets.length ? redact(value, secrets) : value
    shown[name] = clean.length > MAX_HEADER_VALUE ? `${clean.slice(0, MAX_HEADER_VALUE)}…` : clean
  }
  return shown
}

/** What a saved query or action answers, or nothing for a call by path. */
type Expected = ApiQuery['result'] | undefined

interface Call {
  method: string
  path: string
  /** The saved operation's parameters; none for a call by path. */
  params: ApiParam[] | undefined
  /** The saved operation's fixed headers; none for a call by path. */
  headers: ApiHeader[] | undefined
  label: string
  expected: Expected
  saved: boolean
}

const apiSourceOf = (model: Model, id: string): ApiSource => {
  const source = model.datasources.find(entry => entry.id === id)
  if (!source) throw new ActionError('not_found', `No data source "${id}"`)
  if (!isApiSource(source)) throw new ActionError('invalid_input', `${id} is a ${source.kind} data source: only API sources can be tried`)
  return source
}

const callOf = (source: ApiSource, input: { path?: string, query?: string, action?: string, method?: string }): Call => {
  if (input.query !== undefined || input.action !== undefined) {
    const query = input.query === undefined ? undefined : source.queries.find(entry => entry.name === input.query)
    const action = input.action === undefined ? undefined : source.actions.find(entry => entry.name === input.action)
    if (input.query !== undefined && !query) throw new ActionError('not_found', `No query "${input.query}" in ${source.name}`)
    if (input.action !== undefined && !action) throw new ActionError('not_found', `No action "${input.action}" in ${source.name}`)
    const op = (query ?? action)!
    const method = action?.method ?? 'GET'
    if (input.method && input.method !== method) throw new ActionError('invalid_input', `${op.name} is a ${method}: drop the method`)
    return { method, path: op.path, params: op.params, headers: op.headers ?? [], label: op.name, expected: op.result, saved: true }
  }
  return { method: input.method ?? 'GET', path: input.path!, params: undefined, headers: undefined, label: input.path!, expected: undefined, saved: false }
}

const scalar = (value: string | number | boolean) => String(value)

/** The path (with its `:name` filled in, encoded) and the query string a call sends. */
const fillPath = (call: Call, given: Record<string, string | number | boolean>): string => {
  const query = new URLSearchParams()
  const [pathname = '', search = ''] = call.path.split(/\?(.*)/s, 2)
  let filled = pathname
  const fill = (name: string, value: string | number | boolean | undefined) => {
    if (value === undefined) throw new ActionError('invalid_input', `Give the path parameter "${name}"`)
    filled = filled.replace(new RegExp(`(?<=/):${name}(?![A-Za-z0-9])`), () => encodeURIComponent(scalar(value)))
  }
  // Own keys only: a parameter named like an object member (constructor, toString) is missing when not given.
  const valueOf = (name: string) => Object.hasOwn(given, name) ? given[name] : undefined
  if (call.params) {
    for (const key of Object.keys(given)) {
      if (!call.params.some(param => param.name === key)) throw new ActionError('invalid_input', `${call.label} has no parameter "${key}"`)
    }
    for (const param of call.params) {
      const value = valueOf(param.name)
      if (param.in === 'header') continue
      if (param.in === 'path') fill(param.name, value)
      else if (value !== undefined) query.set(param.key ?? param.name, scalar(value))
      else if (param.required) throw new ActionError('invalid_input', `Give the query parameter "${param.name}"`)
    }
  } else {
    const inPath = [...pathname.matchAll(/(?<=\/):([A-Za-z][A-Za-z0-9]*)/g)].map(match => match[1]!)
    for (const name of inPath) fill(name, valueOf(name))
    for (const [key, value] of Object.entries(given)) if (!inPath.includes(key)) query.set(key, scalar(value))
  }
  const sent = query.toString()
  return `${filled}${sent ? `${search ? `?${search}&` : '?'}${sent}` : search ? `?${search}` : ''}`
}

/**
 * The headers a call sends besides the source's (api-calls R2): a saved operation's fixed ones and its header parameters (from `given`, by
 * name), or the ones given for a call by path. Each is one the model would take (never the sign-in), its value one line.
 */
const callHeaders = (call: Call, given: Record<string, string | number | boolean>, headers: Record<string, string> | undefined, source: ApiSource): Record<string, string> => {
  if (call.saved && headers !== undefined) throw new ActionError('invalid_input', `${call.label} sends its own headers: drop headers`)
  const sent: [string, string | undefined][] = call.saved
    ? [
        ...call.headers!.map((header): [string, string] => [header.name, header.value]),
        ...call.params!.filter(param => param.in === 'header').map((param): [string, string | undefined] => {
          // An empty value is not given, as in the editor: no header is sent with nothing in it.
          const value = Object.hasOwn(given, param.name) && given[param.name] !== '' ? given[param.name] : undefined
          if (value === undefined && param.required) throw new ActionError('invalid_input', `Give the header parameter "${param.name}"`)
          return [headerNameOf(param), value === undefined ? undefined : scalar(value)]
        })
      ]
    : Object.entries(headers ?? {})
  const out: Record<string, string> = {}
  for (const [name, value] of sent) {
    if (value === undefined) continue
    const problem = apiHeaderProblem(name, undefined, source.auth) ?? apiHeaderValueProblem(name, value)
    if (problem) throw new ActionError('invalid_input', problem)
    out[name.toLowerCase()] = value
  }
  return out
}

/** The call's headers under the source's (its sign-in wins); the call's own `accept` is kept. */
const withOwn = (own: Record<string, string>, call: Record<string, string>): Record<string, string> => {
  const sent = { ...call }
  for (const [name, value] of Object.entries(own)) if (name !== 'accept' || !('accept' in sent)) sent[name] = value
  return sent
}

const getAt = (json: unknown, path: string): unknown => path.split('.').reduce<unknown>((value, key) => isObject(value) ? value[key] : undefined, json)

/** `json` with the list at `path` cut to its first `size` items. */
const trimmedAt = (json: unknown, path: string, size: number): unknown => {
  if (!path) return Array.isArray(json) ? json.slice(0, size) : json
  const [head = '', ...rest] = path.split('.')
  if (!isObject(json) || !(head in json)) return json
  return { ...json, [head]: trimmedAt(json[head], rest.join('.'), size) }
}

/** Where the list of items is: what a saved query says, else detected (not for a call that answers one thing). */
const itemsOf = (json: unknown, call: Call): { path: string, items: unknown[] } | null => {
  if (call.saved && !call.expected?.many) return null
  if (call.expected?.itemsPath) {
    const found = getAt(json, call.expected.itemsPath)
    return Array.isArray(found) ? { path: call.expected.itemsPath, items: found } : null
  }
  const found = detectItems(json)
  return found ? { path: found.itemsPath, items: found.items } : null
}

/** `/categories/:id/products` → `Product`: the last fixed segment, singular. */
const modelNameOf = (path: string): string => {
  const segment = path.split('?')[0]!.split('/').filter(part => part && !part.startsWith(':')).at(-1) ?? 'item'
  const singular = segment.endsWith('ies') ? `${segment.slice(0, -3)}y` : /[^su]s$/.test(segment) ? segment.slice(0, -1) : segment
  return singular
}

const apiTry = defineAction({
  name: 'api_try',
  description: `Send one call of an API data source, as the generated app would, and propose the models of its answer. Give one of: path (relative to the data source's base URL, e.g. "/products/:id"; :name is filled from params, the other params go in the query string), query (a saved query's name) or action (a saved action's name; its params go by their remote key). Saved operations use their own method; for a path, method is GET unless set. GET only unless confirm: true: a POST, PUT, PATCH or DELETE could change the API's data, so it is refused without confirm. body is the JSON a write sends. headers (for a path) are sent too, never the sign-in; a saved operation sends its own fixed headers and its header params (in: "header", by name in params). Calls go through the editor's remote guards: under the base URL only, redirects off it (and any redirect of a write) refused, at most 10 s and 1 MB; the auth secret comes from the env (not sent for a browser-runtime source) and is never returned. Returns status, url, durationMs, size (bytes of the answer), headers (the answer's, lower-cased; cookies, authorization and the source's key header left out, the secret masked), json (a list cut to its first ${SAMPLE_ITEMS} items) or text, items { path, count } when the answer holds a list, and proposal { result: { model, many, itemsPath? }, models } to use with api_model_set (one call per model, in the listed order: nested models first, the root last) and api_query_set / api_action_set; model names the proposed root model.`,
  input: z.object({
    datasource: ArtifactIdSchema.describe('An API data source id, e.g. "ds_shop"'),
    path: PathInput.optional(),
    query: CamelNameSchema.optional().describe('The name of a saved query'),
    action: CamelNameSchema.optional().describe('The name of a saved action'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('For a path (default GET); a saved operation has its own'),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Parameter values, by name'),
    body: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional().describe('The JSON body of a write'),
    headers: z.record(z.string(), z.string()).refine(value => Object.keys(value).length <= MAX_CALL_HEADERS, `At most ${MAX_CALL_HEADERS} headers`).optional().describe('For a path: the headers to send (never the sign-in, which comes from the source). A saved operation sends its own'),
    confirm: z.boolean().optional().describe('true to send a write (POST, PUT, PATCH, DELETE)'),
    model: PascalNameSchema.optional().describe('The name for the proposed root model (default: the saved result\'s, else from the path)')
  }).refine(input => [input.path, input.query, input.action].filter(value => value !== undefined).length === 1, 'Give one of path, query or action'),
  // Not read-only: with confirm it sends writes to the remote API, and MCP clients may auto-approve a read-only tool.
  readOnly: false,
  run: async (input, { root }) => {
    const source = apiSourceOf(loaded(root), input.datasource)
    const call = callOf(source, input)
    if (call.method === 'GET' && input.body !== undefined) throw new ActionError('invalid_input', 'A GET has no body')
    if (call.method !== 'GET' && input.confirm !== true) {
      throw new ActionError('forbidden', `api_try sends a ${call.method}: it could change the API's data. Pass confirm: true to send it`)
    }
    const given = callHeaders(call, input.params ?? {}, input.headers, source)
    const settings = resolveSettings(root, source)
    const target = remoteUrl(settings.baseUrl ?? '', fillPath(call, input.params ?? {}))
    if (!target.ok) throw new ActionError('invalid_input', target.message)
    // A browser source has no secret: the browser would see it, so the call is tried as the browser would send it.
    const { headers, secrets } = source.runtime === 'browser' ? { headers: { accept: 'application/json' }, secrets: [] as string[] } : authHeaders(source, settings)
    const clean = <T>(value: T): T => secrets.length ? redactValue(value, secrets) as T : value
    const url = redact(target.url, secrets)
    let answer
    const started = performance.now()
    try {
      answer = await fetchRemote(target.url, { baseUrl: settings.baseUrl!, headers: withOwn(headers, given), method: call.method, body: input.body })
    } catch (error) {
      if (error instanceof RemoteError) throw new ActionError('upstream', secrets.length ? redact(error.message, secrets) : error.message)
      throw error
    }
    const meta = { durationMs: Math.round(performance.now() - started), size: answer.size, headers: shownHeaders(answer.headers, source, secrets) }
    if ('text' in answer) return { status: answer.status, url, text: clean(answer.text).slice(0, MAX_TEXT), ...meta }
    const json = clean(answer.json)
    const found = itemsOf(json, call)
    // An error answer (4xx, 5xx) is not a model to propose.
    const models = answer.status < 200 || answer.status >= 300 ? [] : inferApiModels(found ? found.items : json, input.model ?? call.expected?.model ?? modelNameOf(call.path))
    return {
      status: answer.status,
      url,
      json: found ? trimmedAt(json, found.path, SAMPLE_ITEMS) : json,
      ...(found ? { items: { path: found.path, count: found.items.length } } : {}),
      ...(models.length ? { proposal: { result: { model: models.at(-1)!.name, many: found !== null, ...(found?.path ? { itemsPath: found.path } : {}) }, models } } : {}),
      ...meta
    }
  }
})

export const DATA_ACTIONS: readonly ActionDef[] = [datasourcePreview, repositoryEndpointTest, envStatus, apiTry] as ActionDef[]
