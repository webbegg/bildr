import type { DataSourceFile, EntityFile, Model, ModuleModel, PageFile, RepositoryFile } from '@bildr/codegen/model'
import type { Row } from '@bildr/codegen/query'

/**
 * What the Data view reads of the model (U7). The hosted editor's `Collection` and
 * `Connection` (`#shared/document/schema`) become a read-only view over the model's files:
 * a collection is an entity with its repository and data source, a connection is a `rest`
 * data source. Nothing here is stored: the view is rebuilt from the model on each change,
 * and every write is a module action (`entity_*`, `datasource_*`).
 *
 * Not in the module: records. Rows are app data reached through the generated API (E2); the
 * Data view shows the entity's fixtures, or what the app's list route answers.
 */

export type FieldType = EntityFile['fields'][number]['type']
export type DataSourceKind = DataSourceFile['kind']
export type EndpointOperation = RepositoryFile['operations'][number]

/** The operations in the order the panel lists them. */
export const ENDPOINT_OPERATIONS: readonly EndpointOperation[] = ['list', 'get', 'create', 'update', 'delete']
export const OPERATION_LABELS: Record<EndpointOperation, string> = { list: 'List', get: 'Get', create: 'Create', update: 'Update', delete: 'Delete' }
export type EndpointMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
/** The verb an endpoint has when the repository doesn't say (the generated adapter's). */
const DEFAULT_METHODS: Record<EndpointOperation, EndpointMethod> = { list: 'GET', get: 'GET', create: 'POST', update: 'PUT', delete: 'DELETE' }

export interface DataField {
  id: string
  name: string
  /** `name` spaced out: the model has no labels, so the Data view reads one from the name. */
  label: string
  type: FieldType
  required: boolean
  /** Set by the app, not a client: its sample values can't be edited. */
  readonly?: boolean
  /** REST entities: the key of the field in the API's items. */
  remote?: string
}

export interface DataEndpoint {
  op: EndpointOperation
  method: EndpointMethod
  path: string
  /** List: the top-level key that holds the items, and the one with the total. */
  itemsPath?: string
  totalPath?: string
}

/** The paging the generated REST adapter uses (only offset paging is generated). */
export interface DataPaging {
  style: string
  limitParam?: string
  offsetParam?: string
}

/** The hosted `Collection`: an entity with the repository and data source it is stored in. */
export interface DataCollection {
  id: string
  name: string
  plural: string
  /** The module folder it lives in. */
  module: string
  fields: DataField[]
  kind: DataSourceKind
  datasource: string
  datasourceName: string
  repository: string | undefined
  operations: readonly EndpointOperation[]
  /** Whether its list reaches the app (`repository.expose.list`): the hosted `publicRead`. */
  exposed: boolean
  /** The action that creates a row (the hosted `publicCreate`), when there is one. */
  createAction: string | undefined
  endpoints: DataEndpoint[]
  paging: DataPaging | undefined
}

/** The hosted `Connection`: a REST data source. */
export interface DataConnection {
  id: string
  name: string
  baseUrl: string
  /** The env var that overrides the base URL at runtime. */
  baseUrlEnv: string | undefined
  auth: { type: 'bearer' | 'header', secret: string, header?: string, env: string | undefined } | undefined
}

/** A new connection's base URL until it is set in the right panel (a data source needs one). */
export const NEW_CONNECTION_URL = 'https://api.example.com'

export const fieldLabel = (name: string): string => {
  const words = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  integer: 'Integer',
  number: 'Number',
  boolean: 'Toggle',
  datetime: 'Date & time',
  date: 'Date',
  image: 'Image',
  uuid: 'UUID'
}

export const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  text: 'i-lucide-type',
  integer: 'i-lucide-binary',
  number: 'i-lucide-hash',
  boolean: 'i-lucide-toggle-left',
  datetime: 'i-lucide-calendar-clock',
  date: 'i-lucide-calendar',
  image: 'i-lucide-image',
  uuid: 'i-lucide-fingerprint'
}

export const fieldTypeItems = (Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map(type => ({ label: FIELD_TYPE_LABELS[type], value: type, icon: FIELD_TYPE_ICONS[type] }))

type RestConfig = {
  list?: { method?: EndpointMethod, path: string, itemsPath?: string, totalPath?: string }
  paging?: DataPaging
  fieldMap?: Record<string, string>
} & Partial<Record<'get' | 'create' | 'update' | 'delete', { method?: EndpointMethod, path: string }>>

const endpointsOf = (repository: RepositoryFile | undefined): DataEndpoint[] => {
  const rest = repository?.rest as RestConfig | undefined
  if (!repository || !rest) return []
  return ENDPOINT_OPERATIONS.flatMap((op): DataEndpoint[] => {
    const endpoint = rest[op]
    if (!endpoint || !repository.operations.includes(op)) return []
    const list = op === 'list' ? rest.list : undefined
    return [{
      op,
      method: endpoint.method ?? DEFAULT_METHODS[op],
      path: endpoint.path,
      ...(list?.itemsPath ? { itemsPath: list.itemsPath } : {}),
      ...(list?.totalPath ? { totalPath: list.totalPath } : {})
    }]
  })
}

const collectionOf = (model: Model, folder: string, mod: ModuleModel, entity: EntityFile): DataCollection => {
  const repository = mod.repositories.find(entry => entry.entity === entity.id)
  const source = model.datasources.find(entry => entry.id === repository?.datasource)
  const rest = repository?.rest as RestConfig | undefined
  const remote = source?.kind === 'rest'
  const createAction = repository
    ? mod.actions.find(action => action.input.entity === entity.id && action.steps.some(step => step.repository === repository.id && step.op === 'create'))?.id
    : undefined
  return {
    id: entity.id,
    name: entity.name,
    plural: entity.plural,
    module: folder,
    fields: entity.fields.map(field => ({
      id: field.id,
      name: field.name,
      label: fieldLabel(field.name),
      type: field.type,
      required: field.required === true,
      readonly: field.readonly === true,
      ...(remote ? { remote: rest?.fieldMap?.[field.name] ?? field.name } : {})
    })),
    kind: source?.kind ?? 'memory',
    datasource: repository?.datasource ?? '',
    datasourceName: source?.name ?? '',
    repository: repository?.id,
    operations: repository?.operations ?? [],
    exposed: repository?.expose?.list === true,
    createAction,
    endpoints: endpointsOf(repository),
    paging: rest?.paging
  }
}

/** Every entity of the model, by module, as the Data view's collections. */
export const collectionsOf = (model: Model): DataCollection[] =>
  Object.entries(model.modules).flatMap(([folder, mod]) => mod.entities.map(entity => collectionOf(model, folder, mod, entity)))

/** The REST data sources, as the Data view's connections. */
export const connectionsOf = (model: Model): DataConnection[] =>
  model.datasources.filter(source => source.kind === 'rest').map(source => ({
    id: source.id,
    name: source.name,
    baseUrl: source.defaults?.baseUrl ?? '',
    baseUrlEnv: source.env.baseUrl,
    auth: source.auth ? { type: source.auth.type, secret: source.auth.secret, ...(source.auth.header ? { header: source.auth.header } : {}), env: source.env[source.auth.secret] } : undefined
  }))

/** A query or an action as the Data tree lists it: its label (the name when it has none) and the collection it works on. */
export interface DataArtifact {
  id: string
  name: string
  label: string
  module: string
  /** The entity it reads (a query) or works on (an action: its input's, else its output's, else the one its steps write), `''` when none. */
  collectionId: string
  collectionName: string
}

/** The entity with this id, in whichever module has it. */
export const entityById = (model: Model, entityId: string): EntityFile | undefined =>
  Object.values(model.modules).flatMap(mod => mod.entities).find(entity => entity.id === entityId)

/** The id of the entity a repository stores (`repository.entity`), or undefined when there is no such repository. */
export const repositoryEntity = (model: Model, repositoryId: string): string | undefined =>
  Object.values(model.modules).flatMap(mod => mod.repositories).find(repository => repository.id === repositoryId)?.entity

/** The queries of the model, module by module, as the Data tree lists them. */
export const queriesOf = (model: Model): DataArtifact[] =>
  Object.entries(model.modules).flatMap(([module, mod]) => mod.queries.map(query => ({
    id: query.id,
    name: query.name,
    label: query.label || query.name,
    module,
    collectionId: query.from,
    collectionName: entityById(model, query.from)?.name ?? ''
  })))

/** The actions of the model, module by module, as the Data tree lists them. */
export const actionsOf = (model: Model): DataArtifact[] =>
  Object.entries(model.modules).flatMap(([module, mod]) => mod.actions.map((action) => {
    const written = action.steps.map(step => typeof step.repository === 'string' ? repositoryEntity(model, step.repository) : undefined).find(entity => entity !== undefined)
    const collectionId = action.input.entity ?? action.output?.entity ?? written ?? ''
    return { id: action.id, name: action.name, label: action.label || action.name, module, collectionId, collectionName: entityById(model, collectionId)?.name ?? '' }
  }))

/** The rows an entity's fixtures file holds: what the Data view shows when the app can't answer. */
export const fixtureRowsOf = (model: Model, entityId: string): Row[] =>
  Object.values(model.modules).flatMap(mod => mod.fixtures).find(fixtures => fixtures.entity === entityId)?.rows ?? []

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The pages that show one row of an entity: a route parameter picks it through a query the page uses. */
export const detailPagesOf = (model: Model, entityId: string): PageFile[] => {
  const modules = Object.values(model.modules)
  const queries = modules.flatMap(mod => mod.queries)
  return modules.flatMap(mod => mod.pages).filter(page => !!page.params?.length && (page.uses?.queries ?? []).some(use =>
    queries.find(query => query.id === use.query)?.from === entityId && Object.values(use.args ?? {}).some(value => isRecord(value) && typeof value.$route === 'string')))
}

const mentions = (value: unknown, ids: ReadonlySet<string>): boolean => {
  if (typeof value === 'string') return ids.has(value)
  if (Array.isArray(value)) return value.some(entry => mentions(entry, ids))
  return isRecord(value) && Object.values(value).some(entry => mentions(entry, ids))
}

/**
 * The pages that use an entity: they mention it, one of its fields, or a query or action over it, in
 * their uses, params or nodes. The module refuses `entity_delete` for these (and more); this is the
 * check made before anything is deleted, so a delete of several entities does not stop partway.
 */
export const pagesUsingEntity = (model: Model, entityId: string): PageFile[] => {
  const modules = Object.values(model.modules)
  const entity = modules.flatMap(mod => mod.entities).find(entry => entry.id === entityId)
  if (!entity) return []
  const repositories = modules.flatMap(mod => mod.repositories).filter(repository => repository.entity === entityId).map(repository => repository.id)
  const ids = new Set([
    entityId,
    ...entity.fields.map(field => field.id),
    ...modules.flatMap(mod => mod.queries).filter(query => query.from === entityId).map(query => query.id),
    ...modules.flatMap(mod => mod.actions).filter(action => action.input.entity === entityId || action.steps.some(step => typeof step.repository === 'string' && repositories.includes(step.repository))).map(action => action.id)
  ])
  return modules.flatMap(mod => mod.pages).filter(page => mentions(page, ids))
}

const words = (text: string): string[] => text.split(/[^A-Za-z0-9]+/).filter(Boolean)
const pascal = (list: string[]) => list.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')
const camel = (list: string[]) => list.map((word, index) => index ? word.charAt(0).toUpperCase() + word.slice(1) : word.charAt(0).toLowerCase() + word.slice(1)).join('')

/** The singular of a path's last word: `categories` → `category`, `posts` → `post`; a word that doesn't look plural stays. */
const singular = (word: string): string | undefined => {
  if (/[^aeiou]ies$/i.test(word)) return `${word.slice(0, -3)}y`
  if (word.length > 3 && /s$/i.test(word) && !/(ss|us|is)$/i.test(word)) return word.slice(0, -1)
  return undefined
}

/**
 * An entity proposed from the list path (`/blog-posts?limit=5` → `BlogPost`, plural `blogPosts`).
 * The plural is only given when the path is the plural of the name; entity names are singular.
 */
export const entityProposal = (path: string): { name: string, plural?: string } => {
  const segments = (path.split('?')[0] ?? '').split('/').filter(Boolean)
  const last = words(segments.at(-1) ?? '')
  if (!last.length) return { name: 'Item' }
  const one = singular(last.at(-1)!)
  if (!one) return { name: pascal(last) }
  return { name: pascal([...last.slice(0, -1), one]), plural: camel(last) }
}

/** An operation's REST default next to the list path (without its query), the key written `:id`. */
export const restDefaults = (operation: Exclude<EndpointOperation, 'list'>, listPath: string): { method: EndpointMethod, path: string } => {
  const base = `/${(listPath.split('?')[0] ?? '').replace(/^\/+|\/+$/g, '')}`
  const one = operation !== 'create'
  return { method: DEFAULT_METHODS[operation], path: one ? `${base === '/' ? '' : base}/:id` : base }
}

/** An endpoint path of the REST adapter: relative to the base URL, `:id` for the key (the schema's `RestEndpointSchema`). */
export const endpointPathProblem = (path: string): string | undefined => {
  if (!path.trim()) return 'Add a path, e.g. /posts'
  if (!/^\/[\w\-/:.]*$/.test(path)) return 'Use a path like /posts/:id, without a query or a full URL'
  if (path.split('/').some(segment => segment === '.' || segment === '..')) return 'Paths cannot contain . or .. segments'
  return undefined
}

/** A name for the data source of a URL's host (`dummyjson.com` → `dummyjson-com`): kebab-cased, starting with a letter, numbered while taken. */
export const sourceNameOf = (host: string, taken: readonly string[]): string => {
  const kebab = host.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const base = !kebab ? 'api' : /^[a-z]/.test(kebab) ? kebab : `api-${kebab}`
  let candidate = base
  for (let n = 2; taken.includes(candidate); n++) candidate = `${base}-${n}`
  return candidate
}
