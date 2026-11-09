import { z } from 'zod'
import { cloneWithNewIds, createNode } from '#shared/document/factory'
import { getComponent } from '#shared/document/components'
import type { PropValue } from '#shared/document/components'
import { STYLE_TOKENS, styleKey, variantsOf } from '#shared/design/tokens'
import type { StyleToken } from '#shared/design/tokens'
import { IdSchema, PropValueSchema } from '#shared/document/schema'
import type { DocNode, Page } from '#shared/document/schema'
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
 * One optional key per design token and breakpoint (`cols`, `sm:cols`, `md:cols`, `lg:cols`),
 * its value an enum, so the MCP schema lists every allowed value.
 */
// A multi-value literal rather than z.enum, which reorders numeric-looking values ("10" before "0.5").
function styleTokensSchema(wrap: (values: z.ZodLiteral<string>, token: StyleToken) => z.ZodType) {
  return z.object(Object.fromEntries(STYLE_TOKENS.flatMap(t => variantsOf(t).map(b => [
    styleKey(t.key, b),
    wrap(z.literal(t.values), t).optional().describe(b
      ? `${t.label} from the ${b} breakpoint up: Tailwind class ${b}:${t.prefix ? `${t.prefix}-` : ''}<value>`
      : `${t.label}: Tailwind class ${t.prefix ? `${t.prefix}-` : ''}<value>`)
  ])))).strict()
}

const StyleSchema = styleTokensSchema(values => values)
  .describe('Design tokens, e.g. { "mt": "10", "bg": "primary", "rounded": "lg" } renders class="mt-10 bg-primary rounded-lg". Layout tokens (Spacing, Size, Typography, Layout) also take a mobile-first breakpoint prefix sm:, md: or lg:, e.g. { "cols": "1", "md:cols": "3" } renders class="grid-cols-1 md:grid-cols-3". See components_list.tokens') as z.ZodType<Record<string, string>>
const StyleUpdateSchema = styleTokensSchema(values => values.nullable())
  .describe('Design tokens to set; null removes a token') as z.ZodType<Record<string, string | null>>

const NodeSpecSchema: z.ZodType<NodeSpec> = z.lazy(() => z.object({
  type: z.string().describe('Component type, see components_list'),
  props: z.record(z.string(), PropValueSchema).optional().describe('Overrides of the component default props'),
  style: StyleSchema.optional().describe('Design tokens added to the component default style'),
  children: z.array(NodeSpecSchema).optional().describe('Child nodes; only for container components')
}))

function buildNode(spec: NodeSpec): DocNode {
  if (!getComponent(spec.type)) throw new ActionError('invalid', `Unknown component type "${spec.type}"`)
  const node = createNode(spec.type, spec.props)
  node.style = { ...node.style, ...spec.style }
  node.children = (spec.children ?? []).map(buildNode)
  return node
}

const Target = { projectId: IdSchema, pageId: IdSchema }

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

async function loadPage(ctx: ActionContext, projectId: string, pageId: string): Promise<Page> {
  const current = await ctx.services.loadProject(projectId)
  return assertFound(current.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
}

/** The nodes of `ids` that are not inside another one of them, in `ids` order; refuses missing nodes and the root. */
function outermost(page: Page, ids: string[], verb: string): DocNode[] {
  const nodes = ids.map(id => assertFound(findNode(page.root, id), `Node "${id}" not found`))
  if (nodes.includes(page.root)) throw new ActionError('forbidden', `The page root cannot be ${verb}`)
  return nodes.filter(node => !nodes.some(other => other !== node && containsNode(other, node.id)))
}

export const nodeInsert = defineAction({
  name: 'node_insert',
  description: 'Insert a component, optionally with nested children, into a container node (defaults to the page root, at the end). Returns the new node id. Inside a List (bound to a collection slug), string props of its children such as text, label, src and to can use bindings like "{{ item.name }}" or "/menu/{{ item.id }}", resolved per record.',
  input: z.object({
    ...Target,
    parentId: IdSchema.optional().describe('Container node id; defaults to the page root'),
    index: z.number().int().nonnegative().optional().describe('Position among the parent children; defaults to the end'),
    type: z.string().describe('Component type, see components_list'),
    props: z.record(z.string(), PropValueSchema).optional(),
    style: StyleSchema.optional(),
    children: z.array(NodeSpecSchema).optional()
  }),
  run: async ({ projectId, pageId, parentId, index, ...spec }, ctx) => {
    const node = buildNode(spec)
    const current = await ctx.services.loadProject(projectId)
    const page = assertFound(current.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
    const project = await ctx.services.mutate(ctx, projectId, `Insert ${spec.type}`, [
      { op: 'insert', pageId, parentId: parentId ?? page.root.id, index: index ?? Number.MAX_SAFE_INTEGER, node }
    ])
    return { version: project.version, nodeId: node.id }
  }
})

export const nodeUpdateProps = defineAction({
  name: 'node_update_props',
  description: 'Set props of a node. Only props declared by the component are allowed; a null value removes the prop.',
  input: z.object({ ...Target, nodeId: IdSchema, props: z.record(z.string(), PropValueSchema.nullable()) }),
  run: async ({ projectId, pageId, nodeId, props }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Update props', [{ op: 'setProps', pageId, nodeId, props }])
    return { version: project.version }
  }
})

export const nodeUpdateStyle = defineAction({
  name: 'node_update_style',
  description: 'Set design tokens of a node, e.g. { "mt": "10", "bg": "primary" } (keys and values from components_list.tokens). Tokens listing breakpoints also take a mobile-first prefix, e.g. { "md:cols": "3" } applies from the md breakpoint up. A null value removes the token. With nodeIds the same tokens go to every node, as one undo step (all or nothing).',
  input: z.object({ ...Target, ...Nodes, style: StyleUpdateSchema }),
  run: async ({ projectId, pageId, style, ...nodes }, ctx) => {
    const ops = nodeIdsOf(nodes).map(nodeId => ({ op: 'setStyle' as const, pageId, nodeId, style }))
    const project = await ctx.services.mutate(ctx, projectId, 'Update style', ops)
    return { version: project.version }
  }
})

export const nodeMove = defineAction({
  name: 'node_move',
  description: 'Move a node into a container at the given index (the index the node will have after the move).',
  input: z.object({ ...Target, nodeId: IdSchema, parentId: IdSchema, index: z.number().int().nonnegative() }),
  run: async ({ projectId, pageId, nodeId, parentId, index }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Move', [{ op: 'move', pageId, nodeId, parentId, index }])
    return { version: project.version }
  }
})

export const nodeMoveMany = defineAction({
  name: 'node_move_many',
  description: 'Run several node_move moves in order as one undo step (all or nothing), e.g. to reorder a selection. Each index is the one the node will have right after its own move.',
  input: z.object({
    ...Target,
    moves: z.array(z.object({ nodeId: IdSchema, parentId: IdSchema, index: z.number().int().nonnegative() })).min(1)
  }),
  run: async ({ projectId, pageId, moves }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, moves.length > 1 ? `Move ${moves.length}` : 'Move', moves.map(move => ({ op: 'move' as const, pageId, ...move })))
    return { version: project.version }
  }
})

export const nodeDelete = defineAction({
  name: 'node_delete',
  description: 'Delete a node and its children. The page root cannot be deleted. With nodeIds, deletes every node as one undo step (nodes inside another listed node go with it).',
  input: z.object({ ...Target, ...Nodes }),
  run: async ({ projectId, pageId, ...nodes }, ctx) => {
    const ids = nodeIdsOf(nodes)
    const targets = ids.length > 1 ? outermost(await loadPage(ctx, projectId, pageId), ids, 'deleted').map(n => n.id) : ids
    const label = targets.length > 1 ? `Delete ${targets.length}` : 'Delete'
    const project = await ctx.services.mutate(ctx, projectId, label, targets.map(nodeId => ({ op: 'remove' as const, pageId, nodeId })))
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
  }),
  run: async ({ projectId, pageId, type = 'Container', style, ...nodes }, ctx) => {
    const ids = nodeIdsOf(nodes)
    const page = await loadPage(ctx, projectId, pageId)
    for (const id of ids) assertFound(findNode(page.root, id), `Node "${id}" not found`)
    const locations = ids.map(id => findParent(page.root, id))
    if (locations.some(location => !location)) throw new ActionError('forbidden', 'The page root cannot be wrapped')
    const parent = locations[0]!.parent
    if (locations.some(location => location!.parent !== parent)) throw new ActionError('invalid', 'Only siblings (nodes of one parent) can be wrapped together')
    const wrapper = createNode(type)
    wrapper.style = { ...wrapper.style, ...style }
    const project = await ctx.services.mutate(ctx, projectId, `Wrap in ${type}`, [
      { op: 'insert', pageId, parentId: parent.id, index: Math.min(...locations.map(location => location!.index)), node: wrapper },
      ...ids.map((nodeId, index) => ({ op: 'move' as const, pageId, nodeId, parentId: wrapper.id, index }))
    ])
    return { version: project.version, nodeId: wrapper.id }
  }
})

export const nodeDuplicate = defineAction({
  name: 'node_duplicate',
  description: 'Duplicate a node (with its children) right after itself. Returns the copy id. With nodeIds, duplicates every node as one undo step and returns the copy ids in the nodeIds order (nodeId is the first copy).',
  input: z.object({ ...Target, ...Nodes }),
  run: async ({ projectId, pageId, ...nodes }, ctx) => {
    const page = await loadPage(ctx, projectId, pageId)
    const originals = outermost(page, nodeIdsOf(nodes), 'duplicated')
    const inserts = originals.map((node) => {
      const location = findParent(page.root, node.id)!
      return { op: 'insert' as const, pageId, parentId: location.parent.id, index: location.index + 1, node: cloneWithNewIds(node) }
    })
    // From the last sibling up, so an insert never shifts the index of one still to run.
    const ops = [...inserts].sort((a, b) => b.index - a.index)
    const label = inserts.length > 1 ? `Duplicate ${inserts.length}` : 'Duplicate'
    const project = await ctx.services.mutate(ctx, projectId, label, ops)
    const copies = inserts.map(insert => insert.node.id)
    return { version: project.version, nodeId: copies[0]!, nodeIds: copies }
  }
})
