import { CUSTOM_COLORS_MAX, customColorNames, CustomColorsPatchSchema, defaultTheme, ThemePatchSchema } from '../design/theme'
import type { CustomColorsPatch, ThemePatch } from '../design/theme'
import { isStyleTokenKey, styleTokenProblem } from '../design/tokens'
import { getComponent, INSTANCE_TYPE, isContainerType } from './components'
import type { PropValue } from './components'
import { z } from 'zod'
import { ApiPathSchema, CHILDREN_SLOT, CollectionSchema, componentProblems, ComponentDefinitionSchema, CONNECTIONS_MAX, ConnectionSchema, FieldSchema, FieldTypeSchema, instanceProblems, isStyleBinding, layoutProblems, LayoutSchema, LayoutSlotSchema, NODE_NAME_MAX, nodeTreeProblems, pageLayoutProblems, PageSchema, ProjectSchema, PropertyBindingSchema, PropertyDefSchema, propValueProblem, SlugSchema, styleKeyProblem, VariantSchema } from './schema'
import type { ApiHeader, Collection, CollectionSource, ComponentDefinition, Connection, DocNode, Field, FieldType, Layout, LayoutSlot, Page, Project, PropertyBinding, PropertyDef, Variant } from './schema'
import { containsNode, findNode, findParent, walk } from './tree'
import { componentUsages } from './usages'

/**
 * The tree a node operation edits: a page, or (with `componentId`) a
 * component definition, or (with `layoutId`) a layout; definitions and
 * layouts have node ids of their own.
 */
export type TreeRef
  = | { pageId: string, componentId?: undefined, layoutId?: undefined }
    | { componentId: string, pageId?: undefined, layoutId?: undefined }
    | { layoutId: string, pageId?: undefined, componentId?: undefined }

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
    /** A null (or empty) name, or `locked: false` / null, removes the field. */
    | ({ op: 'setNodeMeta', nodeId: string, name?: string | null, locked?: boolean | null } & TreeRef)
    | { op: 'addPage', index: number, page: Page }
    | { op: 'removePage', pageId: string }
    | { op: 'updatePage', pageId: string, name?: string, slug?: string }
    /** `custom` patches the theme's custom colours by name: a hex adds or changes one, null removes it. */
    | { op: 'setTheme', theme: ThemePatch, custom?: CustomColorsPatch }
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
    /** `index` moves the property in the list; a null `default`, `description` or `placeholder` (or `optional` false or null) removes it. */
    | ({ op: 'updateProperty', componentId: string, propertyId: string } & PropertyPatch)
    | { op: 'addVariant', componentId: string, index: number, variant: Variant }
    | { op: 'removeVariant', componentId: string, variantId: string }
    | { op: 'updateVariant', componentId: string, variantId: string, name?: string }
    /** Sparse: a null value, or the primary variant's own value, removes that override. */
    | { op: 'setOverride', componentId: string, variantId: string, nodeId: string, props?: Record<string, PropValue | null>, style?: Record<string, string | null>, unset?: string[] }
    | { op: 'addLayout', index: number, layout: Layout }
    /** Refused while pages use the layout; `layout_delete` detaches them first. */
    | { op: 'removeLayout', layoutId: string }
    | { op: 'updateLayout', layoutId: string, name?: string }
    | { op: 'addLayoutSlot', layoutId: string, index: number, slot: LayoutSlot }
    | { op: 'removeLayoutSlot', layoutId: string, slotId: string }
    | { op: 'updateLayoutSlot', layoutId: string, slotId: string, name?: string, nodeId?: string }
    | { op: 'addLayoutVariable', layoutId: string, index: number, variable: PropertyDef }
    | { op: 'removeLayoutVariable', layoutId: string, variableId: string }
    | ({ op: 'updateLayoutVariable', layoutId: string, variableId: string } & PropertyPatch)
    /** Sets both exactly: a null `layoutId` detaches the page, a missing or null `layoutValues` clears them. */
    | { op: 'setPageLayout', pageId: string, layoutId: string | null, layoutValues?: Record<string, PropValue> | null }
    /** Sparse, by variable id: a null value removes the page's value, so the default applies. */
    | { op: 'setLayoutValues', pageId: string, values: Record<string, PropValue | null> }

/** The changes `updateProperty` and `updateLayoutVariable` make to a property (or variable). */
export interface PropertyPatch {
  name?: string
  default?: PropValue | null
  description?: string | null
  optional?: boolean | null
  placeholder?: string | null
  bindings?: PropertyBinding[]
  /** The property's new position in its list. */
  index?: number
}

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

function getLayout(project: Project, layoutId: string): Layout {
  return project.layouts.find(l => l.id === layoutId) ?? fail('not_found', `Layout "${layoutId}" not found`)
}

function getSlot(layout: Layout, slotId: string): LayoutSlot {
  return layout.slots.find(s => s.id === slotId) ?? fail('not_found', `Slot "${slotId}" not found in "${layout.name}"`)
}

function getVariable(layout: Layout, variableId: string): PropertyDef {
  return layout.variables.find(v => v.id === variableId) ?? fail('not_found', `Variable "${variableId}" not found in "${layout.name}"`)
}

interface Tree {
  ref: TreeRef
  root: DocNode
  /** `page "Home"` or `component "Card"`, for messages. */
  where: string
  rootName: string
  /** The ids a new node must not reuse. */
  ids: () => Set<string>
  /** The root's SlotFill children fill its page's layout slots. */
  layoutFills: boolean
}

function usesLayout(project: Project, page: Page): boolean {
  return page.layoutId !== undefined && project.layouts.some(l => l.id === page.layoutId)
}

function treeIds(root: DocNode): Set<string> {
  const ids = new Set<string>()
  walk(root, n => ids.add(n.id))
  return ids
}

function getTree(project: Project, ref: TreeRef): Tree {
  if (ref.componentId !== undefined) {
    const def = getDefinition(project, ref.componentId)
    return { ref: { componentId: def.id }, root: def.root, where: `component "${def.name}"`, rootName: 'component root', ids: () => treeIds(def.root), layoutFills: false }
  }
  if (ref.layoutId !== undefined) {
    const layout = getLayout(project, ref.layoutId)
    return { ref: { layoutId: layout.id }, root: layout.root, where: `layout "${layout.name}"`, rootName: 'layout root', ids: () => treeIds(layout.root), layoutFills: false }
  }
  const page = getPage(project, ref.pageId)
  return { ref: { pageId: page.id }, root: page.root, where: `page "${page.name}"`, rootName: 'page root', ids: () => projectIds(project), layoutFills: usesLayout(project, page) }
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

/**
 * `parent` is where `node` goes: an Instance parent is checked with it, since it decides which SlotFills fit,
 * and so is a page root whose SlotFills fill layout slots (`layoutFills`). For a new page root, `layoutFills`
 * says whether its page uses a layout.
 */
function assertNewTree(project: Project, node: DocNode, isRoot = false, ids = projectIds(project), parent?: DocNode, layoutFills = false): void {
  const withParent = parent !== undefined && (parent.type === INSTANCE_TYPE || layoutFills)
  const placed = withParent ? { ...parent, children: [...parent.children, node] } : node
  const colors = customColorNames(project.theme)
  const problems = [...nodeTreeProblems(node, ids, isRoot, colors), ...instanceProblems(placed, project.components, layoutFills, colors)]
  if (problems.length) fail('invalid', problems.join('; '))
}

/**
 * Applies `patch` to `property` of `list` (a component's properties or a
 * layout's variables; `noun` and `owner` name them in messages) in place
 * and returns the patch that undoes it.
 */
function patchProperty(list: PropertyDef[], property: PropertyDef, patch: PropertyPatch, noun: 'Property' | 'Variable', owner: string): PropertyPatch {
  if (patch.name !== undefined && !patch.name.trim()) fail('invalid', `${noun} name cannot be empty`)
  const bindings = patch.bindings === undefined ? undefined : z.array(PropertyBindingSchema).safeParse(patch.bindings)
  if (bindings && !bindings.success) fail('invalid', `Invalid bindings: ${issues(bindings.error)}`)
  for (const field of ['description', 'placeholder'] as const) {
    const value = patch[field]
    if (value === undefined || value === null) continue
    const parsed = PropertyDefSchema.shape[field].safeParse(value)
    if (!parsed.success) fail('invalid', `Invalid ${field}: ${issues(parsed.error)}`)
  }
  const many = noun === 'Property' ? 'properties' : 'variables'
  if (patch.index !== undefined && (!Number.isInteger(patch.index) || patch.index < 0 || patch.index >= list.length)) {
    fail('invalid', `Index ${patch.index} is out of bounds: "${owner}" has ${list.length} ${many}`)
  }
  const inverse: PropertyPatch = {}
  if (patch.name !== undefined) {
    inverse.name = property.name
    property.name = patch.name.trim()
  }
  if (patch.default !== undefined) {
    inverse.default = property.default ?? null
    if (patch.default === null) Reflect.deleteProperty(property, 'default')
    else property.default = patch.default
  }
  for (const field of ['description', 'placeholder'] as const) {
    const value = patch[field]
    if (value === undefined) continue
    inverse[field] = property[field] ?? null
    if (value === null || value === '') Reflect.deleteProperty(property, field)
    else property[field] = value
  }
  if (patch.optional !== undefined) {
    inverse.optional = property.optional ?? null
    if (patch.optional) property.optional = true
    else Reflect.deleteProperty(property, 'optional')
  }
  if (bindings) {
    inverse.bindings = property.bindings
    property.bindings = bindings.data
  }
  if (patch.index !== undefined) {
    const from = list.indexOf(property)
    list.splice(from, 1)
    list.splice(patch.index, 0, property)
    inverse.index = from
  }
  return inverse
}

function getProperty(def: ComponentDefinition, propertyId: string): PropertyDef {
  return def.properties.find(p => p.id === propertyId) ?? fail('not_found', `Property "${propertyId}" not found in "${def.name}"`)
}

function getVariant(def: ComponentDefinition, variantId: string): Variant {
  return def.variants.find(v => v.id === variantId) ?? fail('not_found', `Variant "${variantId}" not found in "${def.name}"`)
}

/** Instances and definitions that the components no longer fit (bindings, values, slots, cycles). */
function componentDocumentProblems(project: Project): string[] {
  const colors = customColorNames(project.theme)
  return [
    ...componentProblems(project.components, colors).map(p => p.message),
    ...project.pages.flatMap(page => instanceProblems(page.root, project.components, usesLayout(project, page), colors)),
    ...project.layouts.flatMap(layout => instanceProblems(layout.root, project.components, false, colors))
  ]
}

/** Operations that change a component definition, so its instances are checked again afterwards. */
function editsComponents(op: Operation): boolean {
  return op.op === 'addComponent' || ('componentId' in op && op.componentId !== undefined)
}

const LAYOUT_OPS = new Set<Operation['op']>(['addLayout', 'removeLayout', 'updateLayout', 'addLayoutSlot', 'removeLayoutSlot', 'updateLayoutSlot', 'addLayoutVariable', 'removeLayoutVariable', 'updateLayoutVariable', 'setPageLayout', 'setLayoutValues'])

/**
 * Operations after which layouts and their pages are checked again: layout
 * edits (the tree, slots, variables), a page's layout or values, and nodes
 * placed at the root of a page that uses a layout (its SlotFills).
 */
function editsLayouts(project: Project, op: Operation): boolean {
  if (LAYOUT_OPS.has(op.op) || ('layoutId' in op && op.layoutId !== undefined)) return true
  if ((op.op !== 'insert' && op.op !== 'move') || op.pageId === undefined) return false
  const page = project.pages.find(p => p.id === op.pageId)
  return !!page && usesLayout(project, page)
}

/** Layout rules (`layoutProblems`) and each page's use of its layout; only page `pageId`'s when given. */
function layoutDocumentProblems(project: Project, pageId?: string): string[] {
  const pages = pageId === undefined ? project.pages : project.pages.filter(p => p.id === pageId)
  const colors = customColorNames(project.theme)
  return [
    ...(pageId === undefined ? layoutProblems(project.layouts, project.components, colors).map(p => p.message) : []),
    ...pages.flatMap((page) => {
      const layout = project.layouts.find(l => l.id === page.layoutId)
      return [...pageLayoutProblems(page, layout, colors).map(p => p.message), ...instanceProblems(page.root, project.components, layout !== undefined, colors)]
    })
  ]
}

/**
 * Refuses to remove theme colours (`removed`) that the document still uses:
 * on node styles, variant overrides, or values of style-bound properties.
 * `custom` is the theme's custom colours after the removal.
 */
function assertUnusedColors(project: Project, removed: string[], custom: Record<string, string>): void {
  if (!removed.length) return
  const result = ProjectSchema.safeParse({ ...project, theme: { ...project.theme, custom } })
  if (result.success) return
  const messages = result.error.issues.map(i => i.message)
  const used = removed.filter(name => messages.some(m => m.startsWith(`"${name}" is not a value of style token`)))
  const names = (used.length ? used : removed).map(name => `"${name}"`).join(', ')
  fail('invalid', `The theme colour${used.length > 1 ? 's' : ''} ${names} ${used.length > 1 ? 'are' : 'is'} still used: ${messages.slice(0, 3).join('; ')}. Change those styles first`)
}

function layoutInUseMessage(name: string, pages: Page[]): string {
  return `"${name}" is used by ${pages.length} page${pages.length === 1 ? '' : 's'}: ${pages.map(p => p.name).join(', ')}. Detach them first`
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
 * afterwards, and a layout edit against the layouts and their pages, and
 * rolled back when they no longer fit.
 */
export function applyOperation(project: Project, op: Operation): Operation {
  const components = editsComponents(op)
  const layouts = editsLayouts(project, op)
  if (!components && !layouts) return apply(project, op)
  const before = structuredClone({ components: project.components, layouts: project.layouts, pages: project.pages })
  const inverse = apply(project, op)
  // A page's own edits only affect that page's use of its layout.
  const pageId = 'pageId' in op ? op.pageId : undefined
  const problems = [...(components ? componentDocumentProblems(project) : []), ...(layouts ? layoutDocumentProblems(project, pageId) : [])]
  if (problems.length) {
    Object.assign(project, before)
    fail('invalid', problems.join('; '))
  }
  return inverse
}

function apply(project: Project, op: Operation): Operation {
  switch (op.op) {
    case 'insert': {
      const tree = getTree(project, op)
      const parent = getContainer(tree, op.parentId)
      assertNewTree(project, op.node, false, tree.ids(), parent, tree.layoutFills && parent === tree.root)
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
        const problems = instanceProblems({ ...node, props, children: [] }, project.components, false, customColorNames(project.theme))
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
      const colors = customColorNames(project.theme)
      for (const [key, value] of Object.entries(op.style)) {
        if (value === null || value === '') {
          // An unknown key's problem is about the key, whatever the value.
          if (!isStyleTokenKey(key)) fail('invalid', styleTokenProblem(key, '')!)
        } else {
          const problem = styleTokenProblem(key, value, colors)
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
    case 'setNodeMeta': {
      const tree = getTree(project, op)
      const node = getNode(tree, op.nodeId)
      const name = typeof op.name === 'string' ? op.name.trim() : op.name
      if (name && name.length > NODE_NAME_MAX) fail('invalid', `A layer name has at most ${NODE_NAME_MAX} characters`)
      const inverse: Extract<Operation, { op: 'setNodeMeta' }> = { op: 'setNodeMeta', ...tree.ref, nodeId: node.id }
      if (name !== undefined) {
        inverse.name = node.name ?? null
        if (name) node.name = name
        else Reflect.deleteProperty(node, 'name')
      }
      if (op.locked !== undefined) {
        inverse.locked = node.locked ?? null
        if (op.locked) node.locked = true
        else Reflect.deleteProperty(node, 'locked')
      }
      return inverse
    }
    case 'addPage': {
      if (!PageSchema.safeParse(op.page).success) fail('invalid', 'Invalid page')
      assertUniqueSlug(project, op.page.slug)
      if (project.pages.some(p => p.id === op.page.id)) fail('invalid', `Duplicate page id "${op.page.id}"`)
      assertNewTree(project, op.page.root, true, undefined, undefined, usesLayout(project, op.page))
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
      const customParsed = op.custom === undefined ? undefined : CustomColorsPatchSchema.safeParse(op.custom)
      for (const [result, prefix] of [[parsed, ''], [customParsed, 'custom.']] as const) {
        if (result && !result.success) fail('invalid', `Invalid theme: ${result.error.issues.map(i => `${prefix}${i.path.join('.')}: ${i.message}`).join('; ')}`)
      }
      const { colors, font, radius, spacing } = parsed.data!
      const custom = customParsed?.data
      const theme = project.theme ?? defaultTheme()
      const inverse: ThemePatch = {}
      let inverseCustom: CustomColorsPatch | undefined
      if (custom) {
        const next = { ...theme.custom }
        inverseCustom = {}
        for (const [name, value] of Object.entries(custom)) {
          inverseCustom[name] = next[name] ?? null
          if (value === null) Reflect.deleteProperty(next, name)
          else next[name] = value
        }
        if (Object.keys(next).length > CUSTOM_COLORS_MAX) fail('invalid', `A theme has at most ${CUSTOM_COLORS_MAX} custom colours`)
        assertUnusedColors(project, customColorNames(theme).filter(name => !(name in next)), next)
        if (Object.keys(next).length) theme.custom = next
        else Reflect.deleteProperty(theme, 'custom')
      }
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
      return { op: 'setTheme', theme: inverse, ...(inverseCustom ? { custom: inverseCustom } : {}) }
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
      const { op: _op, componentId: _c, propertyId: _p, ...patch } = op
      return { op: 'updateProperty', componentId: def.id, propertyId: property.id, ...patchProperty(def.properties, property, patch, 'Property', def.name) }
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
    case 'updateVariant': {
      const def = getDefinition(project, op.componentId)
      const variant = getVariant(def, op.variantId)
      const inverse: Extract<Operation, { op: 'updateVariant' }> = { op: 'updateVariant', componentId: def.id, variantId: variant.id }
      if (op.name !== undefined) {
        if (!op.name.trim()) fail('invalid', 'Variant name cannot be empty')
        inverse.name = variant.name
        variant.name = op.name.trim()
      }
      return inverse
    }
    case 'setOverride': {
      const def = getDefinition(project, op.componentId)
      const variant = getVariant(def, op.variantId)
      const node = findNode(def.root, op.nodeId) ?? fail('not_found', `Node "${op.nodeId}" not found on component "${def.name}"`)
      const props = { ...variant.overrides[node.id]?.props }
      const style = { ...variant.overrides[node.id]?.style }
      const unset = new Set(variant.overrides[node.id]?.unset)
      const inverse: Extract<Operation, { op: 'setOverride' }> = { op: 'setOverride', componentId: def.id, variantId: variant.id, nodeId: node.id }
      for (const key of op.unset ?? []) {
        if (op.style && key in op.style) fail('invalid', `"${key}" cannot be both set and removed`)
        const problem = styleKeyProblem(key)
        if (problem) fail('invalid', problem)
      }
      if (op.props) {
        inverse.props = {}
        for (const [name, value] of Object.entries(op.props)) {
          inverse.props[name] = props[name] ?? null
          if (value === null || value === node.props[name]) Reflect.deleteProperty(props, name)
          else props[name] = value
        }
      }
      if (op.style || op.unset) {
        // The inverse restores each key's value, or its removed marker (inverse.unset), or resets it (null).
        const restyle: Record<string, string | null> = {}
        const removed: string[] = []
        const remember = (key: string) => {
          if (key in restyle || removed.includes(key)) return
          if (unset.has(key)) removed.push(key)
          else restyle[key] = style[key] ?? null
        }
        for (const [key, value] of Object.entries(op.style ?? {})) {
          remember(key)
          unset.delete(key)
          if (value === null || value === '' || value === node.style[key]) Reflect.deleteProperty(style, key)
          else style[key] = value
        }
        for (const key of op.unset ?? []) {
          remember(key)
          Reflect.deleteProperty(style, key)
          // A marker only where the primary sets the key (itself or a style binding): the variant stays sparse.
          if (node.style[key] !== undefined || def.properties.some(p => p.bindings.some(b => b.nodeId === node.id && b.prop === key && isStyleBinding(b)))) unset.add(key)
        }
        if (op.style || Object.keys(restyle).length) inverse.style = restyle
        if (removed.length) inverse.unset = removed
      }
      const override = {
        ...(Object.keys(props).length ? { props } : {}),
        ...(Object.keys(style).length ? { style } : {}),
        ...(unset.size ? { unset: [...unset] } : {})
      }
      if (Object.keys(override).length) variant.overrides[node.id] = override
      else Reflect.deleteProperty(variant.overrides, node.id)
      return inverse
    }
    case 'addLayout': {
      const parsed = LayoutSchema.safeParse(op.layout)
      if (!parsed.success) fail('invalid', `Invalid layout: ${issues(parsed.error)}`)
      if (project.layouts.some(l => l.id === parsed.data.id)) fail('invalid', `Duplicate layout id "${parsed.data.id}"`)
      project.layouts.splice(clampIndex(op.index, project.layouts.length), 0, parsed.data)
      return { op: 'removeLayout', layoutId: parsed.data.id }
    }
    case 'removeLayout': {
      const layout = getLayout(project, op.layoutId)
      const pages = project.pages.filter(p => p.layoutId === layout.id)
      if (pages.length) fail('forbidden', layoutInUseMessage(layout.name, pages))
      const index = project.layouts.indexOf(layout)
      project.layouts.splice(index, 1)
      return { op: 'addLayout', index, layout }
    }
    case 'updateLayout': {
      const layout = getLayout(project, op.layoutId)
      const inverse: Extract<Operation, { op: 'updateLayout' }> = { op: 'updateLayout', layoutId: layout.id }
      if (op.name !== undefined) {
        if (!op.name.trim()) fail('invalid', 'Layout name cannot be empty')
        inverse.name = layout.name
        layout.name = op.name.trim()
      }
      return inverse
    }
    case 'addLayoutSlot': {
      const layout = getLayout(project, op.layoutId)
      const parsed = LayoutSlotSchema.safeParse(op.slot)
      if (!parsed.success) fail('invalid', `Invalid slot: ${issues(parsed.error)}`)
      layout.slots.splice(clampIndex(op.index, layout.slots.length), 0, parsed.data)
      return { op: 'removeLayoutSlot', layoutId: layout.id, slotId: parsed.data.id }
    }
    case 'removeLayoutSlot': {
      const layout = getLayout(project, op.layoutId)
      if (op.slotId === CHILDREN_SLOT) fail('forbidden', 'The children slot cannot be removed: it takes the page content')
      const index = layout.slots.indexOf(getSlot(layout, op.slotId))
      const [slot] = layout.slots.splice(index, 1)
      return { op: 'addLayoutSlot', layoutId: layout.id, index, slot: slot! }
    }
    case 'updateLayoutSlot': {
      const layout = getLayout(project, op.layoutId)
      const slot = getSlot(layout, op.slotId)
      const inverse: Extract<Operation, { op: 'updateLayoutSlot' }> = { op: 'updateLayoutSlot', layoutId: layout.id, slotId: slot.id }
      if (op.name !== undefined && !op.name.trim()) fail('invalid', 'Slot name cannot be empty')
      if (op.nodeId !== undefined && !findNode(layout.root, op.nodeId)) fail('not_found', `Node "${op.nodeId}" not found on layout "${layout.name}"`)
      if (op.name !== undefined) {
        inverse.name = slot.name
        slot.name = op.name.trim()
      }
      if (op.nodeId !== undefined) {
        inverse.nodeId = slot.nodeId
        slot.nodeId = op.nodeId
      }
      return inverse
    }
    case 'addLayoutVariable': {
      const layout = getLayout(project, op.layoutId)
      const parsed = PropertyDefSchema.safeParse(op.variable)
      if (!parsed.success) fail('invalid', `Invalid variable: ${issues(parsed.error)}`)
      layout.variables.splice(clampIndex(op.index, layout.variables.length), 0, parsed.data)
      return { op: 'removeLayoutVariable', layoutId: layout.id, variableId: parsed.data.id }
    }
    case 'removeLayoutVariable': {
      const layout = getLayout(project, op.layoutId)
      const index = layout.variables.indexOf(getVariable(layout, op.variableId))
      const [variable] = layout.variables.splice(index, 1)
      return { op: 'addLayoutVariable', layoutId: layout.id, index, variable: variable! }
    }
    case 'updateLayoutVariable': {
      const layout = getLayout(project, op.layoutId)
      const variable = getVariable(layout, op.variableId)
      const { op: _op, layoutId: _l, variableId: _v, ...patch } = op
      return { op: 'updateLayoutVariable', layoutId: layout.id, variableId: variable.id, ...patchProperty(layout.variables, variable, patch, 'Variable', layout.name) }
    }
    case 'setPageLayout': {
      const page = getPage(project, op.pageId)
      const inverse: Operation = { op: 'setPageLayout', pageId: page.id, layoutId: page.layoutId ?? null, layoutValues: page.layoutValues ?? null }
      if (op.layoutId === null) Reflect.deleteProperty(page, 'layoutId')
      else page.layoutId = op.layoutId
      if (op.layoutValues === undefined || op.layoutValues === null) Reflect.deleteProperty(page, 'layoutValues')
      else page.layoutValues = structuredClone(op.layoutValues)
      return inverse
    }
    case 'setLayoutValues': {
      const page = getPage(project, op.pageId)
      const values = { ...page.layoutValues }
      const previous: Record<string, PropValue | null> = {}
      for (const [key, value] of Object.entries(op.values)) {
        previous[key] = values[key] ?? null
        if (value === null) Reflect.deleteProperty(values, key)
        else values[key] = value
      }
      if (Object.keys(values).length) page.layoutValues = values
      else Reflect.deleteProperty(page, 'layoutValues')
      return { op: 'setLayoutValues', pageId: page.id, values: previous }
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
