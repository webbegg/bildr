import { z } from 'zod'
import { cloneWithNewIds, createNode } from '#shared/document/factory'
import { getComponent } from '#shared/document/components'
import type { PropValue } from '#shared/document/components'
import type { TreeRef } from '#shared/document/operations'
import { CUSTOM_COLOR_NAME, STYLE_HEX, STYLE_TOKENS, styleKey, variantsOf } from '#shared/design/tokens'
import type { StyleToken } from '#shared/design/tokens'
import { IdSchema, NODE_NAME_MAX, PropValueSchema } from '#shared/document/schema'
import type { DocNode } from '#shared/document/schema'
import { containsNode, findNode, findParent } from '#shared/document/tree'
import { ActionError, defineAction } from './define'
import type { ActionContext } from './define'
import { assertFound } from './project'

interface NodeSpec {
  type: string
  props?: Record<string, PropValue>
  style?: Record<string, string>
  children?: NodeSpec[]
}

/**
 * A token's value: an enum, so the MCP schema lists every allowed value; a
 * colour token also takes a hex or the name of a theme colour (checked
 * against the project theme when the edit applies).
 */
// A multi-value literal rather than z.enum, which reorders numeric-looking values ("10" before "0.5").
function tokenValueSchema(token: StyleToken): z.ZodType<string> {
  const values = z.literal(token.values)
  if (token.kind !== 'color') return values
  return z.union([
    values,
    z.string().regex(STYLE_HEX).describe('A #rgb, #rrggbb or #rrggbbaa hex colour'),
    z.string().regex(CUSTOM_COLOR_NAME).describe('The name of one of the project theme\'s custom colours (theme_get theme.custom)')
  ], { error: issue => `"${String(issue.input)}" is not a value of style token "${token.key}" (use a colour token, a #rgb, #rrggbb or #rrggbbaa hex, or a theme colour)` })
}

/** One optional key per design token and breakpoint (`cols`, `sm:cols`, `md:cols`, `lg:cols`). */
function styleTokensSchema(wrap: (values: z.ZodType<string>, token: StyleToken) => z.ZodType) {
  return z.object(Object.fromEntries(STYLE_TOKENS.flatMap(t => variantsOf(t).map(b => [
    styleKey(t.key, b),
    wrap(tokenValueSchema(t), t).optional().describe(b
      ? `${t.label} from the ${b} breakpoint up: Tailwind class ${b}:${t.prefix ? `${t.prefix}-` : ''}<value>`
      : `${t.label}: Tailwind class ${t.prefix ? `${t.prefix}-` : ''}<value>`)
  ])))).strict()
}

const StyleSchema = styleTokensSchema(values => values)
  .describe('Design tokens, e.g. { "mt": "10", "bg": "primary", "rounded": "lg" } renders class="mt-10 bg-primary rounded-lg". Layout tokens (Spacing, Size, Typography, Layout) also take a mobile-first breakpoint prefix sm:, md: or lg:, e.g. { "cols": "1", "md:cols": "3" } renders class="grid-cols-1 md:grid-cols-3". Colour tokens (bg, color, borderColor) also take a #rgb, #rrggbb or #rrggbbaa hex, or the name of a theme custom colour, e.g. { "bg": "#ff6600", "color": "brand" }, rendered as an inline style. See components_list.tokens') as z.ZodType<Record<string, string>>
const StyleUpdateSchema = styleTokensSchema(values => values.nullable())
  .describe('Design tokens to set; null removes a token') as z.ZodType<Record<string, string | null>>

const NodeSpecSchema: z.ZodType<NodeSpec> = z.lazy(() => z.object({
  type: z.string().describe('Component type, see components_list'),
  props: z.record(z.string(), PropValueSchema).optional().describe('Overrides of the component default props (with exact, all the props)'),
  style: StyleSchema.optional().describe('Design tokens added to the component default style (with exact, the whole style)'),
  children: z.array(NodeSpecSchema).optional().describe('Child nodes; only for container components')
}))

/** A new node for `spec` and its children; `exact` leaves out the component default props and style (a paste). */
function buildNode(spec: NodeSpec, exact = false): DocNode {
  if (!getComponent(spec.type)) throw new ActionError('invalid', `Unknown component type "${spec.type}"`)
  const node = createNode(spec.type, spec.props)
  if (exact) node.props = { ...spec.props }
  node.style = exact ? { ...spec.style } : { ...node.style, ...spec.style }
  node.children = (spec.children ?? []).map(child => buildNode(child, exact))
  return node
}

/** The tree the node actions edit: a page, a component definition or a layout (whose node ids are their own). */
const Target = {
  projectId: IdSchema,
  pageId: IdSchema.optional().describe('The page to edit; or give componentId or layoutId'),
  componentId: IdSchema.optional().describe('The component definition to edit, from project_get components; replaces pageId'),
  layoutId: IdSchema.optional().describe('The layout to edit, from project_get layouts; replaces pageId')
}

type TreeInput = { pageId?: string, componentId?: string, layoutId?: string }

/** True when exactly one of `pageId`, `componentId` and `layoutId` is given. */
export const oneTree = (input: TreeInput) => [input.pageId, input.componentId, input.layoutId].filter(id => id !== undefined).length === 1
// Checked even when other fields fail, so a call missing both still hears about pageId.
export const ONE_TREE = { message: 'Give pageId, componentId or layoutId', path: ['pageId'], when: () => true }

export function treeOf(input: TreeInput): TreeRef {
  if (input.pageId !== undefined) return { pageId: input.pageId }
  return input.componentId !== undefined ? { componentId: input.componentId } : { layoutId: input.layoutId! }
}

/** The `nodeId` or `nodeIds` fields of the actions that also act on several nodes at once (one undo step). */
const Nodes = {
  nodeId: IdSchema.optional().describe('The node to act on; or give nodeIds'),
  nodeIds: z.array(IdSchema).min(1).optional().describe('Several nodes to act on at once, as one undo step; replaces nodeId')
}

function nodeIdsOf({ nodeId, nodeIds }: { nodeId?: string, nodeIds?: string[] }): string[] {
  const ids = nodeIds ?? (nodeId ? [nodeId] : [])
  if (!ids.length) throw new ActionError('invalid', 'Give nodeId or nodeIds')
  return [...new Set(ids)]
}

interface LoadedTree {
  root: DocNode
  /** `page root`, `component root` or `layout root`, for messages. */
  rootName: string
}

async function loadTree(ctx: ActionContext, projectId: string, tree: TreeRef): Promise<LoadedTree> {
  const current = await ctx.services.loadProject(projectId)
  if (tree.componentId !== undefined) {
    const def = assertFound(current.components.find(c => c.id === tree.componentId), `Component "${tree.componentId}" not found`)
    return { root: def.root, rootName: 'component root' }
  }
  if (tree.layoutId !== undefined) {
    const layout = assertFound(current.layouts.find(l => l.id === tree.layoutId), `Layout "${tree.layoutId}" not found`)
    return { root: layout.root, rootName: 'layout root' }
  }
  const page = assertFound(current.pages.find(p => p.id === tree.pageId), `Page "${tree.pageId}" not found`)
  return { root: page.root, rootName: 'page root' }
}

/** The nodes of `ids` that are not inside another one of them, in `ids` order; refuses missing nodes and the root. */
function outermost(tree: LoadedTree, ids: string[], verb: string): DocNode[] {
  const nodes = ids.map(id => assertFound(findNode(tree.root, id), `Node "${id}" not found`))
  if (nodes.includes(tree.root)) throw new ActionError('forbidden', `The ${tree.rootName} cannot be ${verb}`)
  return nodes.filter(node => !nodes.some(other => other !== node && containsNode(other, node.id)))
}

export const nodeInsert = defineAction({
  name: 'node_insert',
  description: 'Insert a component, optionally with nested children, into a container node (defaults to the tree root: the page root, or with componentId the component definition root, or with layoutId the layout root; at the end). Returns the new node id. Inside a List (bound to a collection slug), string props of its children such as text, label, src and to can use bindings like "{{ item.name }}" or "/menu/{{ item.id }}", resolved per record. With exact: true, the node and its children get only the given props and style, not the component defaults, e.g. to paste a copied node unchanged. With nodes (instead of type, props, style and children), inserts several nodes in order from index, as one undo step (all or nothing), and also returns nodeIds, in the nodes order (nodeId is the first); exact applies to each, e.g. to paste a copied selection.',
  input: z.object({
    ...Target,
    parentId: IdSchema.optional().describe('Container node id; defaults to the tree root'),
    index: z.number().int().nonnegative().optional().describe('Position among the parent children; defaults to the end'),
    type: z.string().optional().describe('Component type, see components_list. Required unless nodes is given'),
    props: z.record(z.string(), PropValueSchema).optional(),
    style: StyleSchema.optional(),
    children: z.array(NodeSpecSchema).optional(),
    nodes: z.array(NodeSpecSchema).min(1).optional().describe('Several nodes to insert side by side, in order from index, as one undo step; replaces type, props, style and children'),
    exact: z.boolean().optional().describe('true gives the node (or every node of nodes) and every child exactly the given props and style, without the component defaults (as a paste of a copied node does); defaults to false')
  }).refine(oneTree, ONE_TREE)
    .refine(input => (input.nodes ? [input.type, input.props, input.style, input.children].every(field => field === undefined) : input.type !== undefined), {
      message: 'Give type, or nodes (not both)',
      path: ['type']
    }),
  run: async ({ projectId, pageId, componentId, layoutId, parentId, index, exact, nodes: specs, ...spec }, ctx) => {
    const nodes = (specs ?? [spec as NodeSpec]).map(one => buildNode(one, exact))
    const tree = treeOf({ pageId, componentId, layoutId })
    const { root } = await loadTree(ctx, projectId, tree)
    const label = nodes.length > 1 ? `Insert ${nodes.length}` : `Insert ${nodes[0]!.type}`
    const project = await ctx.services.mutate(ctx, projectId, label, nodes.map((node, i) => (
      { op: 'insert' as const, ...tree, parentId: parentId ?? root.id, index: index === undefined ? Number.MAX_SAFE_INTEGER : index + i, node }
    )))
    const nodeIds = nodes.map(node => node.id)
    return specs ? { version: project.version, nodeId: nodeIds[0]!, nodeIds } : { version: project.version, nodeId: nodeIds[0]! }
  }
})

export const nodeUpdateProps = defineAction({
  name: 'node_update_props',
  description: 'Set props of a node. Only props declared by the component are allowed; a null value removes the prop.',
  input: z.object({ ...Target, nodeId: IdSchema, props: z.record(z.string(), PropValueSchema.nullable()) }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, pageId, componentId, layoutId, nodeId, props }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Update props', [{ op: 'setProps', ...treeOf({ pageId, componentId, layoutId }), nodeId, props }])
    return { version: project.version }
  }
})

export const nodeUpdateStyle = defineAction({
  name: 'node_update_style',
  description: 'Set design tokens of a node, e.g. { "mt": "10", "bg": "primary" } (keys and values from components_list.tokens). Colour tokens (bg, color, borderColor) also take a #rgb, #rrggbb or #rrggbbaa hex or a theme custom colour name (theme_get theme.custom), e.g. { "bg": "#ff6600" }. Tokens listing breakpoints also take a mobile-first prefix, e.g. { "md:cols": "3" } applies from the md breakpoint up. A null value removes the token. With nodeIds the same tokens go to every node, as one undo step (all or nothing). With updates (instead of nodeId, nodeIds and style), each node gets its own tokens, e.g. [{ "nodeId": "a", "style": { "bg": "error" } }, { "nodeId": "b", "style": { "color": "error" } }], also as one undo step (all or nothing), e.g. to swap a colour across a selection.',
  input: z.object({
    ...Target,
    ...Nodes,
    style: StyleUpdateSchema.optional().describe('Design tokens to set; null removes a token. Required unless updates is given'),
    updates: z.array(z.object({ nodeId: IdSchema, style: StyleUpdateSchema })).min(1).optional()
      .describe('Per-node tokens, applied in order as one undo step (all or nothing); replaces nodeId, nodeIds and style')
  }).refine(oneTree, ONE_TREE)
    .refine(input => (input.updates ? input.style === undefined && input.nodeId === undefined && input.nodeIds === undefined : input.style !== undefined), {
      message: 'Give updates, or style with nodeId or nodeIds',
      path: ['updates']
    }),
  run: async ({ projectId, pageId, componentId, layoutId, style, updates, ...nodes }, ctx) => {
    const tree = treeOf({ pageId, componentId, layoutId })
    const ops = updates
      ? updates.map(update => ({ op: 'setStyle' as const, ...tree, ...update }))
      : nodeIdsOf(nodes).map(nodeId => ({ op: 'setStyle' as const, ...tree, nodeId, style: style! }))
    const project = await ctx.services.mutate(ctx, projectId, 'Update style', ops)
    return { version: project.version }
  }
})

export const nodeRename = defineAction({
  name: 'node_rename',
  description: 'Give a node a layer name (shown in the layers, the canvas label and the inspector instead of its type, component or slot name). An empty string or null removes it. One undo step, "Rename layer".',
  input: z.object({
    ...Target,
    nodeId: IdSchema,
    name: z.string().max(NODE_NAME_MAX).nullable().describe(`The layer name, at most ${NODE_NAME_MAX} characters (trimmed); empty or null removes it`)
  }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, pageId, componentId, layoutId, nodeId, name }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Rename layer', [{ op: 'setNodeMeta', ...treeOf({ pageId, componentId, layoutId }), nodeId, name }])
    return { version: project.version }
  }
})

export const nodeSetLocked = defineAction({
  name: 'node_set_locked',
  description: 'Lock or unlock nodes on the canvas. A locked node, and everything inside it, cannot be selected or moved from the canvas, but can still be from the layers and through actions. Unlocking removes the flag. With nodeIds, every node at once, as one undo step.',
  input: z.object({ ...Target, ...Nodes, locked: z.boolean().describe('true locks, false unlocks') }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, pageId, componentId, layoutId, locked, ...nodes }, ctx) => {
    const tree = treeOf({ pageId, componentId, layoutId })
    const ids = nodeIdsOf(nodes)
    const verb = locked ? 'Lock' : 'Unlock'
    const project = await ctx.services.mutate(ctx, projectId, ids.length > 1 ? `${verb} ${ids.length}` : verb, ids.map(nodeId => ({ op: 'setNodeMeta' as const, ...tree, nodeId, locked })))
    return { version: project.version }
  }
})

export const nodeMove = defineAction({
  name: 'node_move',
  description: 'Move a node into a container at the given index (the index the node will have after the move).',
  input: z.object({ ...Target, nodeId: IdSchema, parentId: IdSchema, index: z.number().int().nonnegative() }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, pageId, componentId, layoutId, nodeId, parentId, index }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Move', [{ op: 'move', ...treeOf({ pageId, componentId, layoutId }), nodeId, parentId, index }])
    return { version: project.version }
  }
})

export const nodeMoveMany = defineAction({
  name: 'node_move_many',
  description: 'Run several node_move moves in order as one undo step (all or nothing), e.g. to reorder a selection. Each index is the one the node will have right after its own move.',
  input: z.object({
    ...Target,
    moves: z.array(z.object({ nodeId: IdSchema, parentId: IdSchema, index: z.number().int().nonnegative() })).min(1)
  }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, pageId, componentId, layoutId, moves }, ctx) => {
    const tree = treeOf({ pageId, componentId, layoutId })
    const project = await ctx.services.mutate(ctx, projectId, moves.length > 1 ? `Move ${moves.length}` : 'Move', moves.map(move => ({ op: 'move' as const, ...tree, ...move })))
    return { version: project.version }
  }
})

export const nodeDelete = defineAction({
  name: 'node_delete',
  description: 'Delete a node and its children. The page (or component or layout) root cannot be deleted. With nodeIds, deletes every node as one undo step (nodes inside another listed node go with it).',
  input: z.object({ ...Target, ...Nodes }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, pageId, componentId, layoutId, ...nodes }, ctx) => {
    const ids = nodeIdsOf(nodes)
    const tree = treeOf({ pageId, componentId, layoutId })
    const targets = ids.length > 1 ? outermost(await loadTree(ctx, projectId, tree), ids, 'deleted').map(n => n.id) : ids
    const label = targets.length > 1 ? `Delete ${targets.length}` : 'Delete'
    const project = await ctx.services.mutate(ctx, projectId, label, targets.map(nodeId => ({ op: 'remove' as const, ...tree, nodeId })))
    return { version: project.version }
  }
})

export const WRAP_TYPES = ['Container', 'Row', 'Column', 'Card', 'Grid'] as const

export const nodeWrap = defineAction({
  name: 'node_wrap',
  description: 'Wrap a node in a new container (Container by default) placed where the node was; the node becomes its only child. With nodeIds, wraps several siblings (nodes of one parent) together, like Figma\'s group (Container) or auto layout (Row / Column, Shift+A): the container goes where the first of them was and holds them in the nodeIds order. style sets design tokens on the container, e.g. { "gap": "6" }. One undo step. Returns the container id.',
  input: z.object({
    ...Target,
    ...Nodes,
    type: z.enum(WRAP_TYPES).optional().describe('The wrapping container type; defaults to Container'),
    style: StyleSchema.optional().describe('Design tokens added to the container default style, e.g. { "gap": "6" }')
  }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, pageId, componentId, layoutId, type = 'Container', style, ...nodes }, ctx) => {
    const ids = nodeIdsOf(nodes)
    const tree = treeOf({ pageId, componentId, layoutId })
    const { root, rootName } = await loadTree(ctx, projectId, tree)
    for (const id of ids) assertFound(findNode(root, id), `Node "${id}" not found`)
    const locations = ids.map(id => findParent(root, id))
    if (locations.some(location => !location)) throw new ActionError('forbidden', `The ${rootName} cannot be wrapped`)
    const parent = locations[0]!.parent
    if (locations.some(location => location!.parent !== parent)) throw new ActionError('invalid', 'Only siblings (nodes of one parent) can be wrapped together')
    const wrapper = createNode(type)
    wrapper.style = { ...wrapper.style, ...style }
    const project = await ctx.services.mutate(ctx, projectId, `Wrap in ${type}`, [
      { op: 'insert', ...tree, parentId: parent.id, index: Math.min(...locations.map(location => location!.index)), node: wrapper },
      ...ids.map((nodeId, index) => ({ op: 'move' as const, ...tree, nodeId, parentId: wrapper.id, index }))
    ])
    return { version: project.version, nodeId: wrapper.id }
  }
})

export const nodeDuplicate = defineAction({
  name: 'node_duplicate',
  description: 'Duplicate a node (with its children) right after itself. Returns the copy id. With nodeIds, duplicates every node as one undo step and returns the copy ids in the nodeIds order (nodeId is the first copy).',
  input: z.object({ ...Target, ...Nodes }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, pageId, componentId, layoutId, ...nodes }, ctx) => {
    const tree = treeOf({ pageId, componentId, layoutId })
    const loaded = await loadTree(ctx, projectId, tree)
    const originals = outermost(loaded, nodeIdsOf(nodes), 'duplicated')
    const inserts = originals.map((node) => {
      const location = findParent(loaded.root, node.id)!
      return { op: 'insert' as const, ...tree, parentId: location.parent.id, index: location.index + 1, node: cloneWithNewIds(node) }
    })
    // From the last sibling up, so an insert never shifts the index of one still to run.
    const ops = [...inserts].sort((a, b) => b.index - a.index)
    const label = inserts.length > 1 ? `Duplicate ${inserts.length}` : 'Duplicate'
    const project = await ctx.services.mutate(ctx, projectId, label, ops)
    const copies = inserts.map(insert => insert.node.id)
    return { version: project.version, nodeId: copies[0]!, nodeIds: copies }
  }
})
