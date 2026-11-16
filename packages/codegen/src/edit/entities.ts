import { z } from 'zod'
import { ArtifactIdSchema, FIELD_TYPES, ModuleNameSchema, REST_METHODS, RestEndpointSchema } from '../model/schemas.ts'
import type { ActionFile, EntityFile, FieldSchema, FixturesFile, QueryFile, RepositoryFile, Value } from '../model/schemas.ts'
import { camel, defineEdit, fail, kebab, pascal, uniqueName } from './core.ts'
import type { Draft } from './core.ts'
import { datasourceById, DataSourceRef } from './datasources.ts'
import { walk } from './tree.ts'
import { idUses, mentions, useLabels } from './usage.ts'

/**
 * Entities (P3c; the hosted collections and fields). One `entity_create` writes the entity
 * with everything a page needs to show and add its rows: the repository over its data
 * source, the queries `q_<plural>` (many) and `q_<entity>_by_id` (one), the action
 * `act_create_<entity>`, and for a memory source the fixtures it starts with. Deleting an
 * entity takes them along, and is refused while pages or components use them.
 */

type Field = z.infer<typeof FieldSchema>
type Op = RepositoryFile['operations'][number]

export const EntityRef = ArtifactIdSchema.describe('An entity id, e.g. "ent_post"')
export const FieldRef = ArtifactIdSchema.describe('A field id of the entity, e.g. "fld_title"')

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const FieldName = z.string().min(1).max(60).describe('camelCased, e.g. "Published at" → "publishedAt"')
const RemoteKey = z.string().min(1).max(100).describe('REST sources: the key of the field in the API\'s items, when it differs, e.g. "avatar_url"')

const FieldInput = z.object({
  name: FieldName,
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  remote: RemoteKey.optional()
})

const Endpoint = z.object({ path: RestEndpointSchema.shape.path, method: z.enum(REST_METHODS).optional() })
const EndpointsInput = z.object({
  list: z.object({
    path: RestEndpointSchema.shape.path,
    itemsPath: z.string().regex(IDENTIFIER, 'Use the top-level key that holds the items, like "items"').describe('The top-level key holding the items (datasource_preview finds it)'),
    totalPath: z.string().regex(IDENTIFIER, 'Use a top-level key, like "total"').optional()
  }).optional(),
  get: Endpoint.optional(),
  create: Endpoint.optional(),
  update: Endpoint.optional(),
  delete: Endpoint.optional()
}).describe('REST sources: the endpoint of each operation the API has, e.g. { "list": { "path": "/posts", "itemsPath": "items" }, "get": { "path": "/posts/:id" } }. Only these operations are generated')

// ── Lookups ──────────────────────────────────────────────────────────────

export const entityById = (draft: Draft, id: string): { entity: EntityFile, module: string } => {
  for (const [module, mod] of Object.entries(draft.model.modules)) {
    const entity = mod.entities.find(entry => entry.id === id)
    if (entity) return { entity, module }
  }
  return fail('not_found', `No entity "${id}"`)
}

export const repositoryOf = (draft: Draft, entityId: string) => Object.values(draft.model.modules)
  .flatMap(mod => mod.repositories).find(repository => repository.entity === entityId)

const fieldOf = (entity: EntityFile, id: string): Field => entity.fields.find(field => field.id === id) ?? fail('not_found', `Entity ${entity.name} has no field "${id}"`)

const queries = (draft: Draft) => Object.values(draft.model.modules).flatMap(mod => mod.queries)
const actions = (draft: Draft) => Object.values(draft.model.modules).flatMap(mod => mod.actions)

/** Where pages, components and layouts use one of `ids` (queries, actions, fields, the entity), as `file (where)`: the shared usage index, in words. */
const treeUsers = (draft: Draft, ids: Set<string>): string[] => useLabels(idUses(draft.model, ids))

const listOf = (users: string[]) => users.join(', ')

/** A route's segments, the way the generator makes its file: `/posts/` and `/posts` are one route. */
const segmentsOf = (path: string): string[] => path.split('/').filter(Boolean)

/**
 * Refuses a route another action of the module already answers: the same method and path (a trailing slash aside), or a
 * dynamic segment named differently at the same place (`/posts/:id` and `/posts/:slug` are two folders for one route).
 */
export const checkRouteFree = (moduleActions: ActionFile[], method: string, path: string, self?: string): void => {
  const mine = segmentsOf(path)
  for (const action of moduleActions) {
    if (action.id === self) continue
    const theirs = segmentsOf(action.http.path)
    if (action.http.method === method && theirs.length === mine.length && theirs.every((segment, index) => segment === mine[index])) fail('invalid', `The action ${action.id} already answers ${method} ${action.http.path}`)
    const at = mine.findIndex((segment, index) => segment !== theirs[index])
    if (at !== -1 && theirs[at] !== undefined && mine[at]!.startsWith(':') && theirs[at]!.startsWith(':')) fail('invalid', `The action ${action.id} (${action.http.path}) names the same part of the route "${theirs[at]}", not "${mine[at]}": use one name for both`)
  }
}

/**
 * What creating a row of `entity` is, for entity_create and action_create's "create" template: POST /<plural> validates
 * the body against the entity (its key included, which a client generates for a uuid), and the repository creates it;
 * a listed entity's client inserts it optimistically.
 */
export const createAction = (entity: EntityFile, repositoryId: string, listed: boolean, own: { id: string, name: string, label: string }): ActionFile => {
  // A read-only field isn't part of what a client sends, but the repository stores the whole row: the use-case fills it.
  const readonly = entity.fields.filter(field => field.readonly)
  const set: Record<string, Value> = {}
  for (const field of readonly) {
    const fill = field.default ?? (field.nullable ? null : undefined)
    if (fill === undefined) fail('invalid', `${entity.name} has a read-only field (${field.name}) with no default and no empty value, so a create can't fill it. Give it a default, or use blank and write the steps`)
    set[field.name] = fill!
  }
  return {
    ...own,
    http: { method: 'POST', path: `/${kebab(entity.plural)}` },
    input: { entity: entity.id, pick: [...(entity.idStrategy === 'external' ? [] : ['id']), ...entity.fields.filter(field => !field.readonly).map(field => field.name)] },
    output: { entity: entity.id },
    errors: [],
    steps: [{ kind: 'validate' }, { kind: 'repository', repository: repositoryId, op: 'create', ...(Object.keys(set).length ? { set } : {}) }],
    // Only a listed entity has the client collection an action invalidates.
    client: { ...(listed ? { optimistic: { kind: 'insert', entity: entity.id } } : {}), invalidates: listed ? [entity.id] : [] }
  }
}

// ── Names ────────────────────────────────────────────────────────────────

/** `note` → `notes`, `category` → `categories`, `box` → `boxes`. */
const pluralOf = (word: string) => /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`

/** `blogPosts` → `blog posts`. */
const spaced = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const fieldName = (given: string) => {
  const name = camel(given)
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) fail('invalid', `"${given}" can't be a field name: start with a letter, like "title"`)
  return name
}

/** The key the entity's queries and actions take: a uuid, or the type of the `id` field its source owns. */
export const keyType = (entity: EntityFile): Field['type'] => entity.idStrategy === 'uuid' ? 'uuid' : entity.fields.find(field => field.name === 'id')?.type ?? 'text'

// ── Values against field types ───────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/** Whether a stored value fits a field type (null fits a field that may be empty). */
export const fits = (type: Field['type'], value: Value, optional: boolean): boolean => {
  if (value === null) return optional
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  if (type === 'boolean') return typeof value === 'boolean'
  if (typeof value !== 'string') return false
  if (type === 'uuid') return UUID.test(value)
  if (type === 'date') return DATE.test(value)
  if (type === 'datetime') return DATETIME.test(value) && !Number.isNaN(Date.parse(value))
  return true
}

export const isExpression = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).some(key => key.startsWith('$'))

/** Why `field` (as it would be) doesn't fit the values the model already has for it: its default, the fixtures rows, query conditions. */
const valueProblems = (draft: Draft, entity: EntityFile, field: Field): string[] => {
  const optional = !field.required || !!field.nullable
  const problems: string[] = []
  if (field.default !== undefined && !fits(field.type, field.default, optional)) problems.push(`its default ${JSON.stringify(field.default)}`)
  for (const mod of Object.values(draft.model.modules)) {
    for (const fixtures of mod.fixtures.filter(entry => entry.entity === entity.id)) {
      fixtures.rows.forEach((row, index) => {
        const value = row[field.name]
        if (value === undefined ? !optional && field.default === undefined : !fits(field.type, value, optional)) problems.push(`fixtures row ${index + 1}`)
      })
    }
  }
  for (const query of queries(draft).filter(entry => entry.from === entity.id && entry.where?.field === field.name)) {
    const value = query.where!.value
    const values = query.where!.op === 'in' && Array.isArray(value) ? value : [value]
    if (!isExpression(value) && values.some(item => !fits(field.type, item, true))) problems.push(`the condition of ${query.id}`)
  }
  return problems
}

// ── entity_create ────────────────────────────────────────────────────────

const ALL_OPS: Op[] = ['list', 'get', 'create', 'update', 'delete']

export const entityCreate = defineEdit({
  input: z.object({
    module: ModuleNameSchema.optional().describe('The module it belongs to; defaults to the project\'s defaultModule'),
    name: z.string().min(1).max(60).describe('PascalCased, e.g. "blog post" → "BlogPost"; the id is ent_<name>'),
    plural: z.string().min(1).max(60).optional().describe('camelCased; defaults to the name plus "s" ("BlogPost" → "blogPosts")'),
    source: DataSourceRef.describe('The data source its repository uses (ds_*): sqlite and memory get every operation, rest the ones with endpoints'),
    fields: z.array(FieldInput).min(1).max(100).describe('Its fields, e.g. [{ "name": "title", "type": "text", "required": true }]. sqlite and memory entities get a uuid "id"; a REST entity with an "id" field keeps the API\'s own key'),
    expose: z.boolean().optional().describe('Whether its rows reach the app (a list route and a client collection, which queries read); default true'),
    endpoints: EndpointsInput.optional()
  }),
  apply: (draft, { module = draft.model.project.defaultModule, name: given, plural: givenPlural, source: sourceId, fields: givenFields, expose = true, endpoints }) => {
    const mod = draft.module(module)
    const source = datasourceById(draft, sourceId)
    const name = pascal(given)
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) fail('invalid', `"${given}" can't be an entity name: start with a letter, like "Post"`)
    const taken = mod.entities.find(entity => entity.name.toLowerCase() === name.toLowerCase())
    if (taken) fail('invalid', `Module "${module}" already has the entity ${taken.name} (${taken.id})`)
    const plural = givenPlural === undefined ? pluralOf(camel(name)) : camel(givenPlural)
    if (!/^[a-z][A-Za-z0-9]*$/.test(plural)) fail('invalid', `"${givenPlural}" can't be a plural: start with a letter, like "posts"`)
    const samePlural = mod.entities.find(entity => entity.plural === plural)
    if (samePlural) fail('invalid', `${samePlural.name} already uses the plural "${plural}" in module "${module}": plurals name code and routes`)

    const names = givenFields.map(field => fieldName(field.name))
    const duplicate = names.find((value, index) => names.indexOf(value) !== index)
    if (duplicate) fail('invalid', `Two fields are named "${duplicate}"`)
    const external = names.includes('id')
    if (external && source.kind !== 'rest') fail('invalid', `"id" is reserved: entities of a ${source.kind} data source get a uuid id`)
    if (givenFields.some(field => field.remote) && source.kind !== 'rest') fail('invalid', 'Only fields of a REST entity map to remote keys')

    let operations: Op[] = ALL_OPS
    let rest: RepositoryFile['rest']
    if (source.kind === 'rest') {
      operations = ALL_OPS.filter(op => endpoints?.[op])
      if (!operations.length) fail('invalid', 'A REST entity needs the endpoint of at least one operation (endpoints), e.g. { "list": { "path": "/posts", "itemsPath": "items" } }')
      const remote = givenFields.some((field, index) => field.remote && field.remote !== names[index])
      rest = {
        ...(endpoints!.list ? { list: endpoints!.list } : {}),
        ...(remote ? { fieldMap: Object.fromEntries([...(external ? [] : [['id', 'id']]), ...givenFields.map((field, index) => [names[index]!, field.remote ?? names[index]!])]) } : {}),
        ...Object.fromEntries((['get', 'create', 'update', 'delete'] as const).filter(op => endpoints![op]).map(op => [op, endpoints![op]]))
      }
    } else if (endpoints) {
      fail('invalid', `Endpoints are for REST data sources: a ${source.kind} entity gets every operation`)
    }

    const entityId = draft.mint('ent', name)
    const fields: Field[] = givenFields.map((field, index) => ({ id: draft.mint('fld', names[index]!), name: names[index]!, type: field.type, ...(field.required ? { required: true } : {}) }))
    const entity: EntityFile = { id: entityId, name, plural, idStrategy: external ? 'external' : 'uuid', timestamps: false, fields, relations: [], client: { sync: 'eager' } }
    mod.entities.push(entity)
    const folder = `.bildr/modules/${module}`
    const filePath = draft.place(entityId, `${folder}/entities`, kebab(name))

    const listed = expose && operations.includes('list')
    const repositoryId = draft.mint('repo', name)
    mod.repositories.push({ id: repositoryId, entity: entityId, datasource: source.id, operations, ...(rest ? { rest } : {}), ...(listed ? { expose: { list: true } } : {}) })
    draft.place(repositoryId, `${folder}/repositories`, kebab(name))

    // Queries read the client collection, which only a listed entity has.
    const queryIds: string[] = []
    if (listed) {
      const queryNames = mod.queries.map(query => query.name)
      const all: QueryFile = { id: draft.mint('q', plural), name: uniqueName(plural, queryNames), label: sentence(`all ${spaced(plural)}`), from: entityId, params: [], result: 'many' }
      const byIdName = uniqueName(`${camel(name)}ById`, [...queryNames, all.name])
      const byId: QueryFile = {
        id: draft.mint('q', `${name} by id`),
        name: byIdName,
        label: sentence(`${spaced(name)} by id`),
        from: entityId,
        params: [{ name: 'id', type: keyType(entity), reactive: true }],
        where: { op: 'eq', field: 'id', value: { $param: 'id' } },
        result: 'one'
      }
      for (const query of [all, byId]) {
        mod.queries.push(query)
        draft.place(query.id, `${folder}/queries`, kebab(query.name))
        queryIds.push(query.id)
      }
    }

    let actionId: string | undefined
    if (operations.includes('create')) {
      checkRouteFree(mod.actions, 'POST', `/${kebab(plural)}`)
      actionId = draft.mint('act', `create ${name}`)
      const action = createAction(entity, repositoryId, listed, {
        id: actionId,
        name: uniqueName(`create${name}`, mod.actions.map(entry => entry.name)),
        label: sentence(`create ${spaced(name)}`)
      })
      mod.actions.push(action)
      draft.place(actionId, `${folder}/actions`, kebab(action.name))
    }

    let fixturesPath: string | undefined
    if (source.kind === 'memory') {
      const fixtures: FixturesFile = { entity: entityId, rows: [] }
      mod.fixtures.push(fixtures)
      fixturesPath = draft.place(`fixtures:${entityId}`, `${folder}/fixtures`, kebab(name))
    }
    return { entityId, filePath, repositoryId, queryIds, ...(actionId ? { actionId } : {}), ...(fixturesPath ? { fixturesPath } : {}) }
  }
})

// ── entity_update ────────────────────────────────────────────────────────

export const entityUpdate = defineEdit({
  input: z.object({
    entity: EntityRef,
    name: z.string().min(1).max(60).optional().describe('A new name (PascalCased); its files keep their paths'),
    plural: z.string().min(1).max(60).optional().describe('A new plural (camelCased): it names generated code and the list route'),
    expose: z.boolean().optional().describe('Whether its rows reach the app (list route and client collection). Turning it off is refused while queries read them')
  }),
  apply: (draft, { entity: id, name, plural, expose }) => {
    const { entity, module } = entityById(draft, id)
    const mod = draft.module(module)
    if (name !== undefined) {
      const value = pascal(name)
      if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) fail('invalid', `"${name}" can't be an entity name: start with a letter, like "Post"`)
      const taken = mod.entities.find(other => other.id !== id && other.name.toLowerCase() === value.toLowerCase())
      if (taken) fail('invalid', `Module "${module}" already has the entity ${taken.name} (${taken.id})`)
      entity.name = value
    }
    if (plural !== undefined) {
      const value = camel(plural)
      if (!/^[a-z][A-Za-z0-9]*$/.test(value)) fail('invalid', `"${plural}" can't be a plural: start with a letter, like "posts"`)
      const taken = mod.entities.find(other => other.id !== id && other.plural === value)
      if (taken) fail('invalid', `${taken.name} already uses the plural "${value}" in module "${module}"`)
      entity.plural = value
    }
    if (expose !== undefined) {
      const repository = repositoryOf(draft, id) ?? fail('invalid', `Entity ${entity.name} has no repository`)
      if (expose) {
        if (!repository.operations.includes('list')) fail('invalid', `The repository ${repository.id} can't list ${entity.name} rows: it has no list operation`)
        repository.expose = { list: true }
      } else {
        const readers = queries(draft).filter(query => query.from === id).map(query => query.id)
        if (readers.length) fail('invalid', `The queries ${listOf(readers)} read ${entity.name} rows in the app. Delete them first`)
        delete repository.expose
        for (const action of actions(draft)) if (action.client.optimistic?.entity === id) delete action.client.optimistic
      }
    }
    return {}
  }
})

// ── entity_delete ────────────────────────────────────────────────────────

export const entityDelete = defineEdit({
  input: z.object({ entity: EntityRef }),
  apply: (draft, { entity: id }) => {
    const { entity, module } = entityById(draft, id)
    const mod = draft.module(module)
    const repository = repositoryOf(draft, id)
    const ownQueries = queries(draft).filter(query => query.from === id)
    const ownActions = actions(draft).filter(action => action.input.entity === id || action.output?.entity === id
      || action.steps.some(step => repository && step.repository === repository.id))
    const ids = new Set([id, ...entity.fields.map(field => field.id), ...ownQueries.map(query => query.id), ...ownActions.map(action => action.id)])
    const users = treeUsers(draft, ids)
    const cascaded = new Set([...ownQueries, ...ownActions].map(item => item.id))
    for (const action of actions(draft)) {
      if (!cascaded.has(action.id) && mentions(action, new Set([id, ...(repository ? [repository.id] : [])]))) users.push(action.id)
    }
    for (const other of Object.values(draft.model.modules).flatMap(entry => entry.entities)) {
      if (other.id !== id && other.relations.some(relation => relation.to === id)) users.push(`${other.id} (relations)`)
    }
    for (const component of draft.components()) {
      if (component.properties.some(property => property.entity === id) && !users.includes(`${component.id} (properties)`)) users.push(`${component.id} (properties)`)
    }
    if (users.length) fail('invalid', `Entity ${entity.name} is still used by ${listOf(users)}. Change them first`)

    const remove = <T>(list: T[], items: T[]) => {
      for (const item of items) list.splice(list.indexOf(item), 1)
    }
    for (const owner of Object.values(draft.model.modules)) {
      remove(owner.queries, owner.queries.filter(query => cascaded.has(query.id)))
      remove(owner.actions, owner.actions.filter(action => cascaded.has(action.id)))
      remove(owner.fixtures, owner.fixtures.filter(fixtures => fixtures.entity === id))
      remove(owner.repositories, owner.repositories.filter(entry => entry.entity === id))
    }
    remove(mod.entities, [entity])
    return { deleted: [id, ...(repository ? [repository.id] : []), ...cascaded].sort() }
  }
})

// ── Fields ───────────────────────────────────────────────────────────────

/** The create actions of an entity whose input picks its fields: they take a new field too. */
const pickingActions = (draft: Draft, entityId: string) => actions(draft).filter(action => action.input.entity === entityId && action.input.pick)

/** Pages and components that show rows of `entity`: their bindings may read a field by name. */
const bindsFieldName = (draft: Draft, entity: EntityFile, name: string): string[] => {
  const ids = new Set([...queries(draft).filter(query => query.from === entity.id).map(query => query.id), ...actions(draft).filter(action => action.input.entity === entity.id || action.output?.entity === entity.id).map(action => action.id)])
  const reads = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    for (const key of ['$bind', '$template'] as const) {
      const text = record[key]
      if (typeof text === 'string' && text.split(/[^\w$]+/).slice(1).includes(name) && /[.]/.test(text)) return true
    }
    return Object.values(record).some(reads)
  }
  return draft.trees().flatMap((tree) => {
    const owner = tree.owner as { uses?: unknown, properties?: Array<{ entity?: string }> }
    const about = mentions(owner.uses, ids) || owner.properties?.some(property => property.entity === entity.id)
    if (!about) return []
    const found: string[] = []
    walk(tree.root, (node) => {
      if (reads(node.props) || reads(node.interactions)) found.push(`${tree.file} (${node.id})`)
    })
    if (reads((tree.owner as { seo?: unknown }).seo)) found.push(`${tree.file} (seo)`)
    return found
  })
}

/** What uses a field (beyond what follows it automatically: create-action picks, the REST field map, fixtures rows). */
const fieldUsers = (draft: Draft, entity: EntityFile, field: Field): string[] => {
  const users: string[] = []
  for (const query of queries(draft).filter(entry => entry.from === entity.id)) {
    if (query.where?.field === field.name || query.orderBy?.some(order => order.field === field.name)) users.push(query.id)
  }
  for (const action of actions(draft).filter(entry => entry.input.entity === entity.id || entry.output?.entity === entity.id)) {
    const named = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false
      const record = value as Record<string, unknown>
      if (Object.hasOwn(record, field.name) || record.$input === field.name) return true
      return Object.values(record).some(named)
    }
    if (action.steps.some(named) || action.errors.some(error => error.message.includes(`{${field.name}}`))) users.push(action.id)
  }
  const repository = repositoryOf(draft, entity.id)
  if (repository?.finders?.some(finder => finder.by === field.id) || repository?.list?.orderBy.some(order => order.field === field.name)) users.push(repository.id)
  users.push(...treeUsers(draft, new Set([field.id])), ...bindsFieldName(draft, entity, field.name))
  return [...new Set(users)]
}

const fieldMapOf = (draft: Draft, entityId: string) => repositoryOf(draft, entityId)?.rest?.fieldMap

const FieldOptions = {
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  nullable: z.boolean().optional()
}

export const entityFieldAdd = defineEdit({
  input: z.object({
    entity: EntityRef,
    name: FieldName,
    type: z.enum(FIELD_TYPES),
    ...FieldOptions,
    remote: RemoteKey.optional(),
    index: z.int().min(0).optional().describe('Its position among the fields (default: the end)')
  }),
  apply: (draft, { entity: id, name: given, type, required, unique, nullable, remote, index }) => {
    const { entity } = entityById(draft, id)
    const name = fieldName(given)
    if (entity.fields.some(field => field.name === name)) fail('invalid', `Entity ${entity.name} already has a field "${name}"`)
    const field: Field = { id: draft.mint('fld', name), name, type, ...(required ? { required } : {}), ...(unique ? { unique } : {}), ...(nullable ? { nullable } : {}) }
    const problems = valueProblems(draft, entity, field)
    if (problems.length) fail('invalid', `${name} would be required but ${listOf(problems)} ${problems.length === 1 ? 'has' : 'have'} no value for it: add it as optional, fill them in, then make it required`)
    entity.fields.splice(index ?? entity.fields.length, 0, field)
    const map = fieldMapOf(draft, id)
    const source = repositoryOf(draft, id)
    if (remote && (!source || datasourceById(draft, source.datasource).kind !== 'rest')) fail('invalid', 'Only fields of a REST entity map to remote keys')
    if (map) map[name] = remote ?? name
    else if (remote && remote !== name && source?.rest) {
      source.rest.fieldMap = Object.fromEntries([...(entity.idStrategy === 'uuid' ? [['id', 'id']] : []), ...entity.fields.map(entry => [entry.name, entry.id === field.id ? remote : entry.name])])
    }
    for (const action of pickingActions(draft, id)) action.input.pick!.push(name)
    return { fieldId: field.id }
  }
})

export const entityFieldUpdate = defineEdit({
  input: z.object({
    entity: EntityRef,
    field: FieldRef,
    name: FieldName.optional().describe('A new name; refused while queries, actions, repositories or pages use the field by name'),
    type: z.enum(FIELD_TYPES).optional().describe('A new type; refused while its default, the fixtures rows or query conditions hold values it can\'t take'),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    nullable: z.boolean().optional(),
    remote: RemoteKey.optional()
  }),
  apply: (draft, { entity: id, field: fieldId, name: given, type, required, unique, nullable, remote }) => {
    const { entity } = entityById(draft, id)
    const field = fieldOf(entity, fieldId)
    const next: Field = { ...field }
    if (type !== undefined) next.type = type
    for (const [key, value] of [['required', required], ['unique', unique], ['nullable', nullable]] as const) {
      if (value === true) next[key] = true
      else if (value === false) Reflect.deleteProperty(next, key)
    }
    if (type !== undefined && type !== field.type) {
      if (field.name === 'id' && !['text', 'integer', 'number', 'uuid'].includes(type)) fail('invalid', `The key "id" is text, integer, number or uuid, not ${type}`)
      if ((next.min !== undefined || next.max !== undefined) && !['text', 'integer', 'number'].includes(type)) fail('invalid', `${field.name} has min/max: a ${type} field takes neither (remove them first)`)
      if (next.pattern !== undefined && type !== 'text') fail('invalid', `${field.name} has a pattern: only a text field takes one (remove it first)`)
    }
    const problems = valueProblems(draft, entity, next)
    if (problems.length) fail('invalid', `${field.name} can't be ${next.required ? 'a required ' : 'a '}${next.type}: ${listOf(problems)} ${problems.length === 1 ? 'holds a value' : 'hold values'} it can't take`)
    const map = fieldMapOf(draft, id)
    if (given !== undefined) {
      const name = fieldName(given)
      if (name !== field.name) {
        if (field.name === 'id') fail('invalid', 'The key "id" can\'t be renamed')
        if (entity.fields.some(other => other.name === name)) fail('invalid', `Entity ${entity.name} already has a field "${name}"`)
        const users = fieldUsers(draft, entity, field)
        if (users.length) fail('invalid', `${field.name} is used by ${listOf(users)}: change them first`)
        for (const action of pickingActions(draft, id)) action.input.pick = action.input.pick!.map(entry => entry === field.name ? name : entry)
        if (map && field.name in map) {
          const value = map[field.name]!
          Reflect.deleteProperty(map, field.name)
          map[name] = value
        }
        for (const mod of Object.values(draft.model.modules)) {
          for (const fixtures of mod.fixtures.filter(entry => entry.entity === id)) {
            fixtures.rows = fixtures.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key === field.name ? name : key, value])))
          }
        }
        next.name = name
      }
    }
    if (remote !== undefined) {
      const repository = repositoryOf(draft, id)
      const rest = repository?.rest ?? fail('invalid', 'Only fields of a REST entity map to remote keys')
      const fieldMap = rest.fieldMap ?? Object.fromEntries([...(entity.idStrategy === 'uuid' ? [['id', 'id']] : []), ...entity.fields.map(entry => [entry.id === field.id ? next.name : entry.name, entry.id === field.id ? next.name : entry.name])])
      fieldMap[next.name] = remote
      rest.fieldMap = fieldMap
    }
    entity.fields[entity.fields.indexOf(field)] = next
    return {}
  }
})

export const entityFieldMove = defineEdit({
  input: z.object({ entity: EntityRef, field: FieldRef, index: z.int().min(0).describe('Its position after the move') }),
  apply: (draft, { entity: id, field: fieldId, index }) => {
    const { entity } = entityById(draft, id)
    const field = fieldOf(entity, fieldId)
    if (index >= entity.fields.length) fail('invalid', `Entity ${entity.name} has ${entity.fields.length} fields: the index is at most ${entity.fields.length - 1}`)
    entity.fields.splice(entity.fields.indexOf(field), 1)
    entity.fields.splice(index, 0, field)
    return {}
  }
})

export const entityFieldRemove = defineEdit({
  input: z.object({ entity: EntityRef, field: FieldRef }),
  apply: (draft, { entity: id, field: fieldId }) => {
    const { entity } = entityById(draft, id)
    const field = fieldOf(entity, fieldId)
    if (field.name === 'id') fail('invalid', `"id" is the key ${entity.name} rows are found by: it can't be removed`)
    if (entity.fields.length === 1) fail('invalid', `${field.name} is the only field of ${entity.name}: an entity needs at least one`)
    const users = fieldUsers(draft, entity, field)
    if (users.length) fail('invalid', `${field.name} is used by ${listOf(users)}: change them first`)
    entity.fields.splice(entity.fields.indexOf(field), 1)
    for (const action of pickingActions(draft, id)) action.input.pick = action.input.pick!.filter(entry => entry !== field.name)
    const map = fieldMapOf(draft, id)
    if (map) Reflect.deleteProperty(map, field.name)
    for (const mod of Object.values(draft.model.modules)) {
      for (const fixtures of mod.fixtures.filter(entry => entry.entity === id)) {
        fixtures.rows = fixtures.rows.map(({ [field.name]: _removed, ...row }) => row)
      }
    }
    return {}
  }
})
