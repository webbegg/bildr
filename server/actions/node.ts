import { z } from 'zod'
import { cloneWithNewIds, createNode } from '#shared/document/factory'
import { getComponent } from '#shared/document/components'
import type { PropValue } from '#shared/document/components'
import { IdSchema, PropValueSchema, StyleValueSchema } from '#shared/document/schema'
import type { DocNode } from '#shared/document/schema'
import { findNode, findParent } from '#shared/document/tree'
import { ActionError, defineAction } from './define'
import { assertFound } from './project'

interface NodeSpec {
  type: string
  props?: Record<string, PropValue>
  style?: Record<string, string>
  children?: NodeSpec[]
}

const NodeSpecSchema: z.ZodType<NodeSpec> = z.lazy(() => z.object({
  type: z.string().describe('Component type, see components_list'),
  props: z.record(z.string(), PropValueSchema).optional().describe('Overrides of the component default props'),
  style: z.record(z.string(), StyleValueSchema).optional().describe('CSS values keyed by camelCase style key, e.g. { "padding": "16px" }'),
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

export const nodeInsert = defineAction({
  name: 'node_insert',
  description: 'Insert a component, optionally with nested children, into a container node (defaults to the page root, at the end). Returns the new node id.',
  input: z.object({
    ...Target,
    parentId: IdSchema.optional().describe('Container node id; defaults to the page root'),
    index: z.number().int().nonnegative().optional().describe('Position among the parent children; defaults to the end'),
    type: z.string().describe('Component type, see components_list'),
    props: z.record(z.string(), PropValueSchema).optional(),
    style: z.record(z.string(), StyleValueSchema).optional(),
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
  description: 'Set style values of a node (camelCase CSS keys from components_list.styleKeys). A null or empty value removes the key.',
  input: z.object({ ...Target, nodeId: IdSchema, style: z.record(z.string(), StyleValueSchema.nullable()) }),
  run: async ({ projectId, pageId, nodeId, style }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Update style', [{ op: 'setStyle', pageId, nodeId, style }])
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

export const nodeDelete = defineAction({
  name: 'node_delete',
  description: 'Delete a node and its children. The page root cannot be deleted.',
  input: z.object({ ...Target, nodeId: IdSchema }),
  run: async ({ projectId, pageId, nodeId }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Delete', [{ op: 'remove', pageId, nodeId }])
    return { version: project.version }
  }
})

export const nodeDuplicate = defineAction({
  name: 'node_duplicate',
  description: 'Duplicate a node (with its children) right after itself. Returns the copy id.',
  input: z.object({ ...Target, nodeId: IdSchema }),
  run: async ({ projectId, pageId, nodeId }, ctx) => {
    const current = await ctx.services.loadProject(projectId)
    const page = assertFound(current.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
    const node = assertFound(findNode(page.root, nodeId), `Node "${nodeId}" not found`)
    const location = findParent(page.root, nodeId)
    if (!location) throw new ActionError('forbidden', 'The page root cannot be duplicated')
    const copy = cloneWithNewIds(node)
    const project = await ctx.services.mutate(ctx, projectId, 'Duplicate', [
      { op: 'insert', pageId, parentId: location.parent.id, index: location.index + 1, node: copy }
    ])
    return { version: project.version, nodeId: copy.id }
  }
})
