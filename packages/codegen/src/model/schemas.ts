import { z } from 'zod'
import { ThemeSchema } from '../design/theme.ts'
import { BREAKPOINT_BASES } from '../design/tokens.ts'
import { API_VALUE_TYPES, CURRENCY_PATTERN, valueSettingsProblems } from './field-types.ts'

/**
 * The `.bildr/` model: one JSON file per artifact. The editor writes these
 * files and the generator reads them (see the codegen reference architecture,
 * §5). Pure zod: no Vue, Nitro or fs, so it runs in the editor, the module
 * and tests alike. Optional fields stay absent when unset, so a file
 * serializes back exactly as it was parsed.
 */

export const SCHEMA_URL = 'https://bildr.dev/schema'

/** Artifact ids: a kind prefix plus a name, for example `ent_post` or `q_featured_posts`. */
export const ArtifactIdSchema = z.string().regex(/^[a-z]+_[a-z0-9_]+$/, 'Use a kind prefix and lowercase letters, digits or underscores, like "ent_post"')
/** Node, slot and field-local ids. */
export const LocalIdSchema = z.string().regex(/^[\w-]{1,64}$/, 'Invalid id')
export const ModuleNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and dashes (kebab-case)')
export const PascalNameSchema = z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Use PascalCase, like "BlogPost"')
export const CamelNameSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'Use camelCase, like "featuredPosts"')
export const EnvNameSchema = z.string().regex(/^NUXT_[A-Z0-9_]+$/, 'Use an env var name starting with NUXT_, like NUXT_DATASOURCES_API_KEY')

const schemaField = { $schema: z.string().optional() }

/** Any JSON value. Expressions inside it are objects with one `$`-key (`$bind`, `$param`, …), checked in `load.ts`. */
export const ValueSchema = z.json()
export type Value = z.infer<typeof ValueSchema>

export const EXPRESSION_KEYS = ['$bind', '$param', '$input', '$route', '$form', '$now', '$var', '$event', '$template'] as const

/** A dot-separated path of identifiers (`post.title`): the only form an expression path takes, because generated code reads it as property access. */
export const PROPERTY_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/

/** Expressions whose string value is a path (`$template` holds `{path}` parts instead). */
export const PATH_EXPRESSIONS = ['$bind', '$param', '$input', '$route', '$form', '$var'] as const

// ── UI trees ────────────────────────────────────────────────────────────

export const INTERACTION_EVENTS = ['click', 'change', 'submit', 'mouseenter', 'mouseleave', 'appear'] as const
export const UI_STEP_KINDS = ['runAction', 'navigate', 'setState', 'toast', 'setVariant'] as const

/** A UI flow step. Business rules never live here; they belong to server actions. */
export const UiStepSchema = z.looseObject({ kind: z.enum(UI_STEP_KINDS) })
export const InteractionSchema = z.object({ on: z.enum(INTERACTION_EVENTS), do: z.array(UiStepSchema).min(1) })

export interface ModelNode {
  id: string
  type: string
  name?: string
  /** Locked on the canvas: editor metadata the generator ignores. */
  locked?: boolean
  props?: Record<string, Value>
  style?: Record<string, string>
  interactions?: Array<z.infer<typeof InteractionSchema>>
  children?: ModelNode[]
}

export const ModelNodeSchema: z.ZodType<ModelNode> = z.lazy(() => z.object({
  id: LocalIdSchema,
  type: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  locked: z.boolean().optional(),
  props: z.record(z.string(), ValueSchema).optional(),
  style: z.record(z.string(), z.string()).optional(),
  interactions: z.array(InteractionSchema).optional(),
  children: z.array(ModelNodeSchema).optional()
}))

// ── Project-level files ────────────────────────────────────────────────

export const ProjectFileSchema = z.object({
  ...schemaField,
  schemaVersion: z.int().min(1),
  generatorVersion: z.string().min(1),
  starterKit: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  defaultModule: ModuleNameSchema,
  modules: z.array(ModuleNameSchema),
  /** Which device the unprefixed style is for: `mobile` (absent; `sm:`/`md:`/`lg:` override wider) or `desktop` (`max-lg:`/`max-md:`/`max-sm:` override narrower). */
  breakpointBase: z.enum(BREAKPOINT_BASES).optional()
})

/** The editor's `Theme` (D11): the same palette colours, font, radius and spacing the canvas paints. */
export const ThemeFileSchema = ThemeSchema.extend(schemaField)

/**
 * Where a repository's rows live: `sqlite` (the app database), `rest` (a remote API) or
 * `memory` (the server process, seeded from the module fixtures at boot, never persisted).
 */
export const DATASOURCE_KINDS = ['sqlite', 'rest', 'memory', 'api'] as const

// ── API data sources (simple data, SD-2) ─────────────────────────────────

/**
 * An `api` data source is a remote JSON API the app calls by name: its `baseUrl`, the
 * models its responses and bodies have, and named queries (GET) and actions (writes).
 * It owns no collections: queries and actions are the whole contract. `runtime` says
 * where the generated calls run: on the server (the secret stays there) or in the browser.
 */
export const API_RUNTIMES = ['server', 'browser'] as const
export const API_FIELD_TYPES = [...API_VALUE_TYPES, 'model'] as const
export const API_PARAM_TYPES = ['text', 'integer', 'number', 'boolean'] as const
export const API_ACTION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

/** For `type: "select"`: the values the field can take. */
const SelectOptionsSchema = z.array(z.string().min(1).max(64)).max(100)
/** For `type: "money"`: its ISO 4217 currency code (`EUR`). */
const CurrencySchema = z.string().regex(CURRENCY_PATTERN, 'Use a currency code like "EUR"')

/** The remote JSON key of a field or parameter, when it isn't its name (`created_at`). */
const RemoteKeySchema = z.string().min(1).max(64)
/** A path under the base URL: `/` then segments, `:name` for a path parameter; no `..`, query or fragment. */
export const API_PATH = /^\/(?:(?:[\w\-~]+|:[a-z][A-Za-z0-9]*)(?:\.(?:[\w\-~]+))*(?:\/|$))*$/

export const ApiFieldSchema = z.object({
  name: CamelNameSchema,
  type: z.enum(API_FIELD_TYPES),
  /** For `type: "model"`: the model of the value. */
  model: PascalNameSchema.optional(),
  options: SelectOptionsSchema.optional(),
  currency: CurrencySchema.optional(),
  /** A list of values (or of models). */
  list: z.boolean().optional(),
  /** The key may be missing. */
  optional: z.boolean().optional(),
  /** The value may be null. */
  nullable: z.boolean().optional(),
  key: RemoteKeySchema.optional()
})
export const ApiModelSchema = z.object({ name: PascalNameSchema, fields: z.array(ApiFieldSchema).min(1) })
/** Where a parameter goes: a `:name` of the path, the query string, or a header (`key` is the header's name, else the parameter's). */
export const API_PARAM_PLACES = ['path', 'query', 'header'] as const
export const ApiParamSchema = z.object({
  name: CamelNameSchema,
  in: z.enum(API_PARAM_PLACES),
  type: z.enum(API_PARAM_TYPES),
  /** A query parameter the call can't go without (path parameters always are). */
  required: z.boolean().optional(),
  key: RemoteKeySchema.optional()
})
/**
 * Where a wrapped list sits in an answer: JSON keys joined by dots (`data.items`, `hydra:member`). The keys
 * are the ones `detectItems` finds; generated code reads each one as a quoted property, never as code.
 */
export const API_ITEMS_PATH = /^[\w$@:-]+(?:\.[\w$@:-]+)*$/
/** What a call answers: one model or a list of them, read at `itemsPath` when the list is wrapped. */
export const ApiResultSchema = z.object({ model: PascalNameSchema, many: z.boolean(), itemsPath: z.string().max(200).regex(API_ITEMS_PATH, 'Use JSON keys joined by dots, like "data.items"').optional() })
/** A header a call always sends, with the same value (`X-Api-Version: 2`): never the sign-in nor a secret (`apiHeaderProblem`). */
export const ApiHeaderSchema = z.object({ name: z.string().max(64), value: z.string().max(500) })
export const ApiQuerySchema = z.object({
  name: CamelNameSchema,
  description: z.string().max(500).optional(),
  path: z.string().max(300),
  params: z.array(ApiParamSchema),
  headers: z.array(ApiHeaderSchema).optional(),
  result: ApiResultSchema
})
export const ApiActionSchema = z.object({
  name: CamelNameSchema,
  description: z.string().max(500).optional(),
  method: z.enum(API_ACTION_METHODS),
  path: z.string().max(300),
  params: z.array(ApiParamSchema),
  headers: z.array(ApiHeaderSchema).optional(),
  /** The JSON body the action sends. */
  body: z.object({ model: PascalNameSchema }).optional(),
  /** What it answers; none for an empty answer (204). */
  result: ApiResultSchema.optional()
})

export type ApiField = z.infer<typeof ApiFieldSchema>
export type ApiModel = z.infer<typeof ApiModelSchema>
export type ApiParam = z.infer<typeof ApiParamSchema>
export type ApiHeader = z.infer<typeof ApiHeaderSchema>
export type ApiQuery = z.infer<typeof ApiQuerySchema>
export type ApiAction = z.infer<typeof ApiActionSchema>

interface ApiParts {
  baseUrl?: string
  env?: Record<string, string>
  runtime?: (typeof API_RUNTIMES)[number]
  auth?: { type: 'bearer' | 'header', secret: string, header?: string }
  models?: ApiModel[]
  queries?: ApiQuery[]
  actions?: ApiAction[]
}

export interface ApiProblem { path: (string | number)[], message: string }

const pathProblem = (path: string, params: ApiParam[]): string | undefined => {
  if (!API_PATH.test(path)) return `"${path}" can't be a path: A path is "/" followed by segments, like "/products/:id" (no "..", query or fragment)`
  const inPath = [...path.matchAll(/:([a-z][A-Za-z0-9]*)/g)].map(match => match[1]!)
  const pathParams = params.filter(param => param.in === 'path').map(param => param.name)
  const missing = inPath.find(name => !pathParams.includes(name))
  if (missing) return `":${missing}" in the path needs a path parameter "${missing}"`
  const extra = pathParams.find(name => !inPath.includes(name))
  if (extra) return `Path parameter "${extra}" is not in the path: add ":${extra}" to it, or make it a query parameter`
  if (new Set(inPath).size !== inPath.length) return 'A path names each parameter once'
  return undefined
}

const duplicateOf = (names: string[]) => names.find((name, index) => names.indexOf(name) !== index)

// ── Headers of a call (api-calls R2) ─────────────────────────────────────

export const MAX_CALL_HEADERS = 20
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/
/** One line of visible ASCII and spaces: what every client sends as is (no line break could start another header). */
const HEADER_VALUE = /^[\x20-\x7E]*$/
const SIGN_IN_HEADERS = new Set(['authorization', 'proxy-authorization'])
/** Headers the app's clients send themselves (accept is the call's to change), or that a browser refuses to let a page set. */
const OWN_HEADERS = new Set(['cookie', 'cookie2', 'host', 'content-type', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect', 'origin', 'referer', 'date', 'via', 'x-http-method-override', 'x-http-method', 'x-method-override'])
/** A header name that says it holds a secret: a key, a token, a password, a session, a sign-in. */
const SECRET_NAME = /(?:^|-)(?:api-?key|key|token|secret|password|passwd|pwd|session|credentials?|signature|auth|authorization|authentication)(?:-|$)/i
/**
 * A word long enough and mixed enough to be a key: mixed case (`sk_live_4eC39…`), or one long run of letters and digits (a hex token). A
 * lowercase word made of short parts, like `application/vnd.github.v3+json` or `my-app-version-2024`, is a name, not a key.
 */
const keyLike = (word: string) => word.length >= 24 && /^[\w\-+/=.~]+$/.test(word) && /[A-Za-z]/.test(word) && /\d/.test(word)
  && ((/[a-z]/.test(word) && /[A-Z]/.test(word)) || Math.max(...word.split(/[^A-Za-z0-9]+/).map(part => part.length)) >= 20)
/** A value that is a sign-in (`Bearer …`), or that holds a key-like word anywhere (`ApiKey sk_live_…`). */
const secretValue = (value: string) => /^(?:bearer|basic|token|digest)\s/i.test(value) || value.split(/[\s,;]+/).some(keyLike)

/**
 * Why a call can't send the header `name` (with the fixed `value`; undefined when a parameter fills it), or undefined when it can. The
 * source's sign-in is the only place a secret lives: a header named like it (Authorization, or the source's own key header) is refused,
 * and so is a fixed value that looks like a secret. Names the clients set themselves, or a browser refuses, are refused too.
 */
export const apiHeaderProblem = (name: string, value: string | undefined, auth: ApiParts['auth']): string | undefined => {
  if (!HEADER_NAME.test(name)) return 'Use a header name like "X-Api-Version"'
  const lower = name.toLowerCase()
  if (SIGN_IN_HEADERS.has(lower) || (auth?.type === 'header' && auth.header?.toLowerCase() === lower)) return `"${name}" is the API's sign-in: set it in the API's settings, where its secret stays in env`
  if (OWN_HEADERS.has(lower) || lower.startsWith('sec-') || lower.startsWith('proxy-')) return `A call can't send "${name}": the app sends it itself, or the browser refuses it`
  if (value === undefined) return undefined
  const line = apiHeaderValueProblem(name, value)
  if (line) return line
  if (!value.trim()) return `"${name}": give it a value, or remove it`
  if (SECRET_NAME.test(name) || secretValue(value.trim())) return `"${name}" looks like a secret: put it in the API's sign-in, where it stays in env`
  return undefined
}

/** Why `value` can't be sent in the header `name`: it is not one line of plain text (a line break would start another header). */
export const apiHeaderValueProblem = (name: string, value: string): string | undefined =>
  HEADER_VALUE.test(value) ? undefined : `"${name}": a header value is one line of plain text`

/** The header a parameter in a header fills: its key, else its name. */
export const headerNameOf = (param: ApiParam): string => param.key ?? param.name

/** The first problem of the headers a call sends: its fixed ones and its header parameters. */
const headersProblem = (headers: ApiHeader[], params: ApiParam[], auth: ApiParts['auth']): string | undefined => {
  const sent = [...headers.map(header => ({ name: header.name, value: header.value as string | undefined })), ...params.filter(param => param.in === 'header').map(param => ({ name: headerNameOf(param), value: undefined }))]
  if (sent.length > MAX_CALL_HEADERS) return `A call sends at most ${MAX_CALL_HEADERS} headers`
  for (const header of sent) {
    const problem = apiHeaderProblem(header.name, header.value, auth)
    if (problem) return problem
  }
  const twice = duplicateOf(sent.map(header => header.name.toLowerCase()))
  return twice ? `Two headers are named "${twice}"` : undefined
}

/** Why `value` can't be a base URL: REST `defaults.baseUrl` and API `baseUrl` share the rule. */
export const urlProblem = (value: string): string | undefined => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `"${value}" is not an absolute URL, like "https://api.example.com/v1"`
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'A base URL is http or https'
  if (url.username || url.password) return 'A base URL can\'t hold a user name or password: put the secret in an env var (auth)'
  if (url.search || url.hash) return 'A base URL has no query or fragment'
  return undefined
}

/** The model cycle through `models`, if any: each model is walked once (depth-first, three colours). */
const modelCycle = (models: ApiModel[]): string[] | undefined => {
  const byName = new Map(models.map(model => [model.name, model]))
  const done = new Set<string>()
  const trail: string[] = []
  const walk = (name: string): string[] | undefined => {
    if (trail.includes(name)) return [...trail.slice(trail.indexOf(name)), name]
    if (done.has(name)) return undefined
    trail.push(name)
    for (const field of byName.get(name)?.fields ?? []) {
      if (!field.model || !byName.has(field.model)) continue
      const cycle = walk(field.model)
      if (cycle) return cycle
    }
    trail.pop()
    done.add(name)
    return undefined
  }
  for (const model of models) {
    const cycle = walk(model.name)
    if (cycle) return cycle
  }
  return undefined
}

/** What's wrong with an API source's parts: the load check and the edits share it. */
export const apiProblems = (source: ApiParts): ApiProblem[] => {
  const problems: ApiProblem[] = []
  const models = source.models ?? []
  const known = new Set(models.map(model => model.name))
  const url = source.baseUrl === undefined ? undefined : urlProblem(source.baseUrl)
  if (url) problems.push({ path: ['baseUrl'], message: url })
  const baseEnv = source.env?.baseUrl
  if (source.env && !baseEnv) problems.push({ path: ['env', 'baseUrl'], message: 'An API data source needs the env var of its base URL (env.baseUrl)' })
  // Browser code reads only runtimeConfig.public, which Nuxt fills from NUXT_PUBLIC_ vars; a server URL stays private.
  if (baseEnv && source.runtime === 'browser' && !baseEnv.startsWith('NUXT_PUBLIC_')) {
    problems.push({ path: ['env', 'baseUrl'], message: 'An API that runs in the browser reads its base URL from a NUXT_PUBLIC_ env var' })
  }
  if (baseEnv && source.runtime === 'server' && baseEnv.startsWith('NUXT_PUBLIC_')) {
    problems.push({ path: ['env', 'baseUrl'], message: 'An API that runs on the server reads its base URL from an env var that isn\'t NUXT_PUBLIC_: the page would see it' })
  }
  for (const setting of Object.keys(source.env ?? {})) {
    if (setting !== 'baseUrl' && setting !== source.auth?.secret) problems.push({ path: ['env', setting], message: `An API data source reads only its base URL and its secret from env: remove "${setting}"` })
  }
  const auth = source.auth
  if (auth?.secret === 'baseUrl') problems.push({ path: ['auth', 'secret'], message: '"baseUrl" is the base URL setting: name the secret another way, like "apiKey"' })
  if (auth?.type === 'header' && !auth.header) problems.push({ path: ['auth', 'header'], message: 'A "header" auth needs the header name, like "X-Api-Key"' })
  if (auth?.type === 'bearer' && auth.header) problems.push({ path: ['auth', 'header'], message: 'A "bearer" auth sends "Authorization: Bearer …": it takes no header name' })
  if (auth?.header && !/^[A-Za-z0-9-]{1,64}$/.test(auth.header)) problems.push({ path: ['auth', 'header'], message: 'Use a header name like "X-Api-Key"' })
  if (source.runtime === 'browser' && source.auth) {
    problems.push({ path: ['auth'], message: 'An API that runs in the browser can\'t use a secret: the browser would see it. Run it on the server, or remove the auth' })
  }
  const duplicateModel = duplicateOf(models.map(model => model.name))
  if (duplicateModel) problems.push({ path: ['models'], message: `A model is already named "${duplicateModel}"` })
  models.forEach((model, index) => {
    const duplicate = duplicateOf(model.fields.map(field => field.name))
    if (duplicate) problems.push({ path: ['models', index, 'fields'], message: `Two fields of ${model.name} are named "${duplicate}"` })
    const keys = model.fields.map(field => field.key ?? field.name)
    const duplicateKey = duplicateOf(keys)
    if (duplicateKey && !duplicate) problems.push({ path: ['models', index, 'fields'], message: `Two fields of ${model.name} read the key "${duplicateKey}"` })
    model.fields.forEach((field, at) => {
      const where = ['models', index, 'fields', at]
      if (field.type === 'model' && !field.model) problems.push({ path: where, message: `${model.name}.${field.name} is a "model" field: name its model` })
      if (field.type !== 'model' && field.model) problems.push({ path: where, message: `${model.name}.${field.name}: Only a "model" field names a model` })
      if (field.model && !known.has(field.model)) problems.push({ path: where, message: `${model.name}.${field.name}: Unknown model "${field.model}"` })
      for (const message of valueSettingsProblems(field, `${model.name}.${field.name}`)) problems.push({ path: where, message })
    })
  })
  // A model can't contain itself: the generated types and checks would never end.
  const cycle = modelCycle(models)
  if (cycle) problems.push({ path: ['models'], message: `Model cycle: ${cycle.join(' → ')}` })
  const operations = [...(source.queries ?? []).map(query => ({ kind: 'queries' as const, op: query })), ...(source.actions ?? []).map(action => ({ kind: 'actions' as const, op: action }))]
  const duplicate = duplicateOf(operations.map(({ op }) => op.name))
  if (duplicate) problems.push({ path: ['queries'], message: `A query or action is already named "${duplicate}"` })
  const counters = { queries: 0, actions: 0 }
  for (const { kind, op } of operations) {
    const where = [kind, counters[kind]++]
    const path = pathProblem(op.path, op.params)
    if (path) problems.push({ path: [...where, 'path'], message: `${op.name}: ${path}` })
    const param = duplicateOf(op.params.map(item => item.name))
    if (param) problems.push({ path: [...where, 'params'], message: `${op.name}: Two parameters are named "${param}"` })
    const sent = duplicateOf(op.params.filter(item => item.in !== 'header').map(item => `${item.in}:${item.key ?? item.name}`))
    if (sent && !param) problems.push({ path: [...where, 'params'], message: `${op.name}: Two parameters send the key "${sent.slice(sent.indexOf(':') + 1)}"` })
    const headers = headersProblem(op.headers ?? [], op.params, source.auth)
    if (headers) problems.push({ path: [...where, 'headers'], message: `${op.name}: ${headers}` })
    const result = 'result' in op ? op.result : undefined
    if (result && !result.many && result.itemsPath !== undefined) problems.push({ path: [...where, 'result'], message: `${op.name}: Only a list result reads its items at an itemsPath` })
    const refs = [('result' in op ? op.result?.model : undefined), ('body' in op ? op.body?.model : undefined)]
    for (const ref of refs) if (ref && !known.has(ref)) problems.push({ path: where, message: `${op.name}: Unknown model "${ref}"` })
  }
  return problems
}

export const DataSourceFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema,
  kind: z.enum(DATASOURCE_KINDS),
  /** Setting name → env var that holds its value at runtime. */
  env: z.record(CamelNameSchema, EnvNameSchema),
  /** Non-secret defaults written into runtimeConfig. */
  defaults: z.record(CamelNameSchema, z.string()).optional(),
  auth: z.object({ type: z.enum(['bearer', 'header']), secret: CamelNameSchema, header: z.string().optional() }).optional(),
  // `api` only: the base URL its paths are under, where its calls run, and what it offers.
  baseUrl: z.string().max(2000).optional(),
  runtime: z.enum(API_RUNTIMES).optional(),
  models: z.array(ApiModelSchema).optional(),
  queries: z.array(ApiQuerySchema).optional(),
  actions: z.array(ApiActionSchema).optional()
}).superRefine((source, ctx) => {
  const apiKeys = ['baseUrl', 'runtime', 'models', 'queries', 'actions'] as const
  if (source.kind === 'api') {
    for (const key of apiKeys) if (source[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: `An API data source needs "${key}"` })
    if (source.defaults) ctx.addIssue({ code: 'custom', path: ['defaults'], message: 'An API data source has its baseUrl, no other settings' })
    for (const problem of apiProblems(source)) ctx.addIssue({ code: 'custom', path: problem.path, message: problem.message })
  } else {
    for (const key of apiKeys) if (source[key] !== undefined) ctx.addIssue({ code: 'custom', path: [key], message: `Only an API data source has "${key}"` })
  }
  if (source.kind === 'memory') {
    for (const key of ['defaults', 'auth'] as const) {
      if (source[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'A memory data source keeps its rows in the server process: it has no settings' })
    }
    if (Object.keys(source.env).length) ctx.addIssue({ code: 'custom', path: ['env'], message: 'A memory data source keeps its rows in the server process: it has no settings' })
  }
  const secret = source.auth?.secret
  if (!secret) return
  if (!source.env[secret]) ctx.addIssue({ code: 'custom', path: ['auth', 'secret'], message: `Secret "${secret}" needs an env var in "env"` })
  if (source.defaults && secret in source.defaults) {
    ctx.addIssue({ code: 'custom', path: ['defaults', secret], message: `"${secret}" is a secret: set it with ${source.env[secret] ?? 'an env var'}, never in the model` })
  }
})

// ── Component properties and layout variables ──────────────────────────

export const PROPERTY_KINDS = ['text', 'textarea', 'number', 'boolean', 'select', 'image', 'link', 'icon', 'entity', 'field', 'slot'] as const
/** The kinds a layout variable takes: plain values a page sets in `layoutValues`. */
export const LAYOUT_VARIABLE_KINDS = ['text', 'textarea', 'number', 'boolean', 'select', 'image', 'link', 'icon'] as const

/**
 * Which node prop a property drives (the hosted `bindings`); with `target: 'style'`,
 * `prop` is a style key of the node (`bg`, `md:p`) and the property's value is its token.
 * A slot property names its node with `nodeId` instead.
 */
export const PropertyBindingSchema = z.object({ nodeId: LocalIdSchema, prop: z.string().min(1).max(64), target: z.literal('style').optional() })

/**
 * A component property or layout variable. `label`, `description` (a tooltip),
 * `optional` (instances or pages may leave it empty) and `placeholder` only describe
 * it to the editor.
 */
export const PropertySchema = z.object({
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  kind: z.enum(PROPERTY_KINDS),
  label: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  /** `select`: the values it takes, generated as a string-literal union. */
  options: z.array(z.string().min(1).max(100)).min(1).optional(),
  entity: ArtifactIdSchema.optional(),
  pick: z.array(CamelNameSchema).optional(),
  /** `entity`: a list of them (the instance binds it with `$bind`). */
  many: z.boolean().optional(),
  required: z.boolean().optional(),
  optional: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  default: ValueSchema.optional(),
  /** A `slot` property: the node whose children an Instance's SlotFill replaces (they stay its default content). */
  nodeId: LocalIdSchema.optional(),
  bindings: z.array(PropertyBindingSchema).optional()
})

// ── Variants: states, interactions and transitions ─────────────────────

/** A variant id, or `''` for the primary variant (the component's own tree). */
export const VariantRefSchema = z.union([ArtifactIdSchema, z.literal('')])
export const STATE_KINDS = ['hover', 'pressed'] as const
export const VARIANT_EVENTS = ['click', 'mouseenter', 'mouseleave', 'appear'] as const
export const TRANSITION_TYPES = ['instant', 'ease', 'spring'] as const
export const TRANSITION_EASINGS = ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'] as const

/** A variant shown while the pointer is over (`hover`) or pressing (`pressed`) an instance in its base variant `of`. */
export const VariantStateSchema = z.object({ of: VariantRefSchema, kind: z.enum(STATE_KINDS) })

/** On `on`, after `delay` seconds, the instance switches to variant `to` (a `setVariant` step). */
export const VariantInteractionSchema = z.object({
  on: z.enum(VARIANT_EVENTS),
  do: z.tuple([z.object({ kind: z.literal('setVariant'), to: VariantRefSchema, delay: z.number().min(0).max(10).optional() })])
})

/** How style changes animate when an instance changes variant (the hosted `Transition`). */
export const TransitionSchema = z.object({
  type: z.enum(TRANSITION_TYPES),
  duration: z.number().min(0).max(10).optional(),
  easing: z.enum(TRANSITION_EASINGS).optional(),
  stiffness: z.number().min(1).max(1000).optional(),
  damping: z.number().min(0).max(100).optional()
})

export const LayoutFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema,
  slots: z.array(z.object({ id: LocalIdSchema, name: z.string().min(1), nodeId: LocalIdSchema })),
  /** Values pages set (`layoutValues`) and the tree reads with `{ $bind: 'layout.<name>' }`. Absent means none. */
  variables: z.array(PropertySchema).optional(),
  root: ModelNodeSchema
})

export const OWNERS = ['managed', 'scaffold', 'detached', 'deleted', 'orphaned'] as const

/** Every file bildr wrote, with who owns it now (decision D1: detect and detach). */
export const ManifestFileSchema = z.object({
  ...schemaField,
  generatorVersion: z.string().min(1),
  files: z.record(z.string().min(1), z.object({
    owner: z.enum(OWNERS),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().optional()
  }))
})

// ── Module files ───────────────────────────────────────────────────────

/**
 * A module becomes `layers/<name>` with the aliases `#<name>/domain`, so names
 * Nuxt aliases already use (`#app`, `#build`, `#imports`, …) or the core layer's
 * name are refused.
 */
// `apis`: the layer API data sources generate into (simple data SD-5).
export const RESERVED_MODULE_NAMES = ['apis', 'app', 'build', 'components', 'core', 'head', 'imports', 'internal', 'layers', 'nitro', 'shared', 'vue'] as const

export const ModuleFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema.refine(name => !(RESERVED_MODULE_NAMES as readonly string[]).includes(name), {
    error: issue => `"${issue.input as string}" is reserved (Nuxt aliases and the core layer use it)`
  }),
  label: z.string().min(1).max(100),
  dependsOn: z.array(ModuleNameSchema)
})

/** The basic value types: a query or action parameter's and an error's data (no settings to give). */
export const FIELD_TYPES = ['text', 'integer', 'number', 'boolean', 'datetime', 'date', 'image', 'uuid'] as const
/** The types of an entity's or a store's field (field types S3): the catalogue's, as an API model's. */
export const ENTITY_FIELD_TYPES = API_VALUE_TYPES

export const FieldSchema = z.object({
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  type: z.enum(ENTITY_FIELD_TYPES),
  options: SelectOptionsSchema.optional(),
  currency: CurrencySchema.optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  nullable: z.boolean().optional(),
  readonly: z.boolean().optional(),
  default: ValueSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  patternMessage: z.string().optional()
}).superRefine((field, context) => {
  for (const message of valueSettingsProblems(field, field.name)) context.addIssue({ code: 'custom', path: ['type'], message })
  if (field.type === 'select' && (field.min !== undefined || field.max !== undefined || field.pattern !== undefined)) {
    context.addIssue({ code: 'custom', path: ['type'], message: `${field.name}: A "select" field takes no min, max or pattern (its options say what it takes)` })
  }
})

export const EntityFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: PascalNameSchema,
  plural: CamelNameSchema,
  idStrategy: z.enum(['uuid', 'external']),
  timestamps: z.boolean(),
  fields: z.array(FieldSchema).min(1),
  relations: z.array(z.looseObject({ name: CamelNameSchema, to: ArtifactIdSchema, kind: z.enum(['one', 'many']) })),
  // limit: rows an eager collection loads; the list route accepts at most 500 (core PageRequest).
  client: z.object({ sync: z.enum(['eager', 'on-demand']), limit: z.int().min(1).max(500).optional(), staleTime: z.int().min(0).optional() })
})

export const REPOSITORY_OPERATIONS = ['list', 'get', 'create', 'update', 'delete'] as const
const OrderSchema = z.object({ field: CamelNameSchema, direction: z.enum(['asc', 'desc']) })

export const REST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
/** One endpoint of a REST repository operation. `:id` in the path is the entity key. */
export const RestEndpointSchema = z.object({
  method: z.enum(REST_METHODS).optional(),
  path: z.string().regex(/^\/[\w\-/:.]*$/, 'Use a path like /posts/:id')
})

export const RepositoryFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  entity: ArtifactIdSchema,
  datasource: ArtifactIdSchema,
  table: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  operations: z.array(z.enum(REPOSITORY_OPERATIONS)).min(1),
  finders: z.array(z.object({ by: ArtifactIdSchema })).optional(),
  list: z.object({ orderBy: z.array(OrderSchema) }).optional(),
  /** REST data sources: `list` (paging, items path), `fieldMap`, and the endpoint of each other operation (defaults: GET, POST, PUT, DELETE). */
  // Declared in file order (list, paging, fieldMap first): the canonical form keeps the keys the way they are written.
  rest: z.looseObject({
    list: z.looseObject({}).optional(),
    paging: z.looseObject({}).optional(),
    fieldMap: z.record(z.string(), z.string()).optional(),
    get: RestEndpointSchema.optional(),
    create: RestEndpointSchema.optional(),
    update: RestEndpointSchema.optional(),
    delete: RestEndpointSchema.optional()
  }).superRefine((rest, context) => {
    // A lookup or write by key addresses one item: its path names the key exactly once.
    for (const op of ['get', 'update', 'delete'] as const) {
      const path = rest[op]?.path
      if (path !== undefined && path.split('/').filter(segment => segment === ':id').length !== 1) {
        context.addIssue({ code: 'custom', path: [op, 'path'], message: 'Use exactly one :id segment, like "/items/:id"' })
      }
    }
  }).optional(),
  expose: z.object({ list: z.boolean() }).optional()
})

export const ParamSchema = z.object({
  name: CamelNameSchema,
  type: z.enum(FIELD_TYPES),
  default: ValueSchema.optional(),
  reactive: z.boolean().optional(),
  from: z.enum(['route', 'body', 'query']).optional()
})

export const CONDITION_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'like'] as const

export const QueryFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  label: z.string().min(1),
  /** What the query returns, in words; becomes the composable's doc comment. */
  description: z.string().max(500).optional(),
  from: ArtifactIdSchema,
  params: z.array(ParamSchema),
  where: z.object({ op: z.enum(CONDITION_OPS), field: CamelNameSchema, value: ValueSchema }).optional(),
  orderBy: z.array(OrderSchema).optional(),
  limit: ValueSchema.optional(),
  result: z.enum(['one', 'many'])
})

export const ACTION_STEP_KINDS = ['validate', 'assert', 'load', 'return', 'repository', 'call', 'custom'] as const

export const ActionFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  label: z.string().min(1),
  /** The business rule in words; becomes the use-case's doc comment. */
  description: z.string().max(500).optional(),
  http: z.object({ method: z.enum(['POST', 'PATCH', 'PUT', 'DELETE']), path: z.string().regex(/^\/[\w\-/:]*$/) }),
  input: z.looseObject({ entity: ArtifactIdSchema.optional(), pick: z.array(CamelNameSchema).optional(), params: z.array(ParamSchema).optional() }),
  output: z.object({ entity: ArtifactIdSchema }).optional(),
  errors: z.array(z.object({
    type: z.string().regex(/^[a-z][a-z0-9_]*$/),
    status: z.int().min(400).max(599),
    message: z.string().min(1),
    data: z.record(CamelNameSchema, z.enum(FIELD_TYPES)).optional()
  })),
  steps: z.array(z.looseObject({ kind: z.enum(ACTION_STEP_KINDS) })).min(1),
  client: z.object({
    optimistic: z.looseObject({ kind: z.enum(['insert', 'update', 'delete']), entity: ArtifactIdSchema }).optional(),
    invalidates: z.array(ArtifactIdSchema)
  })
})

export const StateFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  label: z.string().min(1),
  persist: z.enum(['memory', 'session', 'localStorage']),
  shape: z.enum(['single', 'many']),
  fields: z.array(FieldSchema).min(1)
})

export const ComponentFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: PascalNameSchema,
  properties: z.array(PropertySchema),
  variants: z.array(z.object({
    id: ArtifactIdSchema,
    name: CamelNameSchema,
    /** Sparse, per node id: `unset` lists style keys the variant removes. */
    overrides: z.record(LocalIdSchema, z.object({
      props: z.record(z.string(), ValueSchema).optional(),
      style: z.record(z.string(), z.string()).optional(),
      unset: z.array(z.string()).optional()
    })),
    state: VariantStateSchema.optional(),
    interactions: z.array(VariantInteractionSchema).max(20).optional(),
    transition: TransitionSchema.optional()
  })),
  /** The primary variant's interactions; `transition` is the primary's and every variant's default. */
  interactions: z.array(VariantInteractionSchema).max(20).optional(),
  transition: TransitionSchema.optional(),
  root: ModelNodeSchema
})

export const PageFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use a kebab-case route name'),
  path: z.string().regex(/^\/[\w\-/:]*$/, 'Use a path like /posts/:slug'),
  layout: ArtifactIdSchema.optional(),
  /** The page's value per layout variable id; static, generated into `definePageMeta({ layoutValues })`. */
  layoutValues: z.record(ArtifactIdSchema, ValueSchema).optional(),
  params: z.array(z.object({ name: CamelNameSchema, validate: z.object({ field: ArtifactIdSchema }).optional() })).optional(),
  seo: z.object({ title: ValueSchema.optional(), description: ValueSchema.optional() }).optional(),
  uses: z.object({
    state: z.array(z.object({ as: CamelNameSchema, state: ArtifactIdSchema })).optional(),
    queries: z.array(z.object({ as: CamelNameSchema, query: ArtifactIdSchema, args: z.record(CamelNameSchema, ValueSchema).optional() })).optional(),
    /** Queries of API data sources (`kind: "api"`): the source, the query by name, and the values of its parameters. Read as `data`, `<as>Loading` and `<as>Error`. */
    apis: z.array(z.object({ as: CamelNameSchema, datasource: ArtifactIdSchema, query: CamelNameSchema, args: z.record(CamelNameSchema, ValueSchema).optional() })).optional(),
    actions: z.array(z.object({ as: CamelNameSchema, action: ArtifactIdSchema })).optional(),
    computed: z.array(z.looseObject({ as: CamelNameSchema })).optional()
  }).optional(),
  root: ModelNodeSchema
})

export const FixturesFileSchema = z.object({
  ...schemaField,
  entity: ArtifactIdSchema,
  rows: z.array(z.record(z.string(), ValueSchema))
})

export type ProjectFile = z.infer<typeof ProjectFileSchema>
export type ThemeFile = z.infer<typeof ThemeFileSchema>
export type DataSourceFile = z.infer<typeof DataSourceFileSchema>
export type LayoutFile = z.infer<typeof LayoutFileSchema>
export type ManifestFile = z.infer<typeof ManifestFileSchema>
export type ModuleFile = z.infer<typeof ModuleFileSchema>
export type EntityFile = z.infer<typeof EntityFileSchema>
export type RepositoryFile = z.infer<typeof RepositoryFileSchema>
export type QueryFile = z.infer<typeof QueryFileSchema>
export type ActionFile = z.infer<typeof ActionFileSchema>
export type StateFile = z.infer<typeof StateFileSchema>
export type ComponentFile = z.infer<typeof ComponentFileSchema>
export type PropertyDef = z.infer<typeof PropertySchema>
export type Transition = z.infer<typeof TransitionSchema>
export type PageFile = z.infer<typeof PageFileSchema>
export type FixturesFile = z.infer<typeof FixturesFileSchema>
