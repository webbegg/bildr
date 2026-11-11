import { z } from 'zod'
import { SLOT_FILL_TYPE } from '#shared/document/components'
import { createNode, createPage, newId } from '#shared/document/factory'
import type { Operation } from '#shared/document/operations'
import { CHILDREN_SLOT, IdSchema, PropertyBindingSchema, PropertyKindSchema, PropValueSchema } from '#shared/document/schema'
import type { Layout, Page, Project } from '#shared/document/schema'
import { ActionError, defineAction } from './define'
import { assertFound } from './project'

/**
 * Page layouts: a shared tree around the pages that use it, with a
 * `children` slot for the page content, named slots pages may fill, and
 * variables pages set. The layout tree is edited with the node actions and
 * `layoutId`; a page picks its layout, values and slot content here.
 */

const LayoutRef = IdSchema.describe('A layout id, from project_get layouts')
const NameSchema = z.string().trim().min(1).max(100)
const VariableKindSchema = PropertyKindSchema.exclude(['slot'])

function pagesUsing(project: Project, layoutId: string): Page[] {
  return project.pages.filter(p => p.layoutId === layoutId)
}

/** The page's own content for its layout's named slots (root SlotFills), optionally only for `slotId`. */
function slotFills(page: Page, slotId?: string) {
  return page.root.children.filter(c => c.type === SLOT_FILL_TYPE && (slotId === undefined || c.props.slot === slotId))
}

/** Detaches `page` from its layout: its slot content goes, then its layout and values. */
function detachOps(page: Page, layoutId: string | null = null): Operation[] {
  return [
    ...slotFills(page).map(fill => ({ op: 'remove' as const, pageId: page.id, nodeId: fill.id })),
    { op: 'setPageLayout', pageId: page.id, layoutId }
  ]
}

export const layoutCreate = defineAction({
  name: 'layout_create',
  description: 'Create a page layout: a Page root holding one Container, the children slot, where each page using the layout shows its own content. Add shared regions around it with node_insert { layoutId }, named slots with layout_slot_add and variables with layout_variable_add; pages pick it with page_set_layout. Returns the layout id and the children slot node id.',
  input: z.object({ projectId: IdSchema, name: NameSchema }),
  run: async ({ projectId, name }, ctx) => {
    const slotNode = createNode('Container')
    const root = { ...createPage(name).root, children: [slotNode] }
    const layout: Layout = { id: newId('lay'), name, root, slots: [{ id: CHILDREN_SLOT, name: 'Content', nodeId: slotNode.id }], variables: [] }
    const project = await ctx.services.mutate(ctx, projectId, 'Create layout', [{ op: 'addLayout', index: Number.MAX_SAFE_INTEGER, layout }])
    return { version: project.version, layoutId: layout.id, slotNodeId: slotNode.id }
  }
})

export const layoutRename = defineAction({
  name: 'layout_rename',
  description: 'Rename a layout.',
  input: z.object({ projectId: IdSchema, layoutId: LayoutRef, name: NameSchema }),
  run: async ({ projectId, layoutId, name }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Rename layout', [{ op: 'updateLayout', layoutId, name }])
    return { version: project.version }
  }
})

export const layoutDelete = defineAction({
  name: 'layout_delete',
  description: 'Delete a layout. The pages using it are detached: they keep their content but lose their layout values and their content for its named slots. One undo step brings everything back. Returns the detached page ids.',
  input: z.object({ projectId: IdSchema, layoutId: LayoutRef }),
  run: async ({ projectId, layoutId }, ctx) => {
    const pages = pagesUsing(await ctx.services.loadProject(projectId), layoutId)
    const project = await ctx.services.mutate(ctx, projectId, 'Delete layout', [
      ...pages.flatMap(page => detachOps(page)),
      { op: 'removeLayout', layoutId }
    ])
    return { version: project.version, detachedPages: pages.map(p => p.id) }
  }
})

export const layoutSlotAdd = defineAction({
  name: 'layout_slot_add',
  description: 'Add a named slot to a layout: a container node of the layout whose children are the default content, which a page can replace with its own (page_set_slot). A slot cannot share its node with another slot or sit inside one. Returns the slot id.',
  input: z.object({
    projectId: IdSchema,
    layoutId: LayoutRef,
    name: NameSchema,
    nodeId: IdSchema.describe('A container node of the layout'),
    index: z.number().int().nonnegative().optional().describe('Position in the slot list; defaults to the end')
  }),
  run: async ({ projectId, layoutId, name, nodeId, index }, ctx) => {
    const slot = { id: newId('slot'), name, nodeId }
    const project = await ctx.services.mutate(ctx, projectId, 'Add slot', [{ op: 'addLayoutSlot', layoutId, index: index ?? Number.MAX_SAFE_INTEGER, slot }])
    return { version: project.version, slotId: slot.id }
  }
})

export const layoutSlotUpdate = defineAction({
  name: 'layout_slot_update',
  description: 'Rename a layout slot and/or bind it to another container node of the layout.',
  input: z.object({ projectId: IdSchema, layoutId: LayoutRef, slotId: IdSchema, name: NameSchema.optional(), nodeId: IdSchema.optional() }),
  run: async ({ projectId, ...patch }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Update slot', [{ op: 'updateLayoutSlot', ...patch }])
    return { version: project.version }
  }
})

export const layoutSlotRemove = defineAction({
  name: 'layout_slot_remove',
  description: 'Remove a named slot from a layout (the children slot stays). The pages\' own content for it is removed with it, as one undo step.',
  input: z.object({ projectId: IdSchema, layoutId: LayoutRef, slotId: IdSchema }),
  run: async ({ projectId, layoutId, slotId }, ctx) => {
    const pages = pagesUsing(await ctx.services.loadProject(projectId), layoutId)
    const fills = slotId === CHILDREN_SLOT ? [] : pages.flatMap(page => slotFills(page, slotId).map(fill => ({ op: 'remove' as const, pageId: page.id, nodeId: fill.id })))
    const project = await ctx.services.mutate(ctx, projectId, 'Remove slot', [...fills, { op: 'removeLayoutSlot', layoutId, slotId }])
    return { version: project.version }
  }
})

const VariableFields = {
  default: PropValueSchema.optional().describe('The value pages get when they set none'),
  bindings: z.array(PropertyBindingSchema).optional().describe('The layout node props the variable drives, e.g. [{ "nodeId": "n_title", "prop": "text" }]. With "target": "style", prop is a style key of the node instead, e.g. [{ "nodeId": "n_bar", "prop": "bg", "target": "style" }] (text or select variables; values must be values of that key)')
}

export const layoutVariableAdd = defineAction({
  name: 'layout_variable_add',
  description: 'Add a variable to a layout, which each page sets (page_set_layout_values). kind is a prop kind (text, number, boolean, select, link, image, icon...). A variable drives the bound props of layout nodes (their kind must match), or with target "style" a bound style key (values must be values of that key), and layout strings can use {{ layout.NAME }}. Returns the variable id, the key of page values.',
  input: z.object({
    projectId: IdSchema,
    layoutId: LayoutRef,
    name: NameSchema,
    kind: VariableKindSchema,
    ...VariableFields,
    index: z.number().int().nonnegative().optional().describe('Position in the variable list; defaults to the end')
  }),
  run: async ({ projectId, layoutId, name, kind, default: value, bindings = [], index }, ctx) => {
    const variable = { id: newId('var'), name, kind, ...(value === undefined ? {} : { default: value }), bindings }
    const project = await ctx.services.mutate(ctx, projectId, 'Add variable', [{ op: 'addLayoutVariable', layoutId, index: index ?? Number.MAX_SAFE_INTEGER, variable }])
    return { version: project.version, variableId: variable.id }
  }
})

export const layoutVariableUpdate = defineAction({
  name: 'layout_variable_update',
  description: 'Change a layout variable: name, default (null removes it) or bindings. To change its kind, remove it and add it again.',
  input: z.object({
    projectId: IdSchema,
    layoutId: LayoutRef,
    variableId: IdSchema,
    name: NameSchema.optional(),
    default: PropValueSchema.nullable().optional().describe('The value pages get when they set none; null removes it'),
    bindings: VariableFields.bindings
  }),
  run: async ({ projectId, ...patch }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Update variable', [{ op: 'updateLayoutVariable', ...patch }])
    return { version: project.version }
  }
})

export const layoutVariableRemove = defineAction({
  name: 'layout_variable_remove',
  description: 'Remove a layout variable. The pages\' values for it are removed with it, as one undo step.',
  input: z.object({ projectId: IdSchema, layoutId: LayoutRef, variableId: IdSchema }),
  run: async ({ projectId, layoutId, variableId }, ctx) => {
    const pages = pagesUsing(await ctx.services.loadProject(projectId), layoutId).filter(page => page.layoutValues && variableId in page.layoutValues)
    const project = await ctx.services.mutate(ctx, projectId, 'Remove variable', [
      ...pages.map(page => ({ op: 'setLayoutValues' as const, pageId: page.id, values: { [variableId]: null } })),
      { op: 'removeLayoutVariable', layoutId, variableId }
    ])
    return { version: project.version }
  }
})

export const pageSetLayout = defineAction({
  name: 'page_set_layout',
  description: 'Set the layout a page renders in (a layout id), or null for none. The page content goes into the layout\'s children slot. Changing or removing the layout drops the page\'s layout values and its content for named slots, as one undo step.',
  input: z.object({ projectId: IdSchema, pageId: IdSchema, layoutId: LayoutRef.nullable() }),
  run: async ({ projectId, pageId, layoutId }, ctx) => {
    const current = await ctx.services.loadProject(projectId)
    const page = assertFound(current.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
    if ((page.layoutId ?? null) === layoutId) return { version: current.version }
    const project = await ctx.services.mutate(ctx, projectId, 'Set page layout', detachOps(page, layoutId))
    return { version: project.version }
  }
})

export const pageSetLayoutValues = defineAction({
  name: 'page_set_layout_values',
  description: 'Set a page\'s values for its layout\'s variables (keys are variable ids, values are checked against the variable); null removes one, so the default applies.',
  input: z.object({ projectId: IdSchema, pageId: IdSchema, values: z.record(IdSchema, PropValueSchema.nullable()) }),
  run: async ({ projectId, pageId, values }, ctx) => {
    if (!Object.keys(values).length) throw new ActionError('invalid', 'Give at least one value')
    const project = await ctx.services.mutate(ctx, projectId, 'Set layout values', [{ op: 'setLayoutValues', pageId, values }])
    return { version: project.version }
  }
})

export const pageSetSlot = defineAction({
  name: 'page_set_slot',
  description: 'Fill or clear a named slot of a page\'s layout. filled: true gives the page its own content for the slot (a SlotFill node at the page root, empty at first) and returns its fillId: add content with node_insert { pageId, parentId: fillId }, or move page nodes in with nodeIds. filled: false removes that content, so the layout\'s default content shows again. The children slot always shows the page content.',
  input: z.object({
    projectId: IdSchema,
    pageId: IdSchema,
    slot: IdSchema.describe('The slot id, from project_get layouts[].slots'),
    filled: z.boolean(),
    nodeIds: z.array(IdSchema).min(1).optional().describe('With filled: page nodes to move into the slot, in order')
  }),
  run: async ({ projectId, pageId, slot, filled, nodeIds = [] }, ctx) => {
    const current = await ctx.services.loadProject(projectId)
    const page = assertFound(current.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
    if (page.layoutId === undefined) throw new ActionError('invalid', `Page "${page.name}" has no layout`)
    const [existing] = slotFills(page, slot)
    if (!filled) {
      if (nodeIds.length) throw new ActionError('invalid', 'nodeIds needs filled: true')
      const project = existing ? await ctx.services.mutate(ctx, projectId, 'Clear slot', [{ op: 'remove', pageId, nodeId: existing.id }]) : current
      return { version: project.version, fillId: null }
    }
    const fill = existing ?? createNode(SLOT_FILL_TYPE, { slot })
    const ops: Operation[] = [
      ...(existing ? [] : [{ op: 'insert' as const, pageId, parentId: page.root.id, index: Number.MAX_SAFE_INTEGER, node: fill }]),
      ...nodeIds.map((id, i) => ({ op: 'move' as const, pageId, nodeId: id, parentId: fill.id, index: fill.children.length + i }))
    ]
    const project = ops.length ? await ctx.services.mutate(ctx, projectId, 'Fill slot', ops) : current
    return { version: project.version, fillId: fill.id }
  }
})
