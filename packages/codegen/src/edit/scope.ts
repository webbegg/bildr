import type { Model } from '../model/load.ts'
import type { EntityFile, ModelNode, PageFile, QueryFile, Value } from '../model/schemas.ts'

/**
 * The names a node can bind (`$bind`, `$template`; P5), the way the generator resolves
 * them: the items of the Lists around it, then what the page uses (queries, state,
 * actions, computed values), a component's properties or a layout's variables, and
 * `site`. The inspector's binding pickers list `bindingPaths(bindingScope(...))`.
 */

export interface ScopeName {
  name: string
  source: 'item' | 'query' | 'state' | 'action' | 'computed' | 'prop' | 'layout' | 'site'
  /** What can follow the name (`post.title`): an entity's fields, a state's fields, an action's `pending` and `error`. */
  fields: string[]
  /** A list of records (`items.length` reads, a List repeats over it). */
  many: boolean
  /** The entity its records are of, when known. */
  entity?: string
}

const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

const entities = (model: Model): EntityFile[] => Object.values(model.modules).flatMap(mod => mod.entities)

/** The names a row of an entity has: its key and fields, and the timestamps it keeps. */
export const entityFieldNames = (entity: EntityFile): string[] => [...new Set(['id', ...entity.fields.map(field => field.name), ...(entity.timestamps ? ['createdAt', 'updatedAt'] : [])])]

/** The nodes from `root` down to node `id`, inclusive (empty when it isn't in the tree). */
const chainTo = (root: ModelNode, id: string): ModelNode[] => {
  if (root.id === id) return [root]
  for (const child of root.children ?? []) {
    const chain = chainTo(child, id)
    if (chain.length) return [root, ...chain]
  }
  return []
}

const queryOf = (model: Model, id: string): QueryFile | undefined => Object.values(model.modules).flatMap(mod => mod.queries).find(query => query.id === id)

/** The query a page alias reads, through computed values (`then`, then `else`): the first that resolves. */
export const queryBehind = (model: Model, page: PageFile, alias: string, seen = new Set<string>()): QueryFile | undefined => {
  if (seen.has(alias)) return undefined
  seen.add(alias)
  const use = page.uses?.queries?.find(entry => entry.as === alias)
  if (use) return queryOf(model, use.query)
  const computed = (page.uses?.computed ?? []).find(entry => entry.as === alias) as { then?: Value, else?: Value } | undefined
  for (const branch of [computed?.then, computed?.else]) {
    if (isObject(branch) && typeof branch.$bind === 'string') {
      const found = queryBehind(model, page, branch.$bind.split('.')[0]!, seen)
      if (found) return found
    }
  }
  return undefined
}

const treeOf = (model: Model, file: string) => {
  for (const mod of Object.values(model.modules)) {
    const page = mod.pages.find(entry => entry.id === file)
    if (page) return { kind: 'page' as const, root: page.root, page }
    const component = mod.components.find(entry => entry.id === file)
    if (component) return { kind: 'component' as const, root: component.root, component }
  }
  const layout = model.layouts.find(entry => entry.id === file)
  return layout ? { kind: 'layout' as const, root: layout.root, layout } : undefined
}

/**
 * What node `nodeId` of `file` (a page, component or layout id) can bind; without a node, what the
 * file offers at its root. `within`: the names for something put inside the node (a List's own item
 * name counts then; for the List itself, it doesn't).
 */
export function bindingScope(model: Model, file: string, nodeId?: string, options: { within?: boolean } = {}): ScopeName[] {
  const tree = treeOf(model, file)
  if (!tree) return []
  const scope: ScopeName[] = []
  const site: ScopeName = { name: 'site', source: 'site', fields: ['name', 'description'], many: false }

  if (tree.kind === 'page') {
    const { page } = tree
    const chain = nodeId ? chainTo(page.root, nodeId) : []
    const inside = options.within ? chain : chain.slice(0, -1)
    // Closest List first: its item name shadows an outer one.
    for (const node of [...inside].reverse()) {
      if (node.type !== 'List' || typeof node.props?.as !== 'string') continue
      const items = node.props.items
      const root = isObject(items) && typeof items.$bind === 'string' ? items.$bind.split('.')[0]! : undefined
      const query = root ? queryBehind(model, page, root) : undefined
      const entity = query ? entities(model).find(entry => entry.id === query.from) : undefined
      scope.push({ name: node.props.as, source: 'item', fields: entity ? entityFieldNames(entity) : [], many: false, ...(entity ? { entity: entity.id } : {}) })
    }
    for (const use of page.uses?.queries ?? []) {
      const query = queryOf(model, use.query)
      const entity = query ? entities(model).find(entry => entry.id === query.from) : undefined
      scope.push({ name: use.as, source: 'query', fields: entity ? entityFieldNames(entity) : [], many: query?.result !== 'one', ...(entity ? { entity: entity.id } : {}) })
    }
    for (const use of page.uses?.computed ?? []) {
      const query = queryBehind(model, page, use.as)
      const entity = query ? entities(model).find(entry => entry.id === query.from) : undefined
      scope.push({ name: use.as, source: 'computed', fields: entity ? entityFieldNames(entity) : [], many: !!query && query.result !== 'one', ...(entity ? { entity: entity.id } : {}) })
    }
    for (const use of page.uses?.state ?? []) {
      const state = Object.values(model.modules).flatMap(mod => mod.state).find(entry => entry.id === use.state)
      scope.push({ name: use.as, source: 'state', fields: state?.fields.map(field => field.name) ?? [], many: state?.shape === 'many' })
    }
    for (const use of page.uses?.actions ?? []) scope.push({ name: use.as, source: 'action', fields: ['pending', 'error'], many: false })
    scope.push(site)
    return scope
  }

  if (tree.kind === 'component') {
    for (const property of tree.component.properties) {
      if (property.kind === 'slot') continue
      const entity = property.kind === 'entity' ? entities(model).find(entry => entry.id === property.entity) : undefined
      const pick = property.pick?.length ? property.pick : entity ? entityFieldNames(entity) : []
      scope.push({ name: property.name, source: 'prop', fields: pick, many: property.many === true, ...(entity ? { entity: entity.id } : {}) })
    }
    scope.push(site)
    return scope
  }

  scope.push({ name: 'layout', source: 'layout', fields: (tree.layout.variables ?? []).map(variable => variable.name), many: false }, site)
  return scope
}

/**
 * The paths a binding picks from `scope`: each name, its fields, and `length` of a list. With `leaves`,
 * only what reads as a value (for text, an image's source…): a record's fields, a list's `length`, a lone value.
 */
export const bindingPaths = (scope: ScopeName[], options: { leaves?: boolean } = {}): string[] => scope.flatMap((entry) => {
  const parts = entry.many ? [`${entry.name}.length`] : entry.fields.map(field => `${entry.name}.${field}`)
  if (options.leaves) return parts.length ? parts : [entry.name]
  return [...(entry.source === 'layout' ? [] : [entry.name]), ...parts]
})
