import { z } from 'zod'
import { ALL_BREAKPOINTS, isStyleTokenKey, styleTokenProblem } from '../design/tokens.ts'
import { ArtifactIdSchema, InteractionSchema, LocalIdSchema, ValueSchema } from '../model/schemas.ts'
import type { ComponentFile, LayoutFile, ModelNode, PageFile, Value } from '../model/schemas.ts'
import { takesProp } from '../render/rules.ts'
import { defineEdit, fail, rootName } from './core.ts'
import type { Draft, Tree } from './core.ts'
import { useAction } from './queries.ts'
import { INTERNAL_TYPES, isContainerType, isNodeType, LINK_PROPS, paletteEntry } from './palette.ts'
import { cloneWithNewIds, containsNode, findNode, findParent, insertChild, subtreeIds, walk } from './tree.ts'

/** The node operations of `shared/document/operations.ts` (insert, remove, move, setProps, setStyle, setNodeMeta) on `.bildr/` trees. */

export const FileRef = ArtifactIdSchema.describe('The page, component or layout whose tree to edit: its artifact id, e.g. "pg_index", "cmp_post_card" or "lay_main"')
export const NodeRef = LocalIdSchema.describe('A node id of that tree')
const Nodes = {
  nodeId: NodeRef.optional().describe('The node to act on; or give nodeIds'),
  nodeIds: z.array(LocalIdSchema).min(1).optional().describe('Several nodes to act on at once, all or nothing; replaces nodeId')
}

export interface NodeSpec {
  type: string
  name?: string
  locked?: boolean
  props?: Record<string, Value>
  style?: Record<string, string>
  interactions?: z.infer<typeof InteractionSchema>[]
  children?: NodeSpec[]
}

export const NodeSpecSchema: z.ZodType<NodeSpec> = z.lazy(() => z.object({
  type: z.string().min(1).describe('A node type, see catalog_get'),
  name: z.string().min(1).max(100).optional().describe('A layer name'),
  locked: z.boolean().optional(),
  props: z.record(z.string(), ValueSchema).optional().describe('Props over the type\'s defaults (with exact: all of them)'),
  style: z.record(z.string(), z.string()).optional().describe('Style tokens over the type\'s defaults (with exact: all of them)'),
  interactions: z.array(InteractionSchema).optional(),
  children: z.array(NodeSpecSchema).optional()
}))

const StyleSchema = z.record(z.string(), z.string()).describe('Style tokens, e.g. { "mt": "10", "bg": "primary" }; see catalog_get styleTokens')
const StylePatchSchema = z.record(z.string(), z.string().nullable()).describe('Style tokens to set, e.g. { "mt": "10", "md:mt": "16" }; null removes one')
const BreakpointSchema = z.enum(ALL_BREAKPOINTS).optional().describe('Set the tokens at this breakpoint of the project\'s breakpointBase (mobile: sm, md, lg; desktop: max-lg, max-md, max-sm): `text` becomes `md:text`')

// ── Checks shared by the edits ───────────────────────────────────────────

/** Refuses props a node of `type` doesn't take. */
export const checkProps = (type: string, props: Record<string, unknown>): void => {
  for (const key of Object.keys(props)) if (!takesProp(type, key)) fail('invalid', `A ${type} has no prop "${key}"`)
}

/** Refuses style tokens (or values) the project can't hold; a null value only needs a known key. */
export const checkStyle = (draft: Draft, style: Record<string, string | null>): void => {
  for (const [key, value] of Object.entries(style)) {
    const problem = value === null || value === ''
      ? (isStyleTokenKey(key) ? undefined : styleTokenProblem(key, ''))
      : styleTokenProblem(key, value, draft.colors, draft.base)
    if (problem) fail('invalid', problem)
  }
}

export const nodeIn = (tree: Tree, id: string): ModelNode => findNode(tree.root, id) ?? fail('not_found', `Node "${id}" not found in ${tree.file}`)

/** The node `id` with its parent; the root is refused (`verb`: "moved", "deleted"…). */
export const located = (tree: Tree, id: string, verb: string) => {
  nodeIn(tree, id)
  return findParent(tree.root, id) ?? fail('invalid', `The ${rootName(tree)} cannot be ${verb}`)
}

export const idsOf = ({ nodeId, nodeIds }: { nodeId?: string, nodeIds?: string[] }): string[] => {
  const ids = nodeIds ?? (nodeId ? [nodeId] : [])
  if (!ids.length) fail('invalid', 'Give nodeId or nodeIds')
  return [...new Set(ids)]
}

/** The nodes of `ids` not inside another of them, in `ids` order; refuses missing nodes and the root. */
const outermost = (tree: Tree, ids: string[], verb: string): ModelNode[] => {
  const nodes = ids.map(id => nodeIn(tree, id))
  if (nodes.includes(tree.root)) fail('invalid', `The ${rootName(tree)} cannot be ${verb}`)
  return nodes.filter(node => !nodes.some(other => other !== node && containsNode(other, node.id)))
}

/** Where a new child of `parentId` may go: a container, and an Instance only takes SlotFills. */
export const containerIn = (tree: Tree, parentId: string, child: string): ModelNode => {
  const parent = nodeIn(tree, parentId)
  if (parent.type === 'Instance' && child !== 'SlotFill') fail('invalid', 'An Instance holds only the content of its slots: fill one of its slots instead')
  if (!isContainerType(parent.type)) fail('invalid', `A ${parent.type} cannot hold children`)
  return parent
}

const nonEmpty = <T extends object>(value: T | undefined): T | undefined => (value && Object.keys(value).length ? value : undefined)

/** A new node (and its children) for `spec`, with the palette defaults unless `exact`. */
export const buildNode = (draft: Draft, spec: NodeSpec, exact = false): ModelNode => {
  const entry = paletteEntry(spec.type)
  if (!entry && !(INTERNAL_TYPES as readonly string[]).includes(spec.type)) fail('invalid', `Unknown node type "${spec.type}"`)
  if (!isNodeType(spec.type)) fail('invalid', `Unknown node type "${spec.type}"`)
  checkProps(spec.type, spec.props ?? {})
  checkStyle(draft, spec.style ?? {})
  if (spec.children?.length && !isContainerType(spec.type)) fail('invalid', `A ${spec.type} cannot hold children`)
  const defaults = exact || !entry ? {} : { ...entry.props }
  // A link takes `to` (a page) or `href` (a URL): a given one replaces the other's default.
  if (LINK_PROPS.some(key => spec.props?.[key] !== undefined)) for (const key of LINK_PROPS) Reflect.deleteProperty(defaults, key)
  const props = nonEmpty({ ...defaults, ...spec.props })
  const style = nonEmpty({ ...(exact || !entry ? {} : entry.style), ...spec.style })
  const node: ModelNode = { id: draft.nodeId(spec.type), type: spec.type }
  if (spec.name) node.name = spec.name
  if (spec.locked) node.locked = true
  if (props) node.props = props
  if (style) node.style = style
  if (spec.interactions?.length) node.interactions = structuredClone(spec.interactions)
  if (spec.children?.length) node.children = spec.children.map(child => buildNode(draft, child, exact))
  return node
}

/** Drops what a component's variants and properties, or a layout's variables, say about nodes that are gone. */
export const forgetNodes = (tree: Tree, gone: Set<string>): void => {
  if (tree.kind === 'page' || !gone.size) return
  const properties = tree.kind === 'component' ? (tree.owner as ComponentFile).properties : (tree.owner as LayoutFile).variables ?? []
  for (const property of properties) {
    if (property.bindings) property.bindings = property.bindings.filter(binding => !gone.has(binding.nodeId))
    if (property.bindings?.length === 0) delete property.bindings
  }
  if (tree.kind === 'component') {
    for (const variant of (tree.owner as ComponentFile).variants) for (const id of gone) Reflect.deleteProperty(variant.overrides, id)
  }
}

export const removeNode = (tree: Tree, node: ModelNode): void => {
  const location = findParent(tree.root, node.id)!
  location.parent.children!.splice(location.index, 1)
  forgetNodes(tree, subtreeIds(node))
}

/** A page's Form that runs an action makes the page use it (in the same change set, so nothing stays behind when the edit is refused). */
const wireForms = (draft: Draft, tree: Tree, node: ModelNode): void => {
  if (tree.kind !== 'page') return
  walk(node, (entry) => {
    if (entry.type === 'Form' && typeof entry.props?.action === 'string') useAction(draft, tree.owner as PageFile, entry.props.action)
  })
}

export const setProps = (node: ModelNode, props: Record<string, Value | null>): void => {
  const next = { ...node.props }
  for (const [key, value] of Object.entries(props)) {
    if (value === null) Reflect.deleteProperty(next, key)
    else next[key] = value
  }
  if (Object.keys(next).length) node.props = next
  else delete node.props
}

/** Applies a style patch (null or '' removes a token); `breakpoint` prefixes every key. */
export const setStyle = (draft: Draft, node: ModelNode, patch: Record<string, string | null>, breakpoint?: string): void => {
  const keyed = Object.fromEntries(Object.entries(patch).map(([key, value]) => [breakpoint ? `${breakpoint}:${key}` : key, value]))
  checkStyle(draft, keyed)
  const next = { ...node.style }
  for (const [key, value] of Object.entries(keyed)) {
    if (value === null || value === '') Reflect.deleteProperty(next, key)
    else next[key] = value
  }
  if (Object.keys(next).length) node.style = next
  else delete node.style
}

/** Moves `nodeId` into `parentId` at `index` (its index after the move). */
export const moveNode = (tree: Tree, nodeId: string, parentId: string, index: number): void => {
  const location = located(tree, nodeId, 'moved')
  const node = location.parent.children![location.index]!
  const target = containerIn(tree, parentId, node.type)
  if (containsNode(node, target.id)) fail('invalid', 'A node cannot be moved into itself or its descendants')
  location.parent.children!.splice(location.index, 1)
  insertChild(target, node, index)
}

// ── The edits ────────────────────────────────────────────────────────────

export const nodeInsert = defineEdit({
  input: z.object({
    file: FileRef,
    parentId: LocalIdSchema.optional().describe('The container to insert into; defaults to the tree root'),
    index: z.int().nonnegative().optional().describe('Position among its children; defaults to the end'),
    exact: z.boolean().optional().describe('true: only the given props and style, without the type\'s defaults (a paste)'),
    nodes: z.array(NodeSpecSchema).min(1).optional().describe('Several nodes, in order from index, all or nothing; replaces type, props, style and children'),
    type: z.string().min(1).optional().describe('A node type (catalog_get nodeTypes); required unless nodes is given'),
    name: z.string().min(1).max(100).optional(),
    props: z.record(z.string(), ValueSchema).optional(),
    style: StyleSchema.optional(),
    interactions: z.array(InteractionSchema).optional(),
    children: z.array(NodeSpecSchema).optional()
  }).refine(input => (input.nodes ? input.type === undefined : input.type !== undefined), { message: 'Give type, or nodes (not both)', path: ['type'] }),
  apply: (draft, { file, parentId, index, exact, nodes: specs, ...spec }) => {
    const tree = draft.tree(file)
    const all = specs ?? [spec as NodeSpec]
    const nodes = all.map(one => buildNode(draft, one, exact))
    for (const [i, node] of nodes.entries()) {
      insertChild(containerIn(tree, parentId ?? tree.root.id, node.type), node, index === undefined ? undefined : index + i)
      wireForms(draft, tree, node)
    }
    const nodeIds = nodes.map(node => node.id)
    return specs ? { nodeId: nodeIds[0], nodeIds } : { nodeId: nodeIds[0] }
  }
})

export const nodeUpdateProps = defineEdit({
  input: z.object({ file: FileRef, nodeId: NodeRef, props: z.record(z.string(), ValueSchema.nullable()).describe('Props to set; null removes one') }),
  apply: (draft, { file, nodeId, props }) => {
    const tree = draft.tree(file)
    const node = nodeIn(tree, nodeId)
    checkProps(node.type, props)
    setProps(node, props)
    wireForms(draft, tree, node)
    return {}
  }
})

export const nodeUpdateStyle = defineEdit({
  input: z.object({
    file: FileRef,
    ...Nodes,
    breakpoint: BreakpointSchema,
    style: StylePatchSchema.optional().describe('Required unless updates is given'),
    updates: z.array(z.object({ nodeId: NodeRef, style: StylePatchSchema })).min(1).optional().describe('Per-node tokens, all or nothing; replaces nodeId, nodeIds and style')
  }).refine(input => (input.updates ? input.style === undefined && input.nodeId === undefined && input.nodeIds === undefined : input.style !== undefined), {
    message: 'Give updates, or style with nodeId or nodeIds', path: ['updates']
  }),
  apply: (draft, { file, breakpoint, style, updates, ...nodes }) => {
    const tree = draft.tree(file)
    const entries = updates ?? idsOf(nodes).map(nodeId => ({ nodeId, style: style! }))
    for (const entry of entries) setStyle(draft, nodeIn(tree, entry.nodeId), entry.style, breakpoint)
    return {}
  }
})

export const nodeRename = defineEdit({
  input: z.object({ file: FileRef, nodeId: NodeRef, name: z.string().max(100).nullable().describe('The layer name (trimmed); empty or null removes it') }),
  apply: (draft, { file, nodeId, name }) => {
    const node = nodeIn(draft.tree(file), nodeId)
    const trimmed = name?.trim()
    if (trimmed) node.name = trimmed
    else delete node.name
    return {}
  }
})

export const nodeSetLocked = defineEdit({
  input: z.object({ file: FileRef, ...Nodes, locked: z.boolean().describe('true locks on the canvas, false unlocks') }),
  apply: (draft, { file, locked, ...nodes }) => {
    const tree = draft.tree(file)
    for (const id of idsOf(nodes)) {
      const node = nodeIn(tree, id)
      if (locked) node.locked = true
      else delete node.locked
    }
    return {}
  }
})

const MoveSchema = z.object({ nodeId: NodeRef, parentId: LocalIdSchema.describe('The container to move it into'), index: z.int().nonnegative().describe('Its index there after the move') })

export const nodeMove = defineEdit({
  input: z.object({ file: FileRef, ...MoveSchema.shape }),
  apply: (draft, { file, nodeId, parentId, index }) => {
    moveNode(draft.tree(file), nodeId, parentId, index)
    return {}
  }
})

export const nodeMoveMany = defineEdit({
  input: z.object({ file: FileRef, moves: z.array(MoveSchema).min(1) }),
  apply: (draft, { file, moves }) => {
    const tree = draft.tree(file)
    for (const move of moves) moveNode(tree, move.nodeId, move.parentId, move.index)
    return {}
  }
})

export const nodeDelete = defineEdit({
  input: z.object({ file: FileRef, ...Nodes }),
  apply: (draft, { file, ...nodes }) => {
    const tree = draft.tree(file)
    for (const node of outermost(tree, idsOf(nodes), 'deleted')) removeNode(tree, node)
    return {}
  }
})

export const nodeDuplicate = defineEdit({
  input: z.object({ file: FileRef, ...Nodes }),
  apply: (draft, { file, ...nodes }) => {
    const tree = draft.tree(file)
    const originals = outermost(tree, idsOf(nodes), 'duplicated')
    const copies = originals.map((node) => {
      const copy = cloneWithNewIds(node, type => draft.nodeId(type))
      const location = findParent(tree.root, node.id)!
      location.parent.children!.splice(location.index + 1, 0, copy)
      return copy.id
    })
    return { nodeId: copies[0], nodeIds: copies }
  }
})

export const WRAP_TYPES = ['Container', 'Row', 'Column', 'Card', 'Grid'] as const

export const nodeWrap = defineEdit({
  input: z.object({
    file: FileRef,
    ...Nodes,
    type: z.enum(WRAP_TYPES).optional().describe('The wrapping container; defaults to Container'),
    style: StyleSchema.optional().describe('Style tokens over the container\'s defaults')
  }),
  apply: (draft, { file, type = 'Container', style, ...nodes }) => {
    const tree = draft.tree(file)
    const ids = idsOf(nodes)
    const locations = ids.map(id => located(tree, id, 'wrapped'))
    const parent = locations[0]!.parent
    if (locations.some(location => location.parent !== parent)) fail('invalid', 'Only siblings (nodes of one parent) can be wrapped together')
    const index = Math.min(...locations.map(location => location.index))
    const wrapper = buildNode(draft, { type, ...(style ? { style } : {}) })
    const moved = ids.map(id => findNode(tree.root, id)!)
    parent.children = parent.children!.filter(child => !ids.includes(child.id))
    parent.children.splice(index, 0, wrapper)
    wrapper.children = moved
    return { nodeId: wrapper.id }
  }
})
