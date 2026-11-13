import type { Json, JsonObject } from './types.ts'

/**
 * The artifact kinds the Model screen edits, their `.bildr/` paths and their
 * forms. The field lists and key orders mirror the zod shapes in
 * `@bildr/codegen/model` (`schemas.ts`); paths mirror `serialize.ts`.
 */

export type KindKey = 'datasource' | 'entity' | 'repository' | 'query' | 'action'
export type ModuleKind = Exclude<KindKey, 'datasource'>

export const SCHEMA_URL = 'https://bildr.dev/schema'
export const FIELD_TYPES = ['text', 'integer', 'number', 'boolean', 'datetime', 'date', 'image', 'uuid'] as const
export const REPOSITORY_OPERATIONS = ['list', 'get', 'create', 'update', 'delete'] as const

/** One input of a kind's form. `key` may be dotted (`http.method`) for a nested object. */
export type FormField
  = | { key: string, label: string, type: 'text' | 'textarea', optional?: boolean, placeholder?: string, hint?: string }
    | { key: string, label: string, type: 'number', optional?: boolean, hint?: string }
    | { key: string, label: string, type: 'switch', hint?: string }
    | { key: string, label: string, type: 'select', options: readonly string[] | 'entities' | 'datasources', optional?: boolean, hint?: string }
    | { key: string, label: string, type: 'multi', options: readonly string[], hint?: string }
    /** A sub-part too rich for inputs, edited as JSON. */
    | { key: string, label: string, type: 'json', optional?: boolean, hint?: string }
    /** The entity fields array editor. */
    | { key: string, label: string, type: 'fields' }

export interface KindSpec {
  key: KindKey
  /** The list heading. */
  label: string
  singular: string
  /** The `.bildr/modules/<m>/<folder>/` folder (data sources live in `.bildr/datasources/`). */
  folder: string
  /** Top-level keys in schema order: saved files keep this order. */
  order: readonly string[]
  fields: readonly FormField[]
  blank: () => JsonObject
}

const schema = (name: string) => `${SCHEMA_URL}/${name}.v1.json`

export const FIELD_ORDER = ['id', 'name', 'type', 'required', 'unique', 'nullable', 'readonly', 'default', 'min', 'max', 'pattern', 'patternMessage'] as const

export const KINDS: Record<KindKey, KindSpec> = {
  datasource: {
    key: 'datasource',
    label: 'Data sources',
    singular: 'data source',
    folder: 'datasources',
    order: ['$schema', 'id', 'name', 'kind', 'env', 'defaults', 'auth'],
    fields: [
      { key: 'id', label: 'Id', type: 'text', placeholder: 'ds_main' },
      { key: 'name', label: 'Name', type: 'text', placeholder: 'main', hint: 'kebab-case' },
      { key: 'kind', label: 'Kind', type: 'select', options: ['sqlite', 'rest'] },
      { key: 'env', label: 'Env vars', type: 'json', hint: 'Setting name → env var, like {"url": "NUXT_DB_URL"}' },
      { key: 'defaults', label: 'Defaults', type: 'json', optional: true, hint: 'Non-secret defaults; never put secrets here' },
      { key: 'auth', label: 'Auth', type: 'json', optional: true, hint: '{"type": "bearer", "secret": "apiKey"}' }
    ],
    blank: () => ({ $schema: schema('datasource'), id: '', name: '', kind: 'sqlite', env: {} })
  },
  entity: {
    key: 'entity',
    label: 'Entities',
    singular: 'entity',
    folder: 'entities',
    order: ['$schema', 'id', 'name', 'plural', 'idStrategy', 'timestamps', 'fields', 'relations', 'client'],
    fields: [
      { key: 'id', label: 'Id', type: 'text', placeholder: 'ent_post' },
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Post', hint: 'PascalCase' },
      { key: 'plural', label: 'Plural', type: 'text', placeholder: 'posts', hint: 'camelCase' },
      { key: 'idStrategy', label: 'Id strategy', type: 'select', options: ['uuid', 'external'] },
      { key: 'timestamps', label: 'Timestamps', type: 'switch', hint: 'createdAt and updatedAt' },
      { key: 'fields', label: 'Fields', type: 'fields' },
      { key: 'relations', label: 'Relations', type: 'json', hint: '[{"name": "author", "to": "ent_user", "kind": "one"}]' },
      { key: 'client.sync', label: 'Client sync', type: 'select', options: ['eager', 'on-demand'] },
      { key: 'client.limit', label: 'Client limit', type: 'number', optional: true, hint: 'Rows an eager collection loads (1–500)' }
    ],
    blank: () => ({
      $schema: schema('entity'),
      id: '',
      name: '',
      plural: '',
      idStrategy: 'uuid',
      timestamps: true,
      fields: [{ id: 'fld_name', name: 'name', type: 'text', required: true }],
      relations: [],
      client: { sync: 'eager' }
    })
  },
  repository: {
    key: 'repository',
    label: 'Repositories',
    singular: 'repository',
    folder: 'repositories',
    order: ['$schema', 'id', 'entity', 'datasource', 'table', 'operations', 'finders', 'list', 'rest', 'expose'],
    fields: [
      { key: 'id', label: 'Id', type: 'text', placeholder: 'repo_post' },
      { key: 'entity', label: 'Entity', type: 'select', options: 'entities' },
      { key: 'datasource', label: 'Data source', type: 'select', options: 'datasources' },
      { key: 'table', label: 'Table', type: 'text', optional: true, placeholder: 'blog_posts' },
      { key: 'operations', label: 'Operations', type: 'multi', options: REPOSITORY_OPERATIONS },
      { key: 'finders', label: 'Finders', type: 'json', optional: true, hint: '[{"by": "fld_slug"}]' },
      { key: 'list', label: 'List', type: 'json', optional: true, hint: '{"orderBy": [{"field": "createdAt", "direction": "desc"}]}' },
      { key: 'rest', label: 'REST mapping', type: 'json', optional: true },
      { key: 'expose', label: 'Expose', type: 'json', optional: true, hint: '{"list": true}' }
    ],
    blank: () => ({ $schema: schema('repository'), id: '', entity: '', datasource: '', operations: [...REPOSITORY_OPERATIONS] })
  },
  query: {
    key: 'query',
    label: 'Queries',
    singular: 'query',
    folder: 'queries',
    order: ['$schema', 'id', 'name', 'label', 'description', 'from', 'params', 'where', 'orderBy', 'limit', 'result'],
    fields: [
      { key: 'id', label: 'Id', type: 'text', placeholder: 'q_featured_posts' },
      { key: 'name', label: 'Name', type: 'text', placeholder: 'featuredPosts', hint: 'camelCase' },
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea', optional: true },
      { key: 'from', label: 'From entity', type: 'select', options: 'entities' },
      { key: 'result', label: 'Result', type: 'select', options: ['one', 'many'] },
      { key: 'params', label: 'Params', type: 'json', hint: '[{"name": "limit", "type": "integer", "default": 6}]' },
      { key: 'where', label: 'Where', type: 'json', optional: true, hint: '{"op": "eq", "field": "published", "value": true}' },
      { key: 'orderBy', label: 'Order by', type: 'json', optional: true },
      { key: 'limit', label: 'Limit', type: 'json', optional: true, hint: '10 or {"$param": "limit"}' }
    ],
    blank: () => ({ $schema: schema('query'), id: '', name: '', label: '', from: '', params: [], result: 'many' })
  },
  action: {
    key: 'action',
    label: 'Actions',
    singular: 'action',
    folder: 'actions',
    order: ['$schema', 'id', 'name', 'label', 'description', 'http', 'input', 'output', 'errors', 'steps', 'client'],
    fields: [
      { key: 'id', label: 'Id', type: 'text', placeholder: 'act_create_post' },
      { key: 'name', label: 'Name', type: 'text', placeholder: 'createPost', hint: 'camelCase' },
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea', optional: true },
      { key: 'http.method', label: 'HTTP method', type: 'select', options: ['POST', 'PATCH', 'PUT', 'DELETE'] },
      { key: 'http.path', label: 'HTTP path', type: 'text', placeholder: '/posts' },
      { key: 'input', label: 'Input', type: 'json', hint: '{"entity": "ent_post", "pick": ["title"]}' },
      { key: 'output', label: 'Output', type: 'json', optional: true, hint: '{"entity": "ent_post"}' },
      { key: 'errors', label: 'Errors', type: 'json' },
      { key: 'steps', label: 'Steps', type: 'json', hint: '[{"kind": "validate"}, …]' },
      { key: 'client', label: 'Client', type: 'json', hint: '{"invalidates": ["ent_post"]}' }
    ],
    blank: () => ({
      $schema: schema('action'),
      id: '',
      name: '',
      label: '',
      http: { method: 'POST', path: '/' },
      input: {},
      errors: [],
      steps: [{ kind: 'validate' }],
      client: { invalidates: [] }
    })
  }
}

export const MODULE_KINDS: readonly ModuleKind[] = ['entity', 'repository', 'query', 'action']

/** The file name part `serialize.ts` derives from a name: `BlogNote` → `blog-note`. */
export const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()

/** Where a new artifact is written, as `serializeModel` would place it. */
export const newArtifactPath = (kind: KindKey, draft: JsonObject, module?: string): string | undefined => {
  const name = typeof draft.name === 'string' && draft.name ? draft.name : undefined
  if (kind === 'datasource') return name ? `.bildr/datasources/${name}.json` : undefined
  const base = name ?? (typeof draft.id === 'string' && draft.id ? draft.id : undefined)
  if (!module || !base) return undefined
  return `.bildr/modules/${module}/${KINDS[kind].folder}/${kebab(base)}.json`
}

export interface ArtifactRef {
  path: string
  kind: KindKey
  /** The module folder; none for data sources. */
  module?: string
}

const FOLDER_KINDS: Record<string, ModuleKind> = { entities: 'entity', repositories: 'repository', queries: 'query', actions: 'action' }

/** Which artifact a `.bildr/` path holds, for the kinds the Model screen edits. */
export const classifyPath = (path: string): ArtifactRef | undefined => {
  if (/^\.bildr\/datasources\/[^/]+\.json$/.test(path)) return { path, kind: 'datasource' }
  const match = /^\.bildr\/modules\/([^/]+)\/([^/]+)\/[^/]+\.json$/.exec(path)
  const kind = match ? FOLDER_KINDS[match[2]!] : undefined
  return match && kind ? { path, kind, module: match[1]! } : undefined
}

/** The module folders a path list mentions. */
export const moduleFolders = (paths: Iterable<string>): string[] => {
  const folders = new Set<string>()
  for (const path of paths) {
    const match = /^\.bildr\/modules\/([^/]+)\//.exec(path)
    if (match) folders.add(match[1]!)
  }
  return [...folders]
}

export const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

export const getAt = (target: JsonObject, key: string): Json | undefined => {
  let value: Json | undefined = target
  for (const part of key.split('.')) {
    if (!isObject(value)) return undefined
    value = value[part]
  }
  return value
}

/** Sets (or, for `undefined`, removes) a possibly dotted key, creating parent objects. */
export const setAt = (target: JsonObject, key: string, value: Json | undefined) => {
  const parts = key.split('.')
  let parent = target
  for (const part of parts.slice(0, -1)) {
    if (!isObject(parent[part])) parent[part] = {}
    parent = parent[part] as JsonObject
  }
  const leaf = parts.at(-1)!
  if (value === undefined) Reflect.deleteProperty(parent, leaf)
  else parent[leaf] = value
}

const ordered = (value: JsonObject, order: readonly string[]): JsonObject => {
  const keys = [...order.filter(key => key in value), ...Object.keys(value).filter(key => !order.includes(key))]
  return Object.fromEntries(keys.map(key => [key, value[key]!]))
}

/** The artifact with its keys (and its entity fields' keys) in schema order, so a save never reorders a file. */
export const canonical = (kind: KindKey, value: JsonObject): JsonObject => {
  const result = ordered(value, KINDS[kind].order)
  if (kind === 'entity' && Array.isArray(result.fields)) {
    result.fields = result.fields.map(field => isObject(field) ? ordered(field, FIELD_ORDER) : field)
  }
  return result
}

/** The canonical text of a model file (`stringifyModelFile`): two-space JSON plus a trailing newline. */
export const stringifyModelFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** A short label for an artifact in a list. */
export const artifactLabel = (file: Json | undefined, path: string): string => {
  if (isObject(file)) {
    for (const key of ['name', 'label', 'id']) {
      const value = file[key]
      if (typeof value === 'string' && value) return value
    }
  }
  return path.split('/').at(-1)!.replace(/\.json$/, '')
}
