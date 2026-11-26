import { z } from 'zod'
import { API_RUNTIMES, ApiActionSchema, ApiModelSchema, ApiQuerySchema, apiProblems, CamelNameSchema, PascalNameSchema, SourceTimeoutSchema } from '../model/schemas.ts'
import type { ApiAction, ApiModel, ApiQuery, DataSourceFile } from '../model/schemas.ts'
import { camel, defineEdit, fail, snake } from './core.ts'
import type { Draft } from './core.ts'
import { AuthInput, datasourceById, DataSourceRef, envNameOf, sourceName, TIMEOUT_TEXT } from './datasources.ts'
import { apiNameProblem } from './generated-names.ts'
import { apiMembersResolve } from './api-uses.ts'
import type { ApiUse } from './api-uses.ts'
import { apiArgsProblem, moduleOfPageIn } from './page-uses.ts'
import { pageNameProblem } from './queries.ts'
import { apiQueryUsesOf, apiReadsOf, describeUses } from './usage.ts'

/**
 * API data sources (simple data, SD-2): a remote JSON API with a first-class `baseUrl`, the
 * models of its answers and bodies, and named queries (GET) and actions (writes). Every edit
 * leaves the source as `apiProblems` wants it, and the load check runs the same rules on a
 * hand-written file; `settle` only fills in the env names. Secrets follow the REST rule: the auth secret is an env var only.
 */

export type ApiSource = DataSourceFile & Required<Pick<DataSourceFile, 'baseUrl' | 'runtime' | 'models' | 'queries' | 'actions'>>

export const isApiSource = (source: DataSourceFile): source is ApiSource => source.kind === 'api'

export const apiById = (draft: Draft, id: string): ApiSource => {
  const source = datasourceById(draft, id)
  if (!isApiSource(source)) fail('invalid', `"${source.name}" is not an API data source`)
  return source as ApiSource
}

/**
 * `NUXT_APIS_<NAME>_<SETTING>`: the env var Nuxt maps onto `runtimeConfig.apis.<name>.<setting>`. API sources have a key of their own
 * (REST ones are under `datasources`), so one kind's settings can't change the type of the other's.
 */
const apiEnvName = (name: string, setting: string) => `NUXT_APIS_${snake(camel(name)).toUpperCase()}_${snake(setting).toUpperCase()}`

/** The env var of the base URL: browser code reads only `runtimeConfig.public`, hence `NUXT_PUBLIC_`. */
const baseUrlEnv = (name: string, runtime: ApiSource['runtime']) =>
  runtime === 'browser' ? apiEnvName(name, 'baseUrl').replace(/^NUXT_/, 'NUXT_PUBLIC_') : apiEnvName(name, 'baseUrl')

/** The names bildr gave `setting` of the source `name` before: under `datasources` (P1), where the REST sources are. */
const legacyEnvNames = (name: string, setting: string) => [envNameOf(name, setting), envNameOf(name, setting).replace(/^NUXT_/, 'NUXT_PUBLIC_')]

/**
 * Fills in the env vars and runs the source's rules, failing on the first problem. An env
 * var bildr named follows the source's name and runtime (generated code reads
 * `runtimeConfig.apis.<name>`, which Nuxt fills from that name); one the user named stays.
 */
const settle = (source: ApiSource, previous: { name: string, auth?: { secret: string } } = source) => {
  const env: Record<string, string> = { ...source.env }
  const oursBase = [baseUrlEnv(previous.name, 'server'), baseUrlEnv(previous.name, 'browser'), ...legacyEnvNames(previous.name, 'baseUrl')]
  if (!env.baseUrl || oursBase.includes(env.baseUrl)) env.baseUrl = baseUrlEnv(source.name, source.runtime)
  for (const setting of Object.keys(env)) {
    if (setting !== 'baseUrl' && setting !== source.auth?.secret) Reflect.deleteProperty(env, setting)
  }
  if (source.auth) {
    const secret = source.auth.secret
    if (!env[secret] || [apiEnvName(previous.name, secret), ...legacyEnvNames(previous.name, secret)].includes(env[secret])) env[secret] = apiEnvName(source.name, secret)
  }
  source.env = env
  const first = apiProblems(source)[0]
  if (first) fail('invalid', first.message)
  // The names the generated code can't take (reserved words, names it declares itself): the generator throws the same message.
  const naming = apiNameProblem(source)
  if (naming) fail('invalid', naming)
}

// ── Pages that use the source (SD-6) ─────────────────────────────────────

/** Every page use of a query of `source`, with its page. */
const pageUsesOf = (draft: Draft, source: ApiSource) =>
  Object.values(draft.model.modules).flatMap(mod => mod.pages.flatMap(page => (page.uses?.apis ?? []).filter(use => use.datasource === source.id).map(use => ({ page, use }))))

const pageLabel = (page: { id: string, name: string }) => `page "${page.name}" (${page.id})`

/** The source's own name or one of its queries' names changed: the composables its pages call are named from both, so none may meet another name the page declares. */
const checkPagesNames = (draft: Draft, source: ApiSource) => {
  for (const page of new Set(pageUsesOf(draft, source).map(entry => entry.page))) {
    const problem = pageNameProblem(draft, page)
    if (problem) fail('invalid', `${problem}, on ${pageLabel(page)}: change it first`)
  }
}

/** The queries of `source` whose answer the pages read below a row (`product.title`): each read as `where binds "path"`, with the model it starts at. */
const unresolvedReads = (draft: Draft, source: ApiSource, models: ApiModel[]) =>
  apiReadsOf(draft.model, use => use.datasource === source.id).reads.flatMap((read) => {
    const query = source.queries.find(entry => entry.name === read.use.query)
    if (!query || !read.row || apiMembersResolve(models, query.result.model, read.members)) return []
    return [{ read, query, key: `${read.page.id}|${read.where}|${read.as}.${read.members.join('.')}` }]
  })

/** Rule of the entity fields (`entity_field_update`): a field the pages bind by name can't go while they do. A model that no longer has a field some page reads is refused. */
const checkReadsKept = (draft: Draft, source: ApiSource, before: Set<string>) => {
  const broken = unresolvedReads(draft, source, source.models).find(entry => !before.has(entry.key))
  if (!broken) return
  const { read, query } = broken
  fail('invalid', `The query "${query.name}" of the API "${source.name}" is read by ${pageLabel(read.page)}: ${read.where} binds "${read.as}.${read.members.join('.')}", which the model no longer has. Change them first`)
}

/** The page uses of a query's args against its params, as the query is now. */
const checkUsesFit = (draft: Draft, source: ApiSource, query: ApiQuery) => {
  const label = `The query "${query.name}" of the API "${source.name}"`
  for (const { page, use } of pageUsesOf(draft, source).filter(entry => entry.use.query === query.name)) {
    const passes = (use: ApiUse) => Object.keys(use.args ?? {})
    for (const name of passes(use)) {
      if (!query.params.some(param => param.name === name)) fail('invalid', `${label} has no parameter "${name}", but ${pageLabel(page)} passes it as "${use.as}": change it first`)
    }
    for (const param of query.params) {
      if ((param.in === 'path' || param.required) && use.args?.[param.name] === undefined) fail('invalid', `${label} needs "${param.name}", but ${pageLabel(page)} doesn't pass it as "${use.as}": change it first`)
    }
    const problem = apiArgsProblem(source, query, use.args, { page, states: moduleOfPageIn(draft.model, page).mod.state, as: use.as })
    if (problem) fail('invalid', `${problem} (${pageLabel(page)}, as "${use.as}"): change it first`)
  }
}

export const apiCreate = defineEdit({
  input: z.object({
    name: z.string().min(1).max(60).describe('Kebab-cased into its name, e.g. "Shop API" → "shop-api"; the id is ds_<name>'),
    baseUrl: z.string().max(2000).describe('The absolute URL every path is under, e.g. "https://api.example.com/v1"'),
    runtime: z.enum(API_RUNTIMES).optional().describe('server (default): calls run in the app server, which can hold a secret; browser: calls run in the page, with no secret'),
    auth: AuthInput.optional(),
    timeout: SourceTimeoutSchema.optional().describe(TIMEOUT_TEXT)
  }),
  apply: (draft, { name: given, baseUrl, runtime = 'server', auth, timeout }) => {
    const name = sourceName(draft, given)
    const source: ApiSource = {
      id: draft.mint('ds', name),
      name,
      kind: 'api',
      env: {},
      ...(auth ? { auth: { ...auth, secret: auth.secret ?? 'apiKey' } } : {}),
      ...(timeout === undefined ? {} : { timeout }),
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
    auth: AuthInput.nullable().optional().describe('The auth, or null for none'),
    timeout: SourceTimeoutSchema.nullable().optional().describe(`${TIMEOUT_TEXT}; null for the default`)
  }),
  apply: (draft, { datasource: id, name, baseUrl, runtime, auth, timeout }) => {
    const source = apiById(draft, id)
    const previous = { name: source.name }
    if (name !== undefined) source.name = sourceName(draft, name, id)
    if (baseUrl !== undefined) source.baseUrl = baseUrl
    if (runtime !== undefined) source.runtime = runtime
    if (timeout === null) delete source.timeout
    else if (timeout !== undefined) source.timeout = timeout
    if (auth === null) delete source.auth
    else if (auth) source.auth = { ...auth, secret: auth.secret ?? source.auth?.secret ?? 'apiKey' }
    settle(source, previous)
    // The pages hold the source by id, so they follow a rename; what they derive from its name has to stay free.
    if (source.name !== previous.name) checkPagesNames(draft, source)
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
    const before = new Set(unresolvedReads(draft, source, source.models).map(entry => entry.key))
    put(source.models, model)
    settle(source)
    checkReadsKept(draft, source, before)
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
    const previous = source.queries.find(entry => entry.name === query.name)
    const before = new Set(unresolvedReads(draft, source, source.models).map(entry => entry.key))
    const next = withoutEmpty({ ...query, params: query.params ?? [] })
    put(source.queries, next)
    settle(source)
    const uses = apiQueryUsesOf(draft.model, id, query.name)
    // What a page binds is the model's fields, a list or one record: those can't change under it.
    if (previous && uses.length && (previous.result.model !== next.result.model || previous.result.many !== next.result.many)) {
      fail('invalid', `The query "${next.name}" of the API "${source.name}" is used by ${describeUses(uses)}: its model and its one/many can't change while they use it. Change them first`)
    }
    checkUsesFit(draft, source, next)
    checkReadsKept(draft, source, before)
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
  if (kind === 'query') {
    // The pages name the query: they follow it, and the composable they call (named from it) has to stay free of their other names.
    for (const { use } of pageUsesOf(draft, source)) if (use.query === from) use.query = to
  }
  settle(source)
  if (kind === 'query') checkPagesNames(draft, source)
  return {}
}

const remove = (draft: Draft, id: string, kind: OperationKind, name: string) => {
  const source = apiById(draft, id)
  const items: (ApiQuery | ApiAction)[] = kind === 'query' ? source.queries : source.actions
  const item = operationOf(source, items, kind, name)
  const uses = kind === 'query' ? apiQueryUsesOf(draft.model, id, name) : []
  if (uses.length) fail('invalid', `The query "${name}" of the API "${source.name}" is still used: ${describeUses(uses)}. Change them first`)
  items.splice(items.indexOf(item), 1)
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
