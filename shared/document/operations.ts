import { defaultTheme, ThemePatchSchema } from '../design/theme'
import type { ThemePatch } from '../design/theme'
import { isStyleTokenKey, styleTokenProblem } from '../design/tokens'
import { getComponent, isContainerType } from './components'
import type { PropValue } from './components'
import type { z } from 'zod'
import { CollectionSchema, FieldSchema, FieldTypeSchema, nodeTreeProblems, PageSchema, propValueProblem, SlugSchema } from './schema'
import type { Collection, DocNode, Field, FieldType, Page, Project } from './schema'
import { containsNode, findNode, findParent, walk } from './tree'

/**
 * The closed set of document edits. Every action that changes a project
 * lowers to these operations; each one returns its exact inverse, which is
 * what the undo history stores (the Stacki inverse-splice idea, on JSON).
 */
export type Operation
  = | { op: 'insert', pageId: string, parentId: string, index: number, node: DocNode }
    | { op: 'remove', pageId: string, nodeId: string }
    | { op: 'move', pageId: string, nodeId: string, parentId: string, index: number }
    | { op: 'setProps', pageId: string, nodeId: string, props: Record<string, PropValue | null> }
    | { op: 'setStyle', pageId: string, nodeId: string, style: Record<string, string | null> }
    | { op: 'addPage', index: number, page: Page }
    | { op: 'removePage', pageId: string }
    | { op: 'updatePage', pageId: string, name?: string, slug?: string }
    | { op: 'setTheme', theme: ThemePatch }
    | { op: 'addCollection', index: number, collection: Collection }
    | { op: 'removeCollection', collectionId: string }
    | { op: 'updateCollection', collectionId: string, name?: string, slug?: string, publicRead?: boolean, publicCreate?: boolean }
    | { op: 'addField', collectionId: string, index: number, field: Field }
    | { op: 'removeField', collectionId: string, key: string }
    | { op: 'updateField', collectionId: string, key: string, label?: string, type?: FieldType }

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

function getNode(page: Page, nodeId: string): DocNode {
  return findNode(page.root, nodeId) ?? fail('not_found', `Node "${nodeId}" not found on page "${page.name}"`)
}

function getContainer(page: Page, parentId: string): DocNode {
  const parent = getNode(page, parentId)
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

function assertNewTree(project: Project, node: DocNode, isRoot = false): void {
  const problems = nodeTreeProblems(node, projectIds(project), isRoot)
  if (problems.length) fail('invalid', problems.join('; '))
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

function assertUniqueCollectionSlug(project: Project, slug: string, exceptId?: string): void {
  if (!SlugSchema.safeParse(slug).success) fail('invalid', `Invalid collection slug "${slug}"`)
  if (project.collections.some(c => c.slug === slug && c.id !== exceptId)) fail('invalid', `A collection with slug "${slug}" already exists`)
}

/** Applies `op` to `project` in place and returns the operation that undoes it. */
export function applyOperation(project: Project, op: Operation): Operation {
  switch (op.op) {
    case 'insert': {
      const page = getPage(project, op.pageId)
      const parent = getContainer(page, op.parentId)
      assertNewTree(project, op.node)
      parent.children.splice(clampIndex(op.index, parent.children.length), 0, structuredClone(op.node))
      return { op: 'remove', pageId: page.id, nodeId: op.node.id }
    }
    case 'remove': {
      const page = getPage(project, op.pageId)
      const location = findParent(page.root, op.nodeId)
      if (!location) fail(op.nodeId === page.root.id ? 'forbidden' : 'not_found', op.nodeId === page.root.id ? 'The page root cannot be removed' : `Node "${op.nodeId}" not found`)
      const [node] = location.parent.children.splice(location.index, 1)
      return { op: 'insert', pageId: page.id, parentId: location.parent.id, index: location.index, node: node! }
    }
    case 'move': {
      const page = getPage(project, op.pageId)
      const location = findParent(page.root, op.nodeId)
      if (!location) fail(op.nodeId === page.root.id ? 'forbidden' : 'not_found', op.nodeId === page.root.id ? 'The page root cannot be moved' : `Node "${op.nodeId}" not found`)
      const target = getContainer(page, op.parentId)
      const node = location.parent.children[location.index]!
      if (containsNode(node, target.id)) fail('invalid', 'A node cannot be moved into itself or its descendants')
      location.parent.children.splice(location.index, 1)
      target.children.splice(clampIndex(op.index, target.children.length), 0, node)
      return { op: 'move', pageId: page.id, nodeId: node.id, parentId: location.parent.id, index: location.index }
    }
    case 'setProps': {
      const page = getPage(project, op.pageId)
      const node = getNode(page, op.nodeId)
      const def = getComponent(node.type)
      const previous: Record<string, PropValue | null> = {}
      for (const [name, value] of Object.entries(op.props)) {
        const propDef = def?.props.find(p => p.name === name)
        if (!propDef) fail('invalid', `"${node.type}" has no prop "${name}"`)
        if (value !== null) {
          const problem = propValueProblem(propDef, value)
          if (problem) fail('invalid', problem)
        }
      }
      for (const [name, value] of Object.entries(op.props)) {
        previous[name] = name in node.props ? node.props[name]! : null
        if (value === null) Reflect.deleteProperty(node.props, name)
        else node.props[name] = value
      }
      return { op: 'setProps', pageId: page.id, nodeId: node.id, props: previous }
    }
    case 'setStyle': {
      const page = getPage(project, op.pageId)
      const node = getNode(page, op.nodeId)
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
      return { op: 'setStyle', pageId: page.id, nodeId: node.id, style: previous }
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
      const inverse: Extract<Operation, { op: 'updateField' }> = { op: 'updateField', collectionId: collection.id, key: field.key }
      if (op.label !== undefined) {
        inverse.label = field.label
        field.label = op.label.trim()
      }
      if (op.type !== undefined) {
        inverse.type = field.type
        field.type = op.type
      }
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
