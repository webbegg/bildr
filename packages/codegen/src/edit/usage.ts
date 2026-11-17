import type { Model } from '../model/load.ts'
import type { ActionFile, ComponentFile, ModelNode, PageFile } from '../model/schemas.ts'
import { mapNodePaths, mapPaths, rootOf, walkScoped } from './bindings.ts'
import { treesOf } from './core.ts'
import { walk } from './tree.ts'

/**
 * The usage index (D10a): who uses an artifact, as data. Deleting a query, an action or an
 * entity is refused while this list isn't empty (`useLabels` turns it into the sentence), and
 * the Data workspace's "Used in" reads it.
 *
 * Two layers: `idUses` finds the files that hold an artifact's id (a page's `uses`, a Form's
 * `action`, a `runAction` step, a component property's entity…): what must change before the
 * artifact can go. `usesOf` adds how the artifact is read: the nodes that bind the name a page
 * uses it under, and the actions whose input, output or steps mention it.
 *
 * D5 adds the two other readers of the same index: `entityUsesOf` (who uses a collection) and `fieldUsesOf` (who uses one of
 * its fields), which also say how a page binds a field: through the alias it reads a query as, or the item name of a List.
 */

export type UseKind = 'page' | 'component' | 'layout' | 'action' | 'query'
/**
 * How it is used: `uses` (a page's uses), `param` (a page's route param), `properties` (a component's
 * properties), `props` (a node's props), `form` (a Form's action), `interaction` (a node's interaction steps),
 * `bind` (a node, computed value or SEO field binding the name a page uses it under), and for an action that
 * mentions it: `input`, `output`, `step`, `errors` or `client`. A collection or field is also used `via` `list` (a List shows its
 * rows), `field` (a form field holds the field), `where` and `orderBy` (a query's condition and order), `pick` (an action's
 * input picks it) and `set` (a step of an action sets it).
 */
export type UseVia = 'uses' | 'param' | 'properties' | 'props' | 'form' | 'interaction' | 'bind' | 'input' | 'output' | 'step' | 'errors' | 'client'
  | 'list' | 'field' | 'where' | 'orderBy' | 'pick' | 'set'

export interface ArtifactUse {
  kind: UseKind
  /** The page, component, layout or action id. */
  id: string
  name: string
  via: UseVia
  /** Where in the file: `uses`, `computed`, `seo`, `properties`, a node id, or the action's section. */
  where: string
  /** The node, when the use is on one. */
  node?: string
  /** The name a page uses it under (`uses`) or binds it by (`bind`), or the item name of a List (`list`). */
  as?: string
  /** A collection's uses: the id of the query or action of the collection that the page reads or runs. */
  by?: string
  /** The module changes this use along with the artifact (an action's pick of a field, a collection's own action), so it does not stop a delete or a rename. */
  follows?: true
}

/** Whether `value` holds one of the strings `ids` anywhere. */
export const mentions = (value: unknown, ids: ReadonlySet<string>): boolean => {
  if (typeof value === 'string') return ids.has(value)
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some(item => mentions(item, ids))
}

/** The pages, components and layouts that hold any of `ids` (queries, actions, fields, an entity…). */
export const idUses = (model: Model, ids: ReadonlySet<string>): ArtifactUse[] => treesOf(model).flatMap((tree) => {
  const found: ArtifactUse[] = []
  const owner = tree.owner as { name: string, uses?: { queries?: Array<{ as: string, query: string }>, actions?: Array<{ as: string, action: string }>, state?: Array<{ as: string, state: string }> }, params?: unknown, properties?: unknown }
  const base = { kind: tree.kind, id: tree.file, name: owner.name } as const
  const aliased = [
    ...(owner.uses?.queries ?? []).filter(use => ids.has(use.query)),
    ...(owner.uses?.actions ?? []).filter(use => ids.has(use.action)),
    ...(owner.uses?.state ?? []).filter(use => ids.has(use.state))
  ]
  for (const use of aliased) found.push({ ...base, via: 'uses', where: 'uses', as: use.as })
  if (!aliased.length && mentions(owner.uses, ids)) found.push({ ...base, via: 'uses', where: 'uses' })
  if (mentions(owner.params, ids)) found.push({ ...base, via: 'param', where: 'uses' })
  if (mentions(owner.properties, ids)) found.push({ ...base, via: 'properties', where: 'properties' })
  walk(tree.root, (node) => {
    if (mentions(node.props, ids)) {
      const action = node.type === 'Form' && typeof node.props?.action === 'string' && ids.has(node.props.action)
      found.push({ ...base, via: action ? 'form' : 'props', where: node.id, node: node.id })
    }
    if (mentions(node.interactions, ids)) found.push({ ...base, via: 'interaction', where: node.id, node: node.id })
  })
  return found
})

/** `pg_index (uses)`, `pg_new_post (n_form)`: where each use is, each place once. */
export const useLabels = (uses: ArtifactUse[]): string[] => [...new Set(uses.map(use => `${use.id} (${use.where})`))]

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
  return `${what} mentions it in its ${use.where}`
}

/** `describeUse` of each distinct use, as one sentence part (at most `limit`, then "and N more"). */
export const describeUses = (uses: ArtifactUse[], limit = 6): string => {
  const lines = [...new Set(uses.map(describeUse))]
  return lines.length > limit ? `${lines.slice(0, limit).join('; ')}; and ${lines.length - limit} more` : lines.join('; ')
}

const ACTION_PARTS = [['input', 'input'], ['output', 'output'], ['steps', 'step'], ['errors', 'errors'], ['client', 'client']] as const

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
      ...(page.uses?.actions ?? []).filter(use => use.action === artifactId).map(use => use.as)
    ]
    const base = { kind: 'page', id: page.id, name: page.name, via: 'bind' } as const
    for (const as of aliases) {
      const reads = (value: unknown) => {
        let bound = false
        mapPaths(value, (path) => {
          if (rootOf(path) === as) bound = true
          return undefined
        })
        return bound
      }
      if (reads(page.uses?.computed)) uses.push({ ...base, where: 'computed', as })
      if (reads(page.seo)) uses.push({ ...base, where: 'seo', as })
      walkScoped(page.root, (node, scope) => {
        let bound = false
        mapNodePaths(node, (path) => {
          if (rootOf(path) === as && !scope.has(as)) bound = true
          return undefined
        })
        if (bound) uses.push({ ...base, where: node.id, node: node.id, as })
      })
    }
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

// ── Collections and fields (D5) ──────────────────────────────────────────

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

/** Visits `node` and its descendants with what each name stands for there: a List's item name is a row of the rows it lists. */
const walkEnv = (node: ModelNode, env: Env, visit: (node: ModelNode, env: Env) => void): void => {
  visit(node, env)
  let inner = env
  const as = node.type === 'List' ? node.props?.as : undefined
  if (typeof as === 'string') {
    const items = node.props?.items
    const path = isRecord(items) && typeof items.$bind === 'string' ? items.$bind : undefined
    const source = path && !path.includes('.') ? env.get(path) : undefined
    inner = new Map(env).set(as, source?.many ? { entity: source.entity, many: false } : null)
  }
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
      const as = node.type === 'List' ? node.props?.as : undefined
      const items = node.props?.items
      const path = isRecord(items) && typeof items.$bind === 'string' ? items.$bind : undefined
      const source = path && !path.includes('.') ? scope.get(path) : undefined
      if (typeof as === 'string' && source?.many) scan.lists.push({ entity: source.entity, use: { ...base, via: 'list', where: node.id, node: node.id, as } })
    })
  }
  return scan
}

/** Whether `value` holds `name` the way an action's steps name a field: as a key, or as the `$input` they read. */
const namesField = (value: unknown, name: string): boolean => {
  if (!isRecord(value)) return Array.isArray(value) && value.some(entry => namesField(entry, name))
  return Object.hasOwn(value, name) || value.$input === name || Object.values(value).some(entry => namesField(entry, name))
}

/** The uses, each once (the same place in the same way is one use). */
const distinct = (uses: ArtifactUse[]): ArtifactUse[] => [...new Map(uses.map(use => [JSON.stringify(use), use])).values()]

/** The collection's own queries, actions and repositories: what `entity_delete` takes along. */
const ownedBy = (model: Model, entityId: string) => {
  const modules = Object.values(model.modules)
  const repositories = modules.flatMap(mod => mod.repositories).filter(repository => repository.entity === entityId)
  const repositoryIds = new Set(repositories.map(repository => repository.id))
  return {
    repositories,
    queries: modules.flatMap(mod => mod.queries).filter(query => query.from === entityId),
    actions: modules.flatMap(mod => mod.actions).filter(action => action.input.entity === entityId || action.output?.entity === entityId
      || action.steps.some(step => typeof step.repository === 'string' && repositoryIds.has(step.repository)))
  }
}

/**
 * Who uses each field of collection `entityId`, by field name, in one scan: the nodes, computed values and SEO fields that bind it
 * (through the alias a page reads a query as, the entity property of a component, or the item name of a List), the queries
 * that filter or order by it, the actions that pick it (that one `follows` the field) or set it in their steps, the form fields
 * that hold its id, and the route parameter it validates.
 */
export const fieldUsesIndex = (model: Model, entityId: string): Map<string, ArtifactUse[]> => {
  const index = new Map<string, ArtifactUse[]>()
  const entity = Object.values(model.modules).flatMap(mod => mod.entities).find(entry => entry.id === entityId)
  if (!entity) return index
  const add = (field: string, use: ArtifactUse) => index.set(field, [...index.get(field) ?? [], use])

  for (const { entity: of, field, use } of scanBindings(model).binds) if (of === entityId) add(field, use)

  const { queries, actions } = ownedBy(model, entityId)
  for (const query of queries) {
    const base = { kind: 'query', id: query.id, name: query.name } as const
    if (query.where) add(query.where.field, { ...base, via: 'where', where: 'where' })
    for (const order of query.orderBy ?? []) add(order.field, { ...base, via: 'orderBy', where: 'orderBy' })
  }
  for (const action of actions) {
    const base = { kind: 'action', id: action.id, name: action.name } as const
    for (const name of action.input.pick ?? []) add(name, { ...base, via: 'pick', where: 'input', follows: true })
    for (const step of action.steps) {
      const { set, ...rest } = step as Record<string, unknown>
      for (const name of isRecord(set) ? Object.keys(set) : []) add(name, { ...base, via: 'set', where: 'steps' })
      for (const field of entity.fields) {
        if (namesField(Object.values(rest), field.name) || (isRecord(set) && namesField(Object.values(set), field.name))) add(field.name, { ...base, via: 'step', where: 'steps' })
      }
    }
    for (const field of entity.fields) {
      if (action.errors.some(error => error.message.includes(`{${field.name}}`))) add(field.name, { ...base, via: 'errors', where: 'errors' })
    }
  }
  for (const field of entity.fields) {
    for (const use of idUses(model, new Set([field.id]))) add(field.name, use.via === 'props' ? { ...use, via: 'field' } : use)
  }
  return new Map([...index].map(([field, uses]) => [field, distinct(uses)]))
}

/** Who uses field `fieldName` of collection `entityId`: see `fieldUsesIndex`. */
export const fieldUsesOf = (model: Model, entityId: string, fieldName: string): ArtifactUse[] => fieldUsesIndex(model, entityId).get(fieldName) ?? []

/**
 * Who uses collection `entityId`: the pages, components and layouts that read the queries over it or run its actions (each use
 * says the query or action it goes `by`), the Lists that show its rows, the forms and form fields, the components with a
 * property for it, and the actions on it. What the module takes along when the collection is deleted, its own actions,
 * `follows` it: only the rest stops a delete.
 */
export const entityUsesOf = (model: Model, entityId: string): ArtifactUse[] => {
  const entity = Object.values(model.modules).flatMap(mod => mod.entities).find(entry => entry.id === entityId)
  if (!entity) return []
  const { repositories, queries, actions } = ownedBy(model, entityId)
  const own = new Set(actions.map(action => action.id))
  const uses: ArtifactUse[] = []
  for (const id of [...queries.map(query => query.id), ...actions.map(action => action.id)]) uses.push(...usesOf(model, id).map(use => ({ ...use, by: id })))
  for (const id of [entityId, ...repositories.map(repository => repository.id)]) uses.push(...usesOf(model, id))
  uses.push(...scanBindings(model).lists.filter(list => list.entity === entityId).map(list => list.use))
  for (const use of idUses(model, new Set(entity.fields.map(field => field.id)))) if (use.via === 'props') uses.push({ ...use, via: 'field' })
  return distinct(uses.map(use => use.kind === 'action' && own.has(use.id) ? { ...use, follows: true as const } : use))
}
