import { defaultTheme, ThemePatchSchema } from '../design/theme'
import type { ThemePatch } from '../design/theme'
import { isStyleTokenKey, styleTokenProblem } from '../design/tokens'
import { getComponent, INSTANCE_TYPE, isContainerType } from './components'
import type { PropValue } from './components'
import { z } from 'zod'
import { ApiPathSchema, CollectionSchema, componentProblems, ComponentDefinitionSchema, CONNECTIONS_MAX, ConnectionSchema, FieldSchema, FieldTypeSchema, instanceProblems, nodeTreeProblems, PageSchema, PropertyBindingSchema, PropertyDefSchema, propValueProblem, SlugSchema, VariantSchema } from './schema'
import type { ApiHeader, Collection, CollectionSource, ComponentDefinition, Connection, DocNode, Field, FieldType, Page, Project, PropertyBinding, PropertyDef, Variant } from './schema'
import { containsNode, findNode, findParent, walk } from './tree'
import { componentUsages } from './usages'

/**
 * The tree a node operation edits: a page, or (with `componentId`) a
 * component definition, whose node ids are a namespace of their own.
 */
export type TreeRef = { pageId: string, componentId?: undefined } | { componentId: string, pageId?: undefined }

/**
 * The closed set of document edits. Every action that changes a project
 * lowers to these operations; each one returns its exact inverse, which is
 * what the undo history stores (the Stacki inverse-splice idea, on JSON).
 */
export type Operation
  = | ({ op: 'insert', parentId: string, index: number, node: DocNode } & TreeRef)
    | ({ op: 'remove', nodeId: string } & TreeRef)
    | ({ op: 'move', nodeId: string, parentId: string, index: number } & TreeRef)
    | ({ op: 'setProps', nodeId: string, props: Record<string, PropValue | null> } & TreeRef)
    | ({ op: 'setStyle', nodeId: string, style: Record<string, string | null> } & TreeRef)
    | { op: 'addPage', index: number, page: Page }
    | { op: 'removePage', pageId: string }
    | { op: 'updatePage', pageId: string, name?: string, slug?: string }
    | { op: 'setTheme', theme: ThemePatch }
    | { op: 'addCollection', index: number, collection: Collection }
    | { op: 'removeCollection', collectionId: string }
    | { op: 'updateCollection', collectionId: string, name?: string, slug?: string, publicRead?: boolean, publicCreate?: boolean }
    | { op: 'addField', collectionId: string, index: number, field: Field }
    | { op: 'removeField', collectionId: string, key: string }
    | { op: 'updateField', collectionId: string, key: string, label?: string, type?: FieldType, path?: string | null }
    | { op: 'moveField', collectionId: string, key: string, index: number }
    | { op: 'setSource', collectionId: string, source: CollectionSource, fields: Field[] }
    | { op: 'addConnection', index: number, connection: Connection }
    | { op: 'removeConnection', connectionId: string }
    | { op: 'updateConnection', connectionId: string, name?: string, baseUrl?: string, headers?: ApiHeader[] }
    | { op: 'addComponent', index: number, component: ComponentDefinition }
    | { op: 'removeComponent', componentId: string }
    | { op: 'updateComponent', componentId: string, name?: string }
    | { op: 'addProperty', componentId: string, index: number, property: PropertyDef }
    | { op: 'removeProperty', componentId: string, propertyId: string }
    | { op: 'updateProperty', componentId: string, propertyId: string, name?: string, default?: PropValue | null, bindings?: PropertyBinding[] }
    | { op: 'addVariant', componentId: string, index: number, variant: Variant }
    | { op: 'removeVariant', componentId: string, variantId: string }
    /** Sparse: a null value, or the primary variant's own value, removes that override. */
    | { op: 'setOverride', componentId: string, variantId: string, nodeId: string, props?: Record<string, PropValue | null>, style?: Record<string, string | null> }

export type OperationErrorCode = 'not_found' | 'invalid' | 'forbidden'

export class OperationError extends Error {
  constructor(readonly code: OperationErrorCode, message: string) {
    super(message)
    this.name = 'OperationError'
  }
}

function fail(code: OperationErrorCode, message: string): never {
  throw new OperationError(code, message)
}

function getPage(project: Project, pageId: string): Page {
  return project.pages.find(p => p.id === pageId) ?? fail('not_found', `Page "${pageId}" not found`)
}

function getDefinition(project: Project, componentId: string): ComponentDefinition {
  return project.components.find(c => c.id === componentId) ?? fail('not_found', `Component "${componentId}" not found`)
}

interface Tree {
  ref: TreeRef
  root: DocNode
  /** `page "Home"` or `component "Card"`, for messages. */
  where: string
  rootName: string
  /** The ids a new node must not reuse. */
  ids: () => Set<string>
}

function treeIds(root: DocNode): Set<string> {
  const ids = new Set<string>()
  walk(root, n => ids.add(n.id))
  return ids
}

function getTree(project: Project, ref: TreeRef): Tree {
  if (ref.componentId !== undefined) {
    const def = getDefinition(project, ref.componentId)
    return { ref: { componentId: def.id }, root: def.root, where: `component "${def.name}"`, rootName: 'component root', ids: () => treeIds(def.root) }
  }
  const page = getPage(project, ref.pageId)
  return { ref: { pageId: page.id }, root: page.root, where: `page "${page.name}"`, rootName: 'page root', ids: () => projectIds(project) }
}

function getNode(tree: Tree, nodeId: string): DocNode {
  return findNode(tree.root, nodeId) ?? fail('not_found', `Node "${nodeId}" not found on ${tree.where}`)
}

function getContainer(tree: Tree, parentId: string): DocNode {
  const parent = getNode(tree, parentId)
  if (!isContainerType(parent.type)) fail('invalid', `"${parent.type}" cannot contain children`)
  return parent
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : length, length))
}

function projectIds(project: Project): Set<string> {
  const ids = new Set<string>()
  for (const page of project.pages) walk(page.root, n => ids.add(n.id))
  return ids
}

/** `parent` is where `node` goes: an Instance parent is checked with it, since it decides which SlotFills fit. */
function assertNewTree(project: Project, node: DocNode, isRoot = false, ids = projectIds(project), parent?: DocNode): void {
  const placed = parent?.type === INSTANCE_TYPE ? { ...parent, children: [...parent.children, node] } : node
  const problems = [...nodeTreeProblems(node, ids, isRoot), ...instanceProblems(placed, project.components)]
  if (problems.length) fail('invalid', problems.join('; '))
}

function getProperty(def: ComponentDefinition, propertyId: string): PropertyDef {
  return def.properties.find(p => p.id === propertyId) ?? fail('not_found', `Property "${propertyId}" not found in "${def.name}"`)
}

function getVariant(def: ComponentDefinition, variantId: string): Variant {
  return def.variants.find(v => v.id === variantId) ?? fail('not_found', `Variant "${variantId}" not found in "${def.name}"`)
}

/** Instances and definitions that the components no longer fit (bindings, values, slots, cycles). */
function componentDocumentProblems(project: Project): string[] {
  return [
    ...componentProblems(project.components).map(p => p.message),
    ...project.pages.flatMap(page => instanceProblems(page.root, project.components))
  ]
}

/** Operations that change a component definition, so its instances are checked again afterwards. */
function editsComponents(op: Operation): boolean {
  return op.op === 'addComponent' || ('componentId' in op && op.componentId !== undefined)
}

function componentInUseMessage(name: string, usages: { where: string, nodeId: string }[]): string {
  const list = usages.map(u => `${u.where} (${u.nodeId})`).join(', ')
  return `"${name}" is used by ${usages.length} instance${usages.length === 1 ? '' : 's'}: ${list}. Delete them first, or pass force: true to delete them too`
}

function assertUniqueSlug(project: Project, slug: string, exceptPageId?: string): void {
  if (!SlugSchema.safeParse(slug).success) fail('invalid', `Invalid page slug "${slug}"`)
  if (project.pages.some(p => p.slug === slug && p.id !== exceptPageId)) fail('invalid', `A page with slug "${slug}" already exists`)
}

function issues(error: z.ZodError): string {
  return error.issues.map(i => i.message).join('; ')
}

function getCollection(project: Project, collectionId: string): Collection {
  return project.collections.find(c => c.id === collectionId) ?? fail('not_found', `Collection "${collectionId}" not found`)
}

function getField(collection: Collection, key: string): Field {
  return collection.fields.find(f => f.key === key) ?? fail('not_found', `Field "${key}" not found in "${collection.name}"`)
}

function getConnection(project: Project, connectionId: string): Connection {
  return project.connections.find(c => c.id === connectionId) ?? fail('not_found', `Connection "${connectionId}" not found`)
}

function assertSourceConnection(project: Project, source: CollectionSource): void {
  if (source.type === 'connection') getConnection(project, source.connectionId)
}

function assertUniqueCollectionSlug(project: Project, slug: string, exceptId?: string): void {
  if (!SlugSchema.safeParse(slug).success) fail('invalid', `Invalid collection slug "${slug}"`)
  if (project.collections.some(c => c.slug === slug && c.id !== exceptId)) fail('invalid', `A collection with slug "${slug}" already exists`)
}

/**
 * Applies `op` to `project` in place and returns the operation that undoes
 * it. An edit to a component definition is checked against every instance
 * afterwards and rolled back when they no longer fit.
 */
export function applyOperation(project: Project, op: Operation): Operation {
  if (!editsComponents(op)) return apply(project, op)
  const before = structuredClone(project.components)
  const inverse = apply(project, op)
  const problems = componentDocumentProblems(project)
  if (problems.length) {
    project.components = before
    fail('invalid', problems.join('; '))
  }
  return inverse
}

function apply(project: Project, op: Operation): Operation {
  switch (op.op) {
    case 'insert': {
      const tree = getTree(project, op)
      const parent = getContainer(tree, op.parentId)
      assertNewTree(project, op.node, false, tree.ids(), parent)
      parent.children.splice(clampIndex(op.index, parent.children.length), 0, structuredClone(op.node))
      return { op: 'remove', ...tree.ref, nodeId: op.node.id }
    }
    case 'remove': {
      const tree = getTree(project, op)
      const location = findParent(tree.root, op.nodeId)
      if (!location) fail(op.nodeId === tree.root.id ? 'forbidden' : 'not_found', op.nodeId === tree.root.id ? `The ${tree.rootName} cannot be removed` : `Node "${op.nodeId}" not found`)
      const [node] = location.parent.children.splice(location.index, 1)
      return { op: 'insert', ...tree.ref, parentId: location.parent.id, index: location.index, node: node! }
    }
    case 'move': {
      const tree = getTree(project, op)
      const location = findParent(tree.root, op.nodeId)
      if (!location) fail(op.nodeId === tree.root.id ? 'forbidden' : 'not_found', op.nodeId === tree.root.id ? `The ${tree.rootName} cannot be moved` : `Node "${op.nodeId}" not found`)
      const target = getContainer(tree, op.parentId)
      const node = location.parent.children[location.index]!
      if (containsNode(node, target.id)) fail('invalid', 'A node cannot be moved into itself or its descendants')
      location.parent.children.splice(location.index, 1)
      target.children.splice(clampIndex(op.index, target.children.length), 0, node)
      return { op: 'move', ...tree.ref, nodeId: node.id, parentId: location.parent.id, index: location.index }
    }
    case 'setProps': {
      const tree = getTree(project, op)
      const node = getNode(tree, op.nodeId)
      if (node.type === INSTANCE_TYPE) {
        // Instance props are its component, variant and property values: check them against the definition.
        const props = { ...node.props }
        for (const [name, value] of Object.entries(op.props)) {
          if (value === null) Reflect.deleteProperty(props, name)
          else props[name] = value
        }
        const problems = instanceProblems({ ...node, props, children: [] }, project.components)
        if (problems.length) fail('invalid', problems.join('; '))
      } else {
        const def = getComponent(node.type)
        for (const [name, value] of Object.entries(op.props)) {
          const propDef = def?.props.find(p => p.name === name)
          if (!propDef) fail('invalid', `"${node.type}" has no prop "${name}"`)
          if (value !== null) {
            const problem = propValueProblem(propDef, value)
            if (problem) fail('invalid', problem)
          }
        }
      }
      const previous: Record<string, PropValue | null> = {}
      for (const [name, value] of Object.entries(op.props)) {
        previous[name] = name in node.props ? node.props[name]! : null
        if (value === null) Reflect.deleteProperty(node.props, name)
        else node.props[name] = value
      }
      return { op: 'setProps', ...tree.ref, nodeId: node.id, props: previous }
    }
    case 'setStyle': {
      const tree = getTree(project, op)
      const node = getNode(tree, op.nodeId)
      for (const [key, value] of Object.entries(op.style)) {
        if (value === null || value === '') {
          // An unknown key's problem is about the key, whatever the value.
          if (!isStyleTokenKey(key)) fail('invalid', styleTokenProblem(key, '')!)
        } else {
          const problem = styleTokenProblem(key, value)
          if (problem) fail('invalid', problem)
        }
      }
      const previous: Record<string, string | null> = {}
      for (const [key, value] of Object.entries(op.style)) {
        previous[key] = node.style[key] ?? null
        if (value === null || value === '') Reflect.deleteProperty(node.style, key)
        else node.style[key] = value
      }
      return { op: 'setStyle', ...tree.ref, nodeId: node.id, style: previous }
    }
    case 'addPage': {
      if (!PageSchema.safeParse(op.page).success) fail('invalid', 'Invalid page')
      assertUniqueSlug(project, op.page.slug)
      if (project.pages.some(p => p.id === op.page.id)) fail('invalid', `Duplicate page id "${op.page.id}"`)
      assertNewTree(project, op.page.root, true)
      project.pages.splice(clampIndex(op.index, project.pages.length), 0, structuredClone(op.page))
      return { op: 'removePage', pageId: op.page.id }
    }
    case 'removePage': {
      const index = project.pages.findIndex(p => p.id === op.pageId)
      if (index < 0) fail('not_found', `Page "${op.pageId}" not found`)
      if (project.pages.length === 1) fail('forbidden', 'A project needs at least one page')
      const [page] = project.pages.splice(index, 1)
      return { op: 'addPage', index, page: page! }
    }
    case 'updatePage': {
      const page = getPage(project, op.pageId)
      if (op.slug !== undefined) assertUniqueSlug(project, op.slug, page.id)
      if (op.name !== undefined && !op.name.trim()) fail('invalid', 'Page name cannot be empty')
      const inverse: Operation = { op: 'updatePage', pageId: page.id }
      if (op.name !== undefined) {
        inverse.name = page.name
        page.name = op.name.trim()
      }
      if (op.slug !== undefined) {
        inverse.slug = page.slug
        page.slug = op.slug
      }
      return inverse
    }
    case 'setTheme': {
      const parsed = ThemePatchSchema.safeParse(op.theme)
      if (!parsed.success) fail('invalid', `Invalid theme: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
      const { colors, font, radius, spacing } = parsed.data
      const theme = project.theme ?? defaultTheme()
      const inverse: ThemePatch = {}
      if (colors) {
        inverse.colors = {}
        for (const [name, value] of Object.entries(colors) as [keyof typeof colors, string][]) {
          inverse.colors[name] = theme.colors[name]
          theme.colors[name] = value
        }
      }
      if (font !== undefined) {
        inverse.font = theme.font
        theme.font = font
      }
      if (radius !== undefined) {
        inverse.radius = theme.radius
        theme.radius = radius
      }
      if (spacing !== undefined) {
        inverse.spacing = theme.spacing
        theme.spacing = spacing
      }
      project.theme = theme
      return { op: 'setTheme', theme: inverse }
    }
    case 'addCollection': {
      const parsed = CollectionSchema.safeParse(op.collection)
      if (!parsed.success) fail('invalid', `Invalid collection: ${issues(parsed.error)}`)
      if (project.collections.some(c => c.id === op.collection.id)) fail('invalid', `Duplicate collection id "${op.collection.id}"`)
      assertUniqueCollectionSlug(project, parsed.data.slug)
      assertSourceConnection(project, parsed.data.source)
      project.collections.splice(clampIndex(op.index, project.collections.length), 0, parsed.data)
      return { op: 'removeCollection', collectionId: parsed.data.id }
    }
    case 'removeCollection': {
      const index = project.collections.findIndex(c => c.id === op.collectionId)
      if (index < 0) fail('not_found', `Collection "${op.collectionId}" not found`)
      const [collection] = project.collections.splice(index, 1)
      return { op: 'addCollection', index, collection: collection! }
    }
    case 'updateCollection': {
      const collection = getCollection(project, op.collectionId)
      if (op.slug !== undefined) assertUniqueCollectionSlug(project, op.slug, collection.id)
      if (op.name !== undefined && !op.name.trim()) fail('invalid', 'Collection name cannot be empty')
      const inverse: Extract<Operation, { op: 'updateCollection' }> = { op: 'updateCollection', collectionId: collection.id }
      if (op.name !== undefined) {
        inverse.name = collection.name
        collection.name = op.name.trim()
      }
      if (op.slug !== undefined) {
        inverse.slug = collection.slug
        collection.slug = op.slug
      }
      if (op.publicRead !== undefined) {
        inverse.publicRead = collection.publicRead
        collection.publicRead = op.publicRead
      }
      if (op.publicCreate !== undefined) {
        inverse.publicCreate = collection.publicCreate
        collection.publicCreate = op.publicCreate
      }
      return inverse
    }
    case 'addField': {
      const collection = getCollection(project, op.collectionId)
      const parsed = FieldSchema.safeParse(op.field)
      if (!parsed.success) fail('invalid', `Invalid field: ${issues(parsed.error)}`)
      if (collection.fields.some(f => f.key === parsed.data.key)) fail('invalid', `Field "${parsed.data.key}" already exists in "${collection.name}"`)
      collection.fields.splice(clampIndex(op.index, collection.fields.length), 0, parsed.data)
      return { op: 'removeField', collectionId: collection.id, key: parsed.data.key }
    }
    case 'removeField': {
      const collection = getCollection(project, op.collectionId)
      const index = collection.fields.indexOf(getField(collection, op.key))
      const [field] = collection.fields.splice(index, 1)
      return { op: 'addField', collectionId: collection.id, index, field: field! }
    }
    case 'updateField': {
      const collection = getCollection(project, op.collectionId)
      const field = getField(collection, op.key)
      if (op.type !== undefined && !FieldTypeSchema.safeParse(op.type).success) fail('invalid', `Unknown field type "${op.type}"`)
      if (op.label !== undefined && !op.label.trim()) fail('invalid', 'Field label cannot be empty')
      if (op.path !== undefined && op.path !== null) {
        const path = ApiPathSchema.safeParse(op.path)
        if (!path.success) fail('invalid', `Invalid path "${op.path}": ${issues(path.error)}`)
      }
      const inverse: Extract<Operation, { op: 'updateField' }> = { op: 'updateField', collectionId: collection.id, key: field.key }
      if (op.label !== undefined) {
        inverse.label = field.label
        field.label = op.label.trim()
      }
      if (op.type !== undefined) {
        inverse.type = field.type
        field.type = op.type
      }
      if (op.path !== undefined) {
        inverse.path = field.path ?? null
        if (op.path === null) Reflect.deleteProperty(field, 'path')
        else field.path = op.path
      }
      return inverse
    }
    case 'moveField': {
      const collection = getCollection(project, op.collectionId)
      const from = collection.fields.indexOf(getField(collection, op.key))
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= collection.fields.length) {
        fail('invalid', `Index ${op.index} is out of bounds: "${collection.name}" has ${collection.fields.length} fields`)
      }
      const [field] = collection.fields.splice(from, 1)
      collection.fields.splice(op.index, 0, field!)
      return { op: 'moveField', collectionId: collection.id, key: op.key, index: from }
    }
    case 'setSource': {
      const collection = getCollection(project, op.collectionId)
      const parsed = CollectionSchema.safeParse({ ...collection, source: op.source, fields: op.fields })
      if (!parsed.success) fail('invalid', `Invalid collection: ${issues(parsed.error)}`)
      assertSourceConnection(project, parsed.data.source)
      const inverse: Operation = { op: 'setSource', collectionId: collection.id, source: collection.source, fields: collection.fields }
      collection.source = parsed.data.source
      collection.fields = parsed.data.fields
      return inverse
    }
    case 'addConnection': {
      const parsed = ConnectionSchema.safeParse(op.connection)
      if (!parsed.success) fail('invalid', `Invalid connection: ${issues(parsed.error)}`)
      if (project.connections.some(c => c.id === parsed.data.id)) fail('invalid', `Duplicate connection id "${parsed.data.id}"`)
      if (project.connections.length >= CONNECTIONS_MAX) fail('forbidden', `A project can have at most ${CONNECTIONS_MAX} connections`)
      project.connections.splice(clampIndex(op.index, project.connections.length), 0, parsed.data)
      return { op: 'removeConnection', connectionId: parsed.data.id }
    }
    case 'removeConnection': {
      const connection = getConnection(project, op.connectionId)
      const users = project.collections.filter(c => c.source.type === 'connection' && c.source.connectionId === connection.id)
      if (users.length) fail('forbidden', `"${connection.name}" is used by ${users.map(c => c.name).join(', ')}; delete those collections first`)
      const index = project.connections.indexOf(connection)
      project.connections.splice(index, 1)
      return { op: 'addConnection', index, connection }
    }
    case 'updateConnection': {
      const connection = getConnection(project, op.connectionId)
      const patch = Object.fromEntries(Object.entries({ name: op.name, baseUrl: op.baseUrl, headers: op.headers }).filter(([, value]) => value !== undefined))
      const parsed = ConnectionSchema.safeParse({ ...connection, ...patch })
      if (!parsed.success) fail('invalid', `Invalid connection: ${issues(parsed.error)}`)
      const inverse: Extract<Operation, { op: 'updateConnection' }> = { op: 'updateConnection', connectionId: connection.id }
      if (op.name !== undefined) inverse.name = connection.name
      if (op.baseUrl !== undefined) inverse.baseUrl = connection.baseUrl
      if (op.headers !== undefined) inverse.headers = connection.headers
      Object.assign(connection, parsed.data)
      return inverse
    }
    case 'addComponent': {
      const parsed = ComponentDefinitionSchema.safeParse(op.component)
      if (!parsed.success) fail('invalid', `Invalid component: ${issues(parsed.error)}`)
      project.components.splice(clampIndex(op.index, project.components.length), 0, parsed.data)
      return { op: 'removeComponent', componentId: parsed.data.id }
    }
    case 'removeComponent': {
      const def = getDefinition(project, op.componentId)
      const usages = componentUsages(project, def.id)
      if (usages.length) fail('forbidden', componentInUseMessage(def.name, usages))
      const index = project.components.indexOf(def)
      project.components.splice(index, 1)
      return { op: 'addComponent', index, component: def }
    }
    case 'updateComponent': {
      const def = getDefinition(project, op.componentId)
      const inverse: Extract<Operation, { op: 'updateComponent' }> = { op: 'updateComponent', componentId: def.id }
      if (op.name !== undefined) {
        if (!op.name.trim()) fail('invalid', 'Component name cannot be empty')
        inverse.name = def.name
        def.name = op.name.trim()
      }
      return inverse
    }
    case 'addProperty': {
      const def = getDefinition(project, op.componentId)
      const parsed = PropertyDefSchema.safeParse(op.property)
      if (!parsed.success) fail('invalid', `Invalid property: ${issues(parsed.error)}`)
      def.properties.splice(clampIndex(op.index, def.properties.length), 0, parsed.data)
      return { op: 'removeProperty', componentId: def.id, propertyId: parsed.data.id }
    }
    case 'removeProperty': {
      const def = getDefinition(project, op.componentId)
      const index = def.properties.indexOf(getProperty(def, op.propertyId))
      const [property] = def.properties.splice(index, 1)
      return { op: 'addProperty', componentId: def.id, index, property: property! }
    }
    case 'updateProperty': {
      const def = getDefinition(project, op.componentId)
      const property = getProperty(def, op.propertyId)
      const inverse: Extract<Operation, { op: 'updateProperty' }> = { op: 'updateProperty', componentId: def.id, propertyId: property.id }
      if (op.name !== undefined && !op.name.trim()) fail('invalid', 'Property name cannot be empty')
      const bindings = op.bindings === undefined ? undefined : z.array(PropertyBindingSchema).safeParse(op.bindings)
      if (bindings && !bindings.success) fail('invalid', `Invalid bindings: ${issues(bindings.error)}`)
      if (op.name !== undefined) {
        inverse.name = property.name
        property.name = op.name.trim()
      }
      if (op.default !== undefined) {
        inverse.default = property.default ?? null
        if (op.default === null) Reflect.deleteProperty(property, 'default')
        else property.default = op.default
      }
      if (bindings) {
        inverse.bindings = property.bindings
        property.bindings = bindings.data
      }
      return inverse
    }
    case 'addVariant': {
      const def = getDefinition(project, op.componentId)
      const parsed = VariantSchema.safeParse(op.variant)
      if (!parsed.success) fail('invalid', `Invalid variant: ${issues(parsed.error)}`)
      def.variants.splice(clampIndex(op.index, def.variants.length), 0, parsed.data)
      return { op: 'removeVariant', componentId: def.id, variantId: parsed.data.id }
    }
    case 'removeVariant': {
      const def = getDefinition(project, op.componentId)
      const index = def.variants.indexOf(getVariant(def, op.variantId))
      const [variant] = def.variants.splice(index, 1)
      return { op: 'addVariant', componentId: def.id, index, variant: variant! }
    }
    case 'setOverride': {
      const def = getDefinition(project, op.componentId)
      const variant = getVariant(def, op.variantId)
      const node = findNode(def.root, op.nodeId) ?? fail('not_found', `Node "${op.nodeId}" not found on component "${def.name}"`)
      const props = { ...variant.overrides[node.id]?.props }
      const style = { ...variant.overrides[node.id]?.style }
      const inverse: Extract<Operation, { op: 'setOverride' }> = { op: 'setOverride', componentId: def.id, variantId: variant.id, nodeId: node.id }
      if (op.props) {
        inverse.props = {}
        for (const [name, value] of Object.entries(op.props)) {
          inverse.props[name] = props[name] ?? null
          if (value === null || value === node.props[name]) Reflect.deleteProperty(props, name)
          else props[name] = value
        }
      }
      if (op.style) {
        inverse.style = {}
        for (const [key, value] of Object.entries(op.style)) {
          inverse.style[key] = style[key] ?? null
          if (value === null || value === '' || value === node.style[key]) Reflect.deleteProperty(style, key)
          else style[key] = value
        }
      }
      const override = { ...(Object.keys(props).length ? { props } : {}), ...(Object.keys(style).length ? { style } : {}) }
      if (Object.keys(override).length) variant.overrides[node.id] = override
      else Reflect.deleteProperty(variant.overrides, node.id)
      return inverse
    }
  }
}

/**
 * Applies `ops` all-or-nothing. On success `project` is updated in place and
 * the inverses come back in undo order; on failure it is left untouched.
 */
export function applyOperations(project: Project, ops: Operation[]): Operation[] {
  const draft = structuredClone(project)
  const inverses = ops.map(op => applyOperation(draft, op)).reverse()
  Object.assign(project, draft)
  return inverses
}
