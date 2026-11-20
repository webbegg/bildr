import { z } from 'zod'
import { API_RUNTIMES, ApiActionSchema, ApiModelSchema, ApiQuerySchema, apiProblems, CamelNameSchema, PascalNameSchema } from '../model/schemas.ts'
import type { ApiAction, ApiModel, ApiQuery, DataSourceFile } from '../model/schemas.ts'
import { defineEdit, fail } from './core.ts'
import type { Draft } from './core.ts'
import { AuthInput, datasourceById, DataSourceRef, envNameOf, sourceName, urlProblem } from './datasources.ts'

/**
 * API data sources (simple data, SD-2): a remote JSON API with a first-class `baseUrl`, the
 * models of its answers and bodies, and named queries (GET) and actions (writes). Every edit
 * leaves the source as `apiProblems` wants it; the load check runs the same rules on a
 * hand-written file. Secrets follow the REST rule: the auth secret is an env var only.
 */

export type ApiSource = DataSourceFile & Required<Pick<DataSourceFile, 'baseUrl' | 'runtime' | 'models' | 'queries' | 'actions'>>

export const isApiSource = (source: DataSourceFile): source is ApiSource => source.kind === 'api'

export const apiById = (draft: Draft, id: string): ApiSource => {
  const source = datasourceById(draft, id)
  if (!isApiSource(source)) fail('invalid', `"${source.name}" is not an API data source`)
  return source as ApiSource
}

/** The env var of the base URL: browser code reads only `runtimeConfig.public`, hence `NUXT_PUBLIC_`. */
const baseUrlEnv = (name: string, runtime: ApiSource['runtime']) =>
  runtime === 'browser' ? envNameOf(name, 'baseUrl').replace(/^NUXT_/, 'NUXT_PUBLIC_') : envNameOf(name, 'baseUrl')

/** Fills in the env vars and runs the source's rules, failing on the first problem. */
const settle = (source: ApiSource, previous?: { name: string, runtime: ApiSource['runtime'] }) => {
  const problem = urlProblem(source.baseUrl)
  if (problem) fail('invalid', problem)
  const env: Record<string, string> = { ...source.env }
  // A base URL env var bildr named follows the runtime; one the user named stays.
  const ours = previous ? [baseUrlEnv(previous.name, 'server'), baseUrlEnv(previous.name, 'browser')] : []
  if (!env.baseUrl || ours.includes(env.baseUrl)) env.baseUrl = baseUrlEnv(previous?.name ?? source.name, source.runtime)
  for (const setting of Object.keys(env)) {
    if (setting !== 'baseUrl' && setting !== source.auth?.secret) Reflect.deleteProperty(env, setting)
  }
  if (source.auth) {
    env[source.auth.secret] ??= envNameOf(source.name, source.auth.secret)
    if (source.auth.type === 'header' && !source.auth.header) fail('invalid', 'A "header" auth needs the header name, like "X-Api-Key"')
    if (source.auth.type === 'bearer' && source.auth.header) fail('invalid', 'A "bearer" auth sends "Authorization: Bearer …": it takes no header name')
  }
  source.env = env
  const first = apiProblems(source)[0]
  if (first) fail('invalid', first.message)
}

export const apiCreate = defineEdit({
  input: z.object({
    name: z.string().min(1).max(60).describe('Kebab-cased into its name, e.g. "Shop API" → "shop-api"; the id is ds_<name>'),
    baseUrl: z.string().max(2000).describe('The absolute URL every path is under, e.g. "https://api.example.com/v1"'),
    runtime: z.enum(API_RUNTIMES).optional().describe('server (default): calls run in the app server, which can hold a secret; browser: calls run in the page, with no secret'),
    auth: AuthInput.optional()
  }),
  apply: (draft, { name: given, baseUrl, runtime = 'server', auth }) => {
    const name = sourceName(draft, given)
    const source: ApiSource = {
      id: draft.mint('ds', name),
      name,
      kind: 'api',
      env: {},
      ...(auth ? { auth: { ...auth, secret: auth.secret ?? 'apiKey' } } : {}),
      baseUrl,
      runtime,
      models: [],
      queries: [],
      actions: []
    }
    settle(source)
    draft.model.datasources.push(source)
    const filePath = draft.place(source.id, '.bildr/datasources', name)
    return { datasourceId: source.id, filePath }
  }
})

export const apiUpdate = defineEdit({
  input: z.object({
    datasource: DataSourceRef,
    name: z.string().min(1).max(60).optional().describe('A new name (kebab-cased); its file keeps its path'),
    baseUrl: z.string().max(2000).optional(),
    runtime: z.enum(API_RUNTIMES).optional(),
    auth: AuthInput.nullable().optional().describe('The auth, or null for none')
  }),
  apply: (draft, { datasource: id, name, baseUrl, runtime, auth }) => {
    const source = apiById(draft, id)
    const previous = { name: source.name, runtime: source.runtime }
    if (name !== undefined) source.name = sourceName(draft, name, id)
    if (baseUrl !== undefined) source.baseUrl = baseUrl
    if (runtime !== undefined) source.runtime = runtime
    if (auth === null) delete source.auth
    else if (auth) source.auth = { ...auth, secret: auth.secret ?? source.auth?.secret ?? 'apiKey' }
    settle(source, previous)
    return {}
  }
})

// ── Models ───────────────────────────────────────────────────────────────

const modelOf = (source: ApiSource, name: string): ApiModel =>
  source.models.find(model => model.name === name) ?? fail('not_found', `No model "${name}" in ${source.name}`)

/** Who names model `name`: other models, queries and actions, for refusals. */
const modelUsers = (source: ApiSource, name: string) => ({
  models: source.models.filter(model => model.name !== name && model.fields.some(field => field.model === name)).map(model => model.name),
  queries: source.queries.filter(query => query.result.model === name).map(query => query.name),
  actions: source.actions.filter(action => action.result?.model === name || action.body?.model === name).map(action => action.name)
})

const listText = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/** Replaces the item with the same name, or appends it. */
const put = <T extends { name: string }>(items: T[], item: T) => {
  const at = items.findIndex(entry => entry.name === item.name)
  if (at === -1) items.push(item)
  else items[at] = item
}

export const apiModelSet = defineEdit({
  input: z.object({ datasource: DataSourceRef, model: ApiModelSchema.describe('The whole model: it replaces the one with its name, or is added') }),
  apply: (draft, { datasource: id, model }) => {
    const source = apiById(draft, id)
    put(source.models, model)
    settle(source)
    return {}
  }
})

export const apiModelRename = defineEdit({
  input: z.object({ datasource: DataSourceRef, model: PascalNameSchema, name: PascalNameSchema }),
  apply: (draft, { datasource: id, model: from, name: to }) => {
    const source = apiById(draft, id)
    const model = modelOf(source, from)
    if (from === to) return {}
    if (source.models.some(entry => entry.name === to)) fail('invalid', `A model is already named "${to}"`)
    model.name = to
    for (const entry of source.models) for (const field of entry.fields) if (field.model === from) field.model = to
    for (const query of source.queries) if (query.result.model === from) query.result.model = to
    for (const action of source.actions) {
      if (action.result?.model === from) action.result.model = to
      if (action.body?.model === from) action.body.model = to
    }
    settle(source)
    return {}
  }
})

export const apiModelDelete = defineEdit({
  input: z.object({ datasource: DataSourceRef, model: PascalNameSchema }),
  apply: (draft, { datasource: id, model: name }) => {
    const source = apiById(draft, id)
    const model = modelOf(source, name)
    const users = modelUsers(source, name)
    const parts = [
      ...(users.models.length ? [`the model${users.models.length > 1 ? 's' : ''} ${listText(users.models)}`] : []),
      ...(users.queries.length ? [`the quer${users.queries.length > 1 ? 'ies' : 'y'} ${listText(users.queries)}`] : []),
      ...(users.actions.length ? [`the action${users.actions.length > 1 ? 's' : ''} ${listText(users.actions)}`] : [])
    ]
    if (parts.length) fail('invalid', `${name} is used by ${listText(parts)}`)
    source.models.splice(source.models.indexOf(model), 1)
    return {}
  }
})

// ── Queries and actions ──────────────────────────────────────────────────

type OperationKind = 'query' | 'action'

/** A query and an action share one namespace: each becomes a use-case and a composable. */
const nameTaken = (source: ApiSource, name: string, kind: OperationKind, renaming: boolean) => {
  // A set replaces the item of its own kind with that name; a rename takes a name no other item has.
  if ((renaming || kind === 'action') && source.queries.some(entry => entry.name === name)) fail('invalid', `The query "${name}" already has this name`)
  if ((renaming || kind === 'query') && source.actions.some(entry => entry.name === name)) fail('invalid', `The action "${name}" already has this name`)
}

const operationOf = <T extends ApiQuery | ApiAction>(source: ApiSource, items: T[], kind: OperationKind, name: string): T =>
  items.find(entry => entry.name === name) ?? fail('not_found', `No ${kind} "${name}" in ${source.name}`)

const withoutEmpty = <T extends { description?: string }>(item: T): T => {
  const next = { ...item }
  if (!next.description) delete next.description
  return next
}

export const apiQuerySet = defineEdit({
  input: z.object({
    datasource: DataSourceRef,
    query: ApiQuerySchema.extend({ params: ApiQuerySchema.shape.params.optional() }).describe('The whole query (GET <path>): it replaces the one with its name, or is added')
  }),
  apply: (draft, { datasource: id, query }) => {
    const source = apiById(draft, id)
    nameTaken(source, query.name, 'query', false)
    put(source.queries, withoutEmpty({ ...query, params: query.params ?? [] }))
    settle(source)
    return {}
  }
})

export const apiActionSet = defineEdit({
  input: z.object({
    datasource: DataSourceRef,
    action: ApiActionSchema.extend({ params: ApiActionSchema.shape.params.optional() }).describe('The whole action (<method> <path>): it replaces the one with its name, or is added')
  }),
  apply: (draft, { datasource: id, action }) => {
    const source = apiById(draft, id)
    nameTaken(source, action.name, 'action', false)
    put(source.actions, withoutEmpty({ ...action, params: action.params ?? [] }))
    settle(source)
    return {}
  }
})

const rename = (draft: Draft, id: string, kind: OperationKind, from: string, to: string) => {
  const source = apiById(draft, id)
  const item = operationOf<ApiQuery | ApiAction>(source, kind === 'query' ? source.queries : source.actions, kind, from)
  if (from === to) return {}
  nameTaken(source, to, kind, true)
  item.name = to
  settle(source)
  return {}
}

const remove = (draft: Draft, id: string, kind: OperationKind, name: string) => {
  const source = apiById(draft, id)
  const items: (ApiQuery | ApiAction)[] = kind === 'query' ? source.queries : source.actions
  items.splice(items.indexOf(operationOf(source, items, kind, name)), 1)
  return {}
}

export const apiQueryRename = defineEdit({
  input: z.object({ datasource: DataSourceRef, query: CamelNameSchema, name: CamelNameSchema }),
  apply: (draft, { datasource, query, name }) => rename(draft, datasource, 'query', query, name)
})

export const apiQueryDelete = defineEdit({
  input: z.object({ datasource: DataSourceRef, query: CamelNameSchema }),
  apply: (draft, { datasource, query }) => remove(draft, datasource, 'query', query)
})

export const apiActionRename = defineEdit({
  input: z.object({ datasource: DataSourceRef, action: CamelNameSchema, name: CamelNameSchema }),
  apply: (draft, { datasource, action, name }) => rename(draft, datasource, 'action', action, name)
})

export const apiActionDelete = defineEdit({
  input: z.object({ datasource: DataSourceRef, action: CamelNameSchema }),
  apply: (draft, { datasource, action }) => remove(draft, datasource, 'action', action)
})
