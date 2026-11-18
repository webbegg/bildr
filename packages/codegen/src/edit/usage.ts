import type { Model } from '../model/load.ts'
import type { ActionFile, ComponentFile, EntityFile, ModelNode, PageFile } from '../model/schemas.ts'
import { mapNodePaths, mapPaths, rootOf, walkScoped } from './bindings.ts'
import { treesOf } from './core.ts'
import { walk } from './tree.ts'

/**
 * The usage index: who uses an artifact, as data. Deleting a query, an action or an entity, and removing or renaming a field, is
 * refused while this list has an entry the module does not change itself (`refusalLabels` turns it into the sentence), and the
 * Data workspace's "Used in" and its warnings read it: the editor says "not used" exactly when the module goes ahead.
 *
 * Two layers: `idUses` finds the files that hold an artifact's id (a page's `uses`, a Form's `action`, a `runAction` step, a
 * component property's entity…): what must change before the artifact can go. `usesOf` adds how the artifact is read: the nodes that
 * bind the name a page uses it under, and the actions whose input, output or steps mention it.
 *
 * `entityUsesOf` (who uses a collection) and `fieldUsesIndex` (who uses each of its fields) are the other two readers of the same
 * index. They also say how a page binds a field: through the alias it reads a query as, the result of an action it runs, or the
 * item name of a List.
 */

export type UseKind = 'page' | 'component' | 'layout' | 'action' | 'query' | 'entity'
/**
 * How it is used: `uses` (a page's uses), `param` (a page's route param), `properties` (a component's
 * properties), `props` (a node's props), `form` (a Form's action), `interaction` (a node's interaction steps),
 * `bind` (a node, computed value or SEO field binding the name a page uses it under), and for an action that
 * mentions it: `input`, `output`, `step`, `errors` or `client`. A collection or field is also used `via` `list` (a List shows its
 * rows), `field` (a form field holds the field), `where` and `orderBy` (a query's condition and order, or the order of the
 * collection's own repository), `finder` (a lookup its repository has by the field), `relation` (another collection points to it),
 * `pick` (an action's input picks it) and `set` (a step of an action sets it).
 */
export type UseVia = 'uses' | 'param' | 'properties' | 'props' | 'form' | 'interaction' | 'bind' | 'input' | 'output' | 'step' | 'errors' | 'client'
  | 'list' | 'field' | 'where' | 'orderBy' | 'finder' | 'relation' | 'pick' | 'set'

export interface ArtifactUse {
  kind: UseKind
  /** The page, component, layout, action, query or collection id. */
  id: string
  name: string
  via: UseVia
  /** Where in the file: `uses`, `computed`, `queries` (a query use's arguments), `seo`, `properties`, `repository`, `relations`, a node id, or the action's section. */
  where: string
  /** The node, when the use is on one. */
  node?: string
  /** The name a page uses it under (`uses`) or binds it by (`bind`), or the item name of a List (`list`). */
  as?: string
  /** A collection's uses: the id of the query or action of the collection that the page reads or runs. */
  by?: string
  /** The module changes this use along with the artifact (an action's pick of a field, a collection's own action), so it does not stop a delete or a rename. */
  follows?: boolean
}

/** Whether `value` holds one of the strings `ids` anywhere. */
export const mentions = (value: unknown, ids: ReadonlySet<string>): boolean => {
  if (typeof value === 'string') return ids.has(value)
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some(item => mentions(item, ids))
}

/** The strings of `ids` that `value` holds anywhere. */
const mentioned = (value: unknown, ids: ReadonlySet<string>, found = new Set<string>()): Set<string> => {
  if (typeof value === 'string') {
    if (ids.has(value)) found.add(value)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) mentioned(item, ids, found)
  }
  return found
}

/** A place in a page, component or layout that holds some of the ids asked for, with which. */
interface Held {
  use: ArtifactUse
  ids: string[]
}

/** The places that hold any of `ids`, each with the ids it holds: one pass over the trees, however many ids there are. */
const heldBy = (model: Model, ids: ReadonlySet<string>): Held[] => treesOf(model).flatMap((tree) => {
  const found: Held[] = []
  const owner = tree.owner as { name: string, uses?: { queries?: Array<{ as: string, query: string }>, actions?: Array<{ as: string, action: string }>, state?: Array<{ as: string, state: string }> }, params?: unknown, properties?: unknown }
  const base = { kind: tree.kind, id: tree.file, name: owner.name } as const
  const aliased = [
    ...(owner.uses?.queries ?? []).map(use => ({ as: use.as, id: use.query })),
    ...(owner.uses?.actions ?? []).map(use => ({ as: use.as, id: use.action })),
    ...(owner.uses?.state ?? []).map(use => ({ as: use.as, id: use.state }))
  ].filter(use => ids.has(use.id))
  for (const use of aliased) found.push({ use: { ...base, via: 'uses', where: 'uses', as: use.as }, ids: [use.id] })
  const held = (value: unknown, use: ArtifactUse) => {
    const hit = mentioned(value, ids)
    if (hit.size) found.push({ use, ids: [...hit] })
  }
  if (!aliased.length) held(owner.uses, { ...base, via: 'uses', where: 'uses' })
  held(owner.params, { ...base, via: 'param', where: 'uses' })
  held(owner.properties, { ...base, via: 'properties', where: 'properties' })
  walk(tree.root, (node) => {
    const action = node.type === 'Form' && typeof node.props?.action === 'string' && ids.has(node.props.action)
    held(node.props, { ...base, via: action ? 'form' : 'props', where: node.id, node: node.id })
    held(node.interactions, { ...base, via: 'interaction', where: node.id, node: node.id })
  })
  return found
})

/** The pages, components and layouts that hold any of `ids` (queries, actions, fields, an entity…). */
export const idUses = (model: Model, ids: ReadonlySet<string>): ArtifactUse[] => heldBy(model, ids).map(held => held.use)

/**
 * The places that stop a change, as the refusal names them: `pg_index (uses)`, `pg_new_post (n_form)`, `q_post_by_slug`, each once.
 * What the module changes itself (`follows`) is not one.
 */
export const refusalLabels = (uses: ArtifactUse[]): string[] => [...new Set(uses.filter(use => !use.follows)
  .map(use => use.kind === 'query' || use.kind === 'action' ? use.id : `${use.id} (${use.where})`))]

/** The sentence a refusal gives for one use: `page "index" (pg_index) reads it as "featured"`. */
export const describeUse = (use: ArtifactUse): string => {
  const what = `${use.kind} "${use.name}" (${use.id})`
  if (use.via === 'uses') return `${what} uses it${use.as ? ` as "${use.as}"` : ''}`
  if (use.via === 'form') return `${what}: the Form ${use.node} runs it`
  if (use.via === 'interaction') return `${what}: ${use.node} runs it on an interaction`
  if (use.via === 'bind') return `${what}: ${use.where === use.node ? use.node : use.where} binds "${use.as}"`
  if (use.via === 'properties') return `${what} has a property for it`
  if (use.via === 'param') return `${what} validates a route param with it`
  if (use.via === 'props') return `${what}: ${use.node} has it in its props`
  if (use.via === 'relation') return `${what} has a relation to it`
  if (use.via === 'finder') return `${what}: its repository looks rows up by it`
  return `${what} mentions it in its ${use.where}`
}

/** `describeUse` of each distinct use, as one sentence part (at most `limit`, then "and N more"). */
export const describeUses = (uses: ArtifactUse[], limit = 6): string => {
  const lines = [...new Set(uses.map(describeUse))]
  return lines.length > limit ? `${lines.slice(0, limit).join('; ')}; and ${lines.length - limit} more` : lines.join('; ')
}

const ACTION_PARTS = [['input', 'input'], ['output', 'output'], ['steps', 'step'], ['errors', 'errors'], ['client', 'client']] as const

/**
 * The page's computed values, SEO fields and nodes that bind `as`, the name the page uses a query, an action, a state or a computed
 * value under. A List's item name of the same word shadows it for the nodes inside the List. `skip` is a computed value left out (its own).
 */
const bindsOf = (page: PageFile, as: string, skip?: string): ArtifactUse[] => {
  const base = { kind: 'page', id: page.id, name: page.name, via: 'bind' } as const
  const uses: ArtifactUse[] = []
  const reads = (value: unknown) => {
    let bound = false
    mapPaths(value, (path) => {
      if (rootOf(path) === as) bound = true
      return undefined
    })
    return bound
  }
  if (reads((page.uses?.computed ?? []).filter(entry => entry.as !== skip))) uses.push({ ...base, where: 'computed', as })
  if (reads((page.uses?.queries ?? []).map(use => use.args))) uses.push({ ...base, where: 'queries', as })
  if (reads(page.seo)) uses.push({ ...base, where: 'seo', as })
  walkScoped(page.root, (node, scope) => {
    let bound = false
    mapNodePaths(node, (path) => {
      if (rootOf(path) === as && !scope.has(as)) bound = true
      return undefined
    })
    if (bound) uses.push({ ...base, where: node.id, node: node.id, as })
  })
  return uses
}

/** Who binds the computed value `as` of page `pageId`: the nodes, other computed values and SEO fields that read it. What `page_computed_remove` refuses for. */
export const computedUsesOf = (model: Model, pageId: string, as: string): ArtifactUse[] => {
  const page = Object.values(model.modules).flatMap(mod => mod.pages).find(entry => entry.id === pageId)
  return page ? bindsOf(page, as, as) : []
}
/** Everything that uses artifact `artifactId` (a query, action, entity, field…): see the file comment. */
export const usesOf = (model: Model, artifactId: string): ArtifactUse[] => {
  const ids = new Set([artifactId])
  const uses = idUses(model, ids)

  // The nodes, computed values and SEO fields that bind the name a page reads a query or runs an action under.
  for (const tree of treesOf(model)) {
    if (tree.kind !== 'page') continue
    const page = tree.owner as PageFile
    const aliases = [
      ...(page.uses?.queries ?? []).filter(use => use.query === artifactId).map(use => use.as),
      ...(page.uses?.actions ?? []).filter(use => use.action === artifactId).map(use => use.as),
      ...(page.uses?.state ?? []).filter(use => use.state === artifactId).map(use => use.as)
    ]
    for (const as of aliases) uses.push(...bindsOf(page, as))
  }

  // The actions that mention it in their input, output, steps, errors or client part.
  for (const mod of Object.values(model.modules)) {
    for (const action of mod.actions as ActionFile[]) {
      if (action.id === artifactId) continue
      for (const [key, via] of ACTION_PARTS) {
        if (mentions(action[key], ids)) uses.push({ kind: 'action', id: action.id, name: action.name, via, where: key })
      }
    }
  }
  return uses
}

// ── Collections and fields ───────────────────────────────────────────────

/** What a name stands for in a tree: the collection its rows are of, and whether it holds a list of them or one. Null: a name that shadows another. */
interface Source {
  entity: string
  many: boolean
}
type Env = ReadonlyMap<string, Source | null>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The names a page reads rows under: its queries (a list for `many`, a row for `one`), and the computed values that read one of them. */
const pageEnv = (model: Model, page: PageFile): Map<string, Source | null> => {
  const queries = Object.values(model.modules).flatMap(mod => mod.queries)
  const env = new Map<string, Source | null>()
  for (const use of page.uses?.queries ?? []) {
    const query = queries.find(entry => entry.id === use.query)
    if (query) env.set(use.as, { entity: query.from, many: query.result === 'many' })
  }
  // A computed value shows the rows of the first query it reads: `posts` = `all` or `featured`.
  for (const computed of page.uses?.computed ?? []) {
    let found: Source | null | undefined
    mapPaths(computed, (path) => {
      found ??= env.get(rootOf(path))
      return undefined
    })
    if (found) env.set(computed.as, found)
  }
  return env
}

/** The names a component reads rows under: its entity properties. */
const componentEnv = (component: ComponentFile): Map<string, Source | null> => new Map(
  component.properties.filter(property => property.kind === 'entity' && property.entity).map(property => [property.name, { entity: property.entity!, many: !!property.many }])
)

/** What a List node shows: the name it gives each item, and the rows its `items` binding stands for (undefined: not a list of rows). */
const listOf = (node: ModelNode, env: Env): { as: string, source: Source | null | undefined } | undefined => {
  const as = node.type === 'List' ? node.props?.as : undefined
  if (typeof as !== 'string') return undefined
  const items = node.props?.items
  const path = isRecord(items) && typeof items.$bind === 'string' ? items.$bind : undefined
  return { as, source: path && !path.includes('.') ? env.get(path) : undefined }
}

/** Visits `node` and its descendants with what each name stands for there: a List's item name is a row of the rows it lists. */
const walkEnv = (node: ModelNode, env: Env, visit: (node: ModelNode, env: Env) => void): void => {
  visit(node, env)
  const list = listOf(node, env)
  const inner = list ? new Map(env).set(list.as, list.source?.many ? { entity: list.source.entity, many: false } : null) : env
  for (const child of node.children ?? []) walkEnv(child, inner, visit)
}

interface Scan {
  /** Each bound path of a row of a collection: `post.title` is field `title` of `ent_post`, read as `post`. */
  binds: Array<{ entity: string, field: string, use: ArtifactUse }>
  /** Each List that shows the rows of a collection, with the name it gives each. */
  lists: Array<{ entity: string, use: ArtifactUse }>
}

/** Every binding of a row's field and every List of rows in the model's pages, components and layouts. */
const scanBindings = (model: Model): Scan => {
  const scan: Scan = { binds: [], lists: [] }
  for (const tree of treesOf(model)) {
    const owner = tree.owner as { name: string }
    const base = { kind: tree.kind, id: tree.file, name: owner.name } as const
    const env: Env = tree.kind === 'page' ? pageEnv(model, tree.owner as PageFile) : tree.kind === 'component' ? componentEnv(tree.owner as ComponentFile) : new Map()
    const read = (scope: Env, where: string, node?: string) => (path: string): undefined => {
      const [root, field] = path.split('.')
      const source = scope.get(root!)
      if (source && !source.many && field) scan.binds.push({ entity: source.entity, field, use: { ...base, via: 'bind', where, ...(node ? { node } : {}), as: root! } })
      return undefined
    }
    if (tree.kind === 'page') {
      const page = tree.owner as PageFile
      mapPaths(page.uses?.computed, read(env, 'computed'))
      mapPaths(page.seo, read(env, 'seo'))
    }
    walkEnv(tree.root, env, (node, scope) => {
      mapNodePaths(node, read(scope, node.id, node.id))
      const list = listOf(node, scope)
      if (list?.source?.many) scan.lists.push({ entity: list.source.entity, use: { ...base, via: 'list', where: node.id, node: node.id, as: list.as } })
    })
  }
  return scan
}

/**
 * Whether `value` holds `name` the way an action's steps name a field: as a key (a step's own keys too: `kind`, `op`, `set`,
 * `repository`), or as the `$input` they read. `entity_field_remove` and a rename refuse for it, as the index counts it.
 */
const namesField = (value: unknown, name: string): boolean => {
  if (!isRecord(value)) return Array.isArray(value) && value.some(entry => namesField(entry, name))
  return Object.hasOwn(value, name) || value.$input === name || Object.values(value).some(entry => namesField(entry, name))
}

/** The dotted `$bind` and `$template` texts anywhere in `value` (`post.title`, `Hi {post.name}`). */
const dottedTexts = (value: unknown, found: string[] = []): string[] => {
  if (!value || typeof value !== 'object') return found
  const record = value as Record<string, unknown>
  for (const key of ['$bind', '$template'] as const) {
    const text = record[key]
    if (typeof text === 'string' && text.includes('.')) found.push(text)
  }
  for (const entry of Object.values(record)) dottedTexts(entry, found)
  return found
}

/**
 * The words of a dotted text after its first, the way the module reads a binding for a field name: `post.title` names `title`,
 * `publish.data.title` names `data` and `title`, `Hi {post.name}` names `post` and `name`. A binding is read by name whatever the
 * path stands for (a query's row, an action's result, a computed value), so the module refuses to rename what it may name.
 */
const wordsAfterFirst = (text: string): string[] => text.split(/[^\w$]+/).slice(1)

/** The name a dotted text reads `field` through: `publish` for `publish.data.title`. Undefined when no path of the text holds it. */
const aliasOf = (text: string, field: string): string | undefined =>
  [...text.matchAll(/[A-Za-z_$][\w$]*(?:\.[\w$]+)+/g)].map(match => match[0]).find(path => path.split('.').slice(1).includes(field))?.split('.')[0]

/** The uses, each once (the same place in the same way is one use). */
const distinct = (uses: ArtifactUse[]): ArtifactUse[] => [...new Map(uses.map(use => [JSON.stringify(use), use])).values()]

/** The collection's own queries, actions and repositories: what `entity_delete` takes along, and the actions that are on it. */
const ownedBy = (model: Model, entityId: string) => {
  const modules = Object.values(model.modules)
  const repositories = modules.flatMap(mod => mod.repositories).filter(repository => repository.entity === entityId)
  const repositoryIds = new Set(repositories.map(repository => repository.id))
  const actions = modules.flatMap(mod => mod.actions)
  const onEntity = actions.filter(action => action.input.entity === entityId || action.output?.entity === entityId)
  return {
    repositories,
    queries: modules.flatMap(mod => mod.queries).filter(query => query.from === entityId),
    /** `entity_delete` deletes them: the ones on the collection, and the ones that write it through its repository. */
    actions: actions.filter(action => onEntity.includes(action) || action.steps.some(step => typeof step.repository === 'string' && repositoryIds.has(step.repository))),
    /** The ones the module looks at for a field: their input or output is the collection. */
    onEntity
  }
}

/**
 * Who uses each field of collection `entityId`, by field name, in one pass over the model (`only`: just that field): everything that
 * `entity_field_remove` and a field rename refuse for. The nodes, computed values and SEO fields that bind it (through the alias a
 * page reads a query as, the entity property of a component, the item name of a List, or any path of a page that shows the
 * collection's rows or runs its actions: the result of an action reads `create.data.title`), the queries that filter or order by
 * it, the repository's finders and list order, the actions that set it or name it in their steps (any key of a step too, and its
 * `$input`) or in an error message, the form fields that hold its id, and the route parameter it validates. An action that picks it
 * (its input is the collection's) `follows` the field: the module changes the pick with it.
 */
export const fieldUsesIndex = (model: Model, entityId: string, only?: string): Map<string, ArtifactUse[]> => {
  const index = new Map<string, ArtifactUse[]>()
  const entity: EntityFile | undefined = Object.values(model.modules).flatMap(mod => mod.entities).find(entry => entry.id === entityId)
  if (!entity) return index
  const fields = only === undefined ? entity.fields : entity.fields.filter(field => field.name === only)
  const add = (field: string, use: ArtifactUse) => {
    if (only !== undefined && field !== only) return
    const list = index.get(field)
    if (list) list.push(use)
    else index.set(field, [use])
  }

  for (const { entity: of, field, use } of scanBindings(model).binds) if (of === entityId) add(field, use)

  const { repositories, queries, onEntity } = ownedBy(model, entityId)
  const named = new Set(fields.map(field => field.name))

  // The bindings the module refuses without knowing what they stand for: a dotted path in a page that reads the collection's
  // queries or runs its actions, or in a component with a property for it, that has the name after its first word.
  const reading = new Set([...queries, ...onEntity].map(item => item.id))
  for (const tree of treesOf(model)) {
    const owner = tree.owner as { name: string, uses?: unknown, properties?: Array<{ entity?: string }>, seo?: unknown }
    if (!mentions(owner.uses, reading) && !owner.properties?.some(property => property.entity === entityId)) continue
    const base = { kind: tree.kind, id: tree.file, name: owner.name } as const
    const read = (value: unknown, where: string, node?: string) => {
      for (const text of dottedTexts(value)) {
        for (const word of new Set(wordsAfterFirst(text))) {
          if (!named.has(word)) continue
          const as = aliasOf(text, word)
          add(word, { ...base, via: 'bind', where, ...(node ? { node } : {}), ...(as ? { as } : {}) })
        }
      }
    }
    walk(tree.root, (node) => {
      read(node.props, node.id, node.id)
      read(node.interactions, node.id, node.id)
    })
    read(owner.seo, 'seo')
  }

  for (const query of queries) {
    const base = { kind: 'query', id: query.id, name: query.name } as const
    if (query.where) add(query.where.field, { ...base, via: 'where', where: 'where' })
    for (const order of query.orderBy ?? []) add(order.field, { ...base, via: 'orderBy', where: 'orderBy' })
  }

  for (const repository of repositories) {
    const base = { kind: 'entity', id: entity.id, name: entity.name } as const
    for (const field of fields) if (repository.finders?.some(finder => finder.by === field.id)) add(field.name, { ...base, via: 'finder', where: 'repository' })
    for (const order of repository.list?.orderBy ?? []) add(order.field, { ...base, via: 'orderBy', where: 'repository' })
  }

  for (const action of onEntity) {
    const base = { kind: 'action', id: action.id, name: action.name } as const
    // The module rewrites the pick of an action whose input is this collection's, and only that one.
    if (action.input.entity === entityId) for (const name of action.input.pick ?? []) add(name, { ...base, via: 'pick', where: 'input', follows: true })
    for (const step of action.steps) {
      const { set, ...rest } = step as Record<string, unknown>
      for (const name of isRecord(set) ? Object.keys(set) : []) add(name, { ...base, via: 'set', where: 'steps' })
      for (const field of fields) {
        const inSet = isRecord(set) && (set.$input === field.name || Object.values(set).some(entry => namesField(entry, field.name)))
        // `set` is a step's own key too: a field named `set` is named by any step that has one.
        if (namesField(rest, field.name) || inSet || (field.name === 'set' && 'set' in step)) add(field.name, { ...base, via: 'step', where: 'steps' })
      }
    }
    for (const field of fields) {
      if (action.errors.some(error => error.message.includes(`{${field.name}}`))) add(field.name, { ...base, via: 'errors', where: 'errors' })
    }
  }

  const byId = new Map(fields.map(field => [field.id, field.name]))
  for (const { use, ids } of heldBy(model, new Set(byId.keys()))) {
    for (const id of ids) add(byId.get(id)!, use.via === 'props' ? { ...use, via: 'field' } : use)
  }
  return new Map([...index].map(([field, uses]) => [field, distinct(uses)]))
}

/** Who uses field `fieldName` of collection `entityId`: `fieldUsesIndex` for that one field, the list a change of just it asks. */
export const fieldUsesOf = (model: Model, entityId: string, fieldName: string): ArtifactUse[] => fieldUsesIndex(model, entityId, fieldName).get(fieldName) ?? []

/**
 * Who uses collection `entityId`, everything `entity_delete` refuses for: the pages, components and layouts that read the queries over
 * it or run its actions (each use says the query or action it goes `by`), the Lists that show its rows, the forms and form
 * fields, the route parameters that validate one of its fields, the components with a property for it, the other collections with
 * a relation to it, and the actions on it. What the module takes along when the collection is deleted, its own actions,
 * `follows` it: only the rest stops a delete.
 */
export const entityUsesOf = (model: Model, entityId: string): ArtifactUse[] => {
  const entities = Object.values(model.modules).flatMap(mod => mod.entities)
  const entity = entities.find(entry => entry.id === entityId)
  if (!entity) return []
  const { repositories, queries, actions } = ownedBy(model, entityId)
  const own = new Set(actions.map(action => action.id))
  const uses: ArtifactUse[] = []
  // `entity_delete` takes its queries and actions along and looks at the pages for them, not at another action that mentions one.
  for (const id of [...queries, ...actions].map(item => item.id)) uses.push(...usesOf(model, id).filter(use => use.kind !== 'action').map(use => ({ ...use, by: id })))
  for (const id of [entityId, ...repositories.map(repository => repository.id)]) uses.push(...usesOf(model, id))
  uses.push(...scanBindings(model).lists.filter(list => list.entity === entityId).map(list => list.use))
  for (const use of idUses(model, new Set(entity.fields.map(field => field.id)))) uses.push(use.via === 'props' ? { ...use, via: 'field' } : use)
  for (const other of entities) {
    if (other.id !== entityId && other.relations.some(relation => relation.to === entityId)) uses.push({ kind: 'entity', id: other.id, name: other.name, via: 'relation', where: 'relations' })
  }
  return distinct(uses.map(use => use.kind === 'action' && own.has(use.id) ? { ...use, follows: true } : use))
}

// ── State fields ─────────────────────────────────────────────────────────

/**
 * Who uses each field of state `stateId`, by field name, in one pass over the model (`only`: just that field): everything that
 * `state_update` refuses a change of. The nodes, computed values, query arguments and SEO fields of a page that bind it through the alias the page
 * uses the state under (`preferences.showDrafts`; the whole row, `preferences`, uses every field), and the `setState` steps, on
 * any node of a page, component or layout, that set it. A step is a use of the kind `interaction`, a binding one of `bind`.
 */
export const stateFieldUsesIndex = (model: Model, stateId: string, only?: string): Map<string, ArtifactUse[]> => {
  const index = new Map<string, ArtifactUse[]>()
  const state = Object.values(model.modules).flatMap(mod => mod.state).find(entry => entry.id === stateId)
  if (!state) return index
  const add = (field: string, use: ArtifactUse) => {
    if (only !== undefined && field !== only) return
    const list = index.get(field)
    if (list) list.push(use)
    else index.set(field, [use])
  }
  for (const tree of treesOf(model)) {
    const owner = tree.owner as { name: string }
    const base = { kind: tree.kind, id: tree.file, name: owner.name } as const
    if (tree.kind === 'page') {
      const page = tree.owner as PageFile
      for (const as of (page.uses?.state ?? []).filter(use => use.state === stateId).map(use => use.as)) {
        const read = (where: string, node?: string) => (path: string): undefined => {
          const [root, field] = path.split('.')
          if (root !== as) return undefined
          const use: ArtifactUse = { ...base, via: 'bind', where, ...(node ? { node } : {}), as }
          if (field) add(field, use)
          else for (const entry of state.fields) add(entry.name, use)
          return undefined
        }
        mapPaths(page.uses?.computed, read('computed'))
        mapPaths((page.uses?.queries ?? []).map(use => use.args), read('queries'))
        mapPaths(page.seo, read('seo'))
        walkScoped(page.root, (node, scope) => {
          if (!scope.has(as)) mapNodePaths(node, read(node.id, node.id))
        })
      }
    }
    walk(tree.root, (node) => {
      for (const interaction of node.interactions ?? []) {
        for (const step of interaction.do) {
          if (step.kind === 'setState' && step.state === stateId && typeof step.field === 'string') add(step.field, { ...base, via: 'interaction', where: node.id, node: node.id })
        }
      }
    })
  }
  return new Map([...index].map(([field, uses]) => [field, distinct(uses)]))
}

/** Who uses field `fieldName` of state `stateId`: `stateFieldUsesIndex` for that one field. */
export const stateFieldUsesOf = (model: Model, stateId: string, fieldName: string): ArtifactUse[] => stateFieldUsesIndex(model, stateId, fieldName).get(fieldName) ?? []
