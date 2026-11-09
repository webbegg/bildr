import { defaultTheme, ThemePatchSchema } from '../design/theme'
import type { ThemePatch } from '../design/theme'
import { isStyleTokenKey, styleTokenProblem } from '../design/tokens'
import { getComponent, isContainerType } from './components'
import type { PropValue } from './components'
import { nodeTreeProblems, PageSchema, propValueProblem, SlugSchema } from './schema'
import type { DocNode, Page, Project } from './schema'
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
