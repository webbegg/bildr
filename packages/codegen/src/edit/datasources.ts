import { z } from 'zod'
import type { Model } from '../model/load.ts'
import { ArtifactIdSchema, CamelNameSchema, DATASOURCE_KINDS, EnvNameSchema } from '../model/schemas.ts'
import type { DataSourceFile } from '../model/schemas.ts'
import { DATABASE_DEPENDENCIES } from '../starter/starter.ts'
import { camel, defineEdit, fail, kebab, snake } from './core.ts'
import type { Draft } from './core.ts'

/**
 * Data sources (`.bildr/datasources/<name>.json`, P3c): where repositories read and
 * write. The hosted connections become `rest` sources. Secrets never live in the model:
 * a setting holds a non-secret default or the name of the env var with its value, and
 * the auth secret is always an env var (the user edits `.env`, `env_status` says what's set).
 */

export const DataSourceRef = ArtifactIdSchema.describe('A data source id, e.g. "ds_api"')

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/
const AuthInput = z.object({
  type: z.enum(['bearer', 'header']).describe('bearer: "Authorization: Bearer <secret>"; header: "<header>: <secret>"'),
  secret: CamelNameSchema.optional().describe('The setting that holds the secret (default "apiKey"); its value comes from its env var only'),
  header: z.string().regex(HEADER_NAME, 'Use a header name like "X-Api-Key"').optional().describe('The header name, for type "header"')
})
const SettingsInput = z.record(CamelNameSchema, z.string().max(2000))
const EnvInput = z.record(CamelNameSchema, EnvNameSchema)

export const datasourceById = (draft: Draft, id: string): DataSourceFile =>
  draft.model.datasources.find(source => source.id === id) ?? fail('not_found', `No data source "${id}"`)

/** `NUXT_DATASOURCES_<NAME>_<SETTING>`: the env var Nuxt maps onto `runtimeConfig.datasources.<name>.<setting>`. */
const envNameOf = (source: string, setting: string) => `NUXT_DATASOURCES_${snake(camel(source)).toUpperCase()}_${snake(setting).toUpperCase()}`

const urlProblem = (value: string): string | undefined => {
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

const sourceName = (draft: Draft, given: string, except?: string): string => {
  const name = kebab(given)
  if (!/^[a-z][a-z0-9-]*$/.test(name)) fail('invalid', `"${given}" can't be a data source name: start with a letter, like "api"`)
  const other = draft.model.datasources.find(source => source.name === name && source.id !== except)
  if (other) fail('invalid', `A data source is already named "${name}" (${other.id})`)
  // Names become runtimeConfig keys (camelCase): two names with one key would share their settings.
  const clash = draft.model.datasources.find(source => source.id !== except && camel(source.name) === camel(name))
  if (clash) fail('invalid', `"${name}" and "${clash.name}" would share their runtime settings (datasources.${camel(name)}): pick another name`)
  return name
}

/**
 * Checks a REST source's settings and fills in what follows from them: every setting
 * gets an env var (`NUXT_DATASOURCES_…`), and the auth secret gets one but never a default.
 */
const settleRest = (source: DataSourceFile) => {
  const env = { ...source.env }
  const defaults = { ...source.defaults }
  for (const setting of new Set(['baseUrl', ...Object.keys(defaults), ...(source.auth ? [source.auth.secret] : [])])) {
    env[setting] ??= envNameOf(source.name, setting)
  }
  if (defaults.baseUrl !== undefined) {
    const problem = urlProblem(defaults.baseUrl)
    if (problem) fail('invalid', problem)
  }
  if (source.auth) {
    if (source.auth.secret in defaults) fail('invalid', `"${source.auth.secret}" is a secret: set it with ${env[source.auth.secret]} in .env, never in the model`)
    if (source.auth.type === 'header' && !source.auth.header) fail('invalid', 'A "header" auth needs the header name, like "X-Api-Key"')
    if (source.auth.type === 'bearer' && source.auth.header) fail('invalid', 'A "bearer" auth sends "Authorization: Bearer …": it takes no header name')
  }
  source.env = env
  if (Object.keys(defaults).length) source.defaults = defaults
  else delete source.defaults
}

const hasSqlite = (draft: Draft, except?: string) => draft.model.datasources.find(source => source.kind === 'sqlite' && source.id !== except)

export const datasourceCreate = defineEdit({
  input: z.object({
    name: z.string().min(1).max(60).describe('Kebab-cased into its name, e.g. "Billing API" → "billing-api"; the id is ds_<name>'),
    kind: z.enum(DATASOURCE_KINDS).describe('rest: a JSON API (baseUrl, auth); memory: rows in the server process, seeded from fixtures, never persisted; sqlite: the app database (at most one)'),
    defaults: SettingsInput.optional().describe('Non-secret settings, e.g. { "baseUrl": "https://api.example.com/v1" } (rest) or { "url": "file:.data/app.db" } (sqlite)'),
    env: EnvInput.optional().describe('Setting → the env var that holds its value at runtime (default NUXT_DATASOURCES_<NAME>_<SETTING>)'),
    auth: AuthInput.optional()
  }),
  apply: (draft, { name: given, kind, defaults, env, auth }) => {
    const name = sourceName(draft, given)
    let source: DataSourceFile
    if (kind === 'memory') {
      if (defaults || env || auth) fail('invalid', 'A memory data source keeps its rows in the server process: it has no settings')
      source = { id: '', name, kind, env: {} }
    } else if (kind === 'sqlite') {
      const database = hasSqlite(draft)
      if (database) fail('invalid', `The project already has its app database (${database.id}): a project has at most one sqlite data source`)
      if (auth) fail('invalid', 'The app database takes no auth')
      source = { id: '', name, kind, env: { url: 'NUXT_DB_URL', ...env }, defaults: { url: 'file:.data/app.db', ...defaults } }
    } else {
      source = { id: '', name, kind, env: env ?? {}, ...(defaults ? { defaults } : {}), ...(auth ? { auth: { ...auth, secret: auth.secret ?? 'apiKey' } } : {}) }
      settleRest(source)
    }
    source.id = draft.mint('ds', name)
    draft.model.datasources.push(source)
    const filePath = draft.place(source.id, '.bildr/datasources', name)
    // The database layer is generated from now on; package.json is the user's, so its dependencies are added by hand.
    const database = kind === 'sqlite'
    return { datasourceId: source.id, filePath, database, ...(database ? { packageJson: DATABASE_DEPENDENCIES } : {}) }
  }
})

const Patch = <T extends z.ZodType>(value: T) => z.record(CamelNameSchema, value.nullable())

export const datasourceUpdate = defineEdit({
  input: z.object({
    datasource: DataSourceRef,
    name: z.string().min(1).max(60).optional().describe('A new name (kebab-cased); its file keeps its path. The env var names it gave stay as they are'),
    defaults: Patch(z.string().max(2000)).optional().describe('Settings to set; null removes one'),
    env: Patch(EnvNameSchema).optional().describe('Setting → env var to set; null removes one (a setting in use gets its default env var back)'),
    auth: AuthInput.nullable().optional().describe('The auth, or null for none')
  }),
  apply: (draft, { datasource: id, name, defaults, env, auth }) => {
    const source = datasourceById(draft, id)
    if (name !== undefined) source.name = sourceName(draft, name, id)
    if (source.kind === 'memory' && (defaults || env || auth)) fail('invalid', 'A memory data source keeps its rows in the server process: it has no settings')
    if (source.kind === 'sqlite' && auth) fail('invalid', 'The app database takes no auth')
    const merge = (current: Record<string, string> | undefined, patch: Record<string, string | null>) => {
      const next = { ...current }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) Reflect.deleteProperty(next, key)
        else next[key] = value
      }
      return next
    }
    if (defaults) {
      const next = merge(source.defaults, defaults)
      if (Object.keys(next).length) source.defaults = next
      else delete source.defaults
    }
    if (env) source.env = merge(source.env, env)
    if (auth === null) delete source.auth
    else if (auth) source.auth = { ...auth, secret: auth.secret ?? source.auth?.secret ?? 'apiKey' }
    if (source.kind === 'rest') settleRest(source)
    if (source.kind === 'sqlite' && !source.env.url) fail('invalid', 'The app database needs the env var of its url')
    return {}
  }
})

export const datasourceDelete = defineEdit({
  input: z.object({ datasource: DataSourceRef }),
  apply: (draft, { datasource: id }) => {
    const source = datasourceById(draft, id)
    const users = Object.values(draft.model.modules).flatMap(mod => mod.repositories.filter(repository => repository.datasource === id).map(repository => repository.id))
    if (users.length) {
      fail('forbidden', `Data source "${source.name}" is used by ${users.length === 1 ? 'the repository' : 'the repositories'} ${users.join(', ')}. Delete their entities (entity_delete) first`)
    }
    draft.model.datasources.splice(draft.model.datasources.indexOf(source), 1)
    // Without a sqlite data source the project has no app database (V7): its layer is no longer generated.
    return { database: !!hasSqlite(draft) }
  }
})

/** One env var a data source reads at runtime. */
export interface DataSourceEnvVar {
  name: string
  datasource: string
  setting: string
  /** The auth secret: its value never has a default in the model. */
  secret: boolean
  /** The model's non-secret default, used when the env var isn't set. */
  hasDefault: boolean
}

/** The env vars the data sources read, in data source and setting order. */
export const datasourceEnvVars = (model: Pick<Model, 'datasources'>): DataSourceEnvVar[] => model.datasources.flatMap(source =>
  Object.entries(source.env).map(([setting, name]) => ({
    name,
    datasource: source.id,
    setting,
    secret: source.auth?.secret === setting,
    hasDefault: source.defaults?.[setting] !== undefined
  })))
