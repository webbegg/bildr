import { z } from 'zod'
import { INSTANCE_TYPE, SLOT_FILL_TYPE } from '#shared/document/components'
import { cloneWithNewIds, createNode, newId } from '#shared/document/factory'
import type { Operation, TreeRef } from '#shared/document/operations'
import { IdSchema, PropertyBindingSchema, PropertyKindSchema, PropValueSchema, RESERVED_INSTANCE_KEYS } from '#shared/document/schema'
import type { ComponentDefinition, DocNode, Project } from '#shared/document/schema'
import { findNode, findParent } from '#shared/document/tree'
import { componentInstances, componentUsages } from '#shared/document/usages'
import { ActionError, defineAction } from './define'
import { ONE_TREE, oneTree, treeOf } from './node'
import { assertFound } from './project'

/**
 * User-defined components: definitions made from a selection, their
 * properties and variants, and the values and slot content of instances.
 * Instances themselves are `Instance` nodes, inserted and moved with the
 * node actions.
 */

const ComponentRef = IdSchema.describe('A component id, from project_get components')
const NameSchema = z.string().trim().min(1).max(100)

/** The tree that holds an Instance: a page, a component definition for a nested instance, or a layout. */
const InstanceTarget = {
  projectId: IdSchema,
  pageId: IdSchema.optional().describe('The page the instance is on; or give componentId or layoutId'),
  componentId: IdSchema.optional().describe('The component definition the instance is nested in; replaces pageId'),
  layoutId: IdSchema.optional().describe('The layout the instance is in; replaces pageId'),
  nodeId: IdSchema.describe('The Instance node')
}

function treeRoot(project: Project, tree: TreeRef): DocNode {
  if (tree.pageId !== undefined) return assertFound(project.pages.find(p => p.id === tree.pageId), `Page "${tree.pageId}" not found`).root
  if (tree.layoutId !== undefined) return assertFound(project.layouts.find(l => l.id === tree.layoutId), `Layout "${tree.layoutId}" not found`).root
  return definitionIn(project, tree.componentId).root
}

function definitionIn(project: Project, componentId: string): ComponentDefinition {
  return assertFound(project.components.find(c => c.id === componentId), `Component "${componentId}" not found`)
}

function instanceIn(project: Project, tree: TreeRef, nodeId: string): DocNode {
  const node = assertFound(findNode(treeRoot(project, tree), nodeId), `Node "${nodeId}" not found`)
  if (node.type !== INSTANCE_TYPE) throw new ActionError('invalid', `Node "${nodeId}" is a ${node.type}, not a component instance`)
  return node
}

export const componentCreate = defineAction({
  name: 'component_create',
  description: 'Turn a selection into a reusable component: the node (or, with nodeIds, several siblings wrapped in a Container, in the nodeIds order) becomes the definition, with ids of its own, and an Instance of it takes its place on the page. Instances render the definition, so editing it updates every instance. name may use / for folders, e.g. "Cards/Product". One undo step. Returns the component id and the instance node id.',
  input: z.object({
    projectId: IdSchema,
    pageId: IdSchema,
    nodeId: IdSchema.optional().describe('The node to turn into a component; or give nodeIds'),
    nodeIds: z.array(IdSchema).min(1).optional().describe('Several siblings to turn into one component; replaces nodeId'),
    name: NameSchema
  }),
  run: async ({ projectId, pageId, nodeId, nodeIds, name }, ctx) => {
    const ids = [...new Set(nodeIds ?? (nodeId ? [nodeId] : []))]
    if (!ids.length) throw new ActionError('invalid', 'Give nodeId or nodeIds')
    const current = await ctx.services.loadProject(projectId)
    const page = assertFound(current.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
    const nodes = ids.map(id => assertFound(findNode(page.root, id), `Node "${id}" not found`))
    const locations = ids.map(id => findParent(page.root, id))
    if (locations.some(location => !location)) throw new ActionError('forbidden', 'The page root cannot become a component')
    const parent = locations[0]!.parent
    if (locations.some(location => location!.parent !== parent)) throw new ActionError('invalid', 'Only siblings (nodes of one parent) can become one component')

    const root = nodes.length === 1 ? cloneWithNewIds(nodes[0]!) : { ...createNode('Container'), children: nodes.map(cloneWithNewIds) }
    const component: ComponentDefinition = { id: newId('cmp'), name, root, properties: [], variants: [] }
    const instance = createNode(INSTANCE_TYPE, { component: component.id })
    const project = await ctx.services.mutate(ctx, projectId, 'Create component', [
      { op: 'addComponent', index: Number.MAX_SAFE_INTEGER, component },
      ...ids.map(id => ({ op: 'remove' as const, pageId, nodeId: id })),
      { op: 'insert', pageId, parentId: parent.id, index: Math.min(...locations.map(location => location!.index)), node: instance }
    ])
    return { version: project.version, componentId: component.id, nodeId: instance.id }
  }
})

export const componentRename = defineAction({
  name: 'component_rename',
  description: 'Rename a component. / in the name makes folders, e.g. "Cards/Product".',
  input: z.object({ projectId: IdSchema, componentId: ComponentRef, name: NameSchema }),
  run: async ({ projectId, componentId, name }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Rename component', [{ op: 'updateComponent', componentId, name }])
    return { version: project.version }
  }
})

export const componentDelete = defineAction({
  name: 'component_delete',
  description: 'Delete a component. Refused while instances use it (the error lists them: on pages, in other components and in layouts), unless force is true: then its instances are deleted too. One undo step brings everything back. Returns the deleted instance ids.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    force: z.boolean().optional().describe('Also delete the instances of the component')
  }),
  run: async ({ projectId, componentId, force }, ctx) => {
    const usages = force ? componentUsages(await ctx.services.loadProject(projectId), componentId) : []
    const project = await ctx.services.mutate(ctx, projectId, 'Delete component', [
      ...usages.map(usage => ({ op: 'remove' as const, ...treeOf(usage), nodeId: usage.nodeId })),
      { op: 'removeComponent', componentId }
    ])
    return { version: project.version, deletedInstances: usages.map(usage => usage.nodeId) }
  }
})

const PropertyFields = {
  default: PropValueSchema.optional().describe('The value instances get when they set none'),
  bindings: z.array(PropertyBindingSchema).optional().describe('The definition node props the property drives, e.g. [{ "nodeId": "n_title", "prop": "text" }]; a slot binds one container with prop "children". With "target": "style", prop is a style key of the node instead, e.g. [{ "nodeId": "n_title", "prop": "color", "target": "style" }] (text or select properties; values must be values of that key)')
}

export const componentPropertyAdd = defineAction({
  name: 'component_property_add',
  description: 'Add a property to a component. kind is a prop kind (text, number, boolean, select, link, image, icon...) or slot. A property drives the bound props of definition nodes (their kind must match; select takes the options of its targets), or with target "style" a bound style key (a text or select property whose values are values of that key: a token, or for colour keys also a hex or theme colour), and definition strings can use {{ prop.NAME }}. A slot binds one container node, whose children are the default content. Returns the property id, which is the key of instance values.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    name: NameSchema,
    kind: PropertyKindSchema,
    ...PropertyFields,
    index: z.number().int().nonnegative().optional().describe('Position in the property list; defaults to the end')
  }),
  run: async ({ projectId, componentId, name, kind, default: value, bindings = [], index }, ctx) => {
    const property = { id: newId('prop'), name, kind, ...(value === undefined ? {} : { default: value }), bindings }
    const project = await ctx.services.mutate(ctx, projectId, 'Add property', [
      { op: 'addProperty', componentId, index: index ?? Number.MAX_SAFE_INTEGER, property }
    ])
    return { version: project.version, propertyId: property.id }
  }
})

export const componentPropertyUpdate = defineAction({
  name: 'component_property_update',
  description: 'Change a component property: name, default (null removes it) or bindings. To change its kind, remove it and add it again.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    propertyId: IdSchema,
    name: NameSchema.optional(),
    default: PropValueSchema.nullable().optional().describe('The value instances get when they set none; null removes it'),
    bindings: PropertyFields.bindings
  }),
  run: async ({ projectId, ...patch }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Update property', [{ op: 'updateProperty', ...patch }])
    return { version: project.version }
  }
})

export const componentPropertyRemove = defineAction({
  name: 'component_property_remove',
  description: 'Remove a component property. Instance values for it, and the slot content of a slot property, are removed with it, as one undo step.',
  input: z.object({ projectId: IdSchema, componentId: ComponentRef, propertyId: IdSchema }),
  run: async ({ projectId, componentId, propertyId }, ctx) => {
    const ops: Operation[] = []
    // Innermost first, so removing an outer slot fill never takes one still to remove.
    for (const instance of componentInstances(await ctx.services.loadProject(projectId), componentId).reverse()) {
      const tree = treeOf(instance)
      if (propertyId in instance.node.props) ops.push({ op: 'setProps', ...tree, nodeId: instance.nodeId, props: { [propertyId]: null } })
      for (const fill of instance.node.children.filter(c => c.type === SLOT_FILL_TYPE && c.props.slot === propertyId)) ops.push({ op: 'remove', ...tree, nodeId: fill.id })
    }
    const project = await ctx.services.mutate(ctx, projectId, 'Remove property', [...ops, { op: 'removeProperty', componentId, propertyId }])
    return { version: project.version }
  }
})

export const componentVariantAdd = defineAction({
  name: 'component_variant_add',
  description: 'Add a variant to a component. It starts identical to the primary variant (the definition itself); component_variant_set_override changes it. Returns the variant id, which instances select with instance_set_values.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    name: NameSchema,
    index: z.number().int().nonnegative().optional().describe('Position in the variant list; defaults to the end')
  }),
  run: async ({ projectId, componentId, name, index }, ctx) => {
    const variant = { id: newId('var'), name, overrides: {} }
    const project = await ctx.services.mutate(ctx, projectId, 'Add variant', [
      { op: 'addVariant', componentId, index: index ?? Number.MAX_SAFE_INTEGER, variant }
    ])
    return { version: project.version, variantId: variant.id }
  }
})

export const componentVariantDelete = defineAction({
  name: 'component_variant_delete',
  description: 'Delete a variant of a component. Instances that used it go back to the primary variant, as one undo step.',
  input: z.object({ projectId: IdSchema, componentId: ComponentRef, variantId: IdSchema }),
  run: async ({ projectId, componentId, variantId }, ctx) => {
    const users = componentInstances(await ctx.services.loadProject(projectId), componentId).filter(i => i.node.props.variant === variantId)
    const project = await ctx.services.mutate(ctx, projectId, 'Delete variant', [
      ...users.map(user => ({ op: 'setProps' as const, ...treeOf(user), nodeId: user.nodeId, props: { variant: null } })),
      { op: 'removeVariant', componentId, variantId }
    ])
    return { version: project.version }
  }
})

export const componentVariantRename = defineAction({
  name: 'component_variant_rename',
  description: 'Rename a variant of a component. Instances keep using it (they refer to its id).',
  input: z.object({ projectId: IdSchema, componentId: ComponentRef, variantId: IdSchema, name: NameSchema }),
  run: async ({ projectId, componentId, variantId, name }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Rename variant', [{ op: 'updateVariant', componentId, variantId, name }])
    return { version: project.version }
  }
})

const OverrideFields = {
  props: z.record(z.string(), PropValueSchema.nullable()).optional().describe('Props of the node to override; null resets one'),
  style: z.record(z.string(), z.string().nullable()).optional().describe('Design tokens of the node to override (see components_list.tokens); null resets one (a set value, or a removal)'),
  unset: z.array(z.string()).optional().describe('Style keys to remove in this variant, e.g. ["bg", "md:p"]: they render as absent even where the primary sets them; a null in style resets one. A key cannot be in both style and unset')
}

export const componentVariantSetOverride = defineAction({
  name: 'component_variant_set_override',
  description: 'Override props and design tokens of definition nodes in a variant, or remove primary tokens there (unset). A variant stores only what differs from the primary: a null value, or the primary\'s own value, resets that override (removes it, or a removal), so the primary\'s value shows again. One node: nodeId with props, style and/or unset. Several nodes: overrides, a list of { nodeId, props?, style?, unset? }, applied as one undo step, all or nothing (one bad entry changes nothing). Give one form, not both.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    variantId: IdSchema,
    nodeId: IdSchema.optional().describe('A node of the component definition; or give overrides'),
    ...OverrideFields,
    overrides: z.array(z.object({ nodeId: IdSchema.describe('A node of the component definition'), ...OverrideFields })).min(1).optional()
      .describe('Per-node overrides applied as one undo step, all or nothing; replaces nodeId, props, style and unset')
  }),
  run: async ({ projectId, componentId, variantId, overrides, ...single }, ctx) => {
    const singleGiven = Object.values(single).some(value => value !== undefined)
    if (overrides && singleGiven) throw new ActionError('invalid', 'Give nodeId (with props, style or unset) or overrides, not both')
    const { nodeId, ...patch } = single
    const entries = overrides ?? (nodeId === undefined ? [] : [{ nodeId, ...patch }])
    if (!entries.length) throw new ActionError('invalid', 'Give nodeId or overrides')
    const project = await ctx.services.mutate(ctx, projectId, 'Override variant', entries.map(entry => ({ op: 'setOverride' as const, componentId, variantId, ...entry })))
    return { version: project.version }
  }
})

export const instanceSetValues = defineAction({
  name: 'instance_set_values',
  description: 'Set property values of a component instance (keys are property ids, values are checked against the property, and against the style key of a style binding; null removes one, so the default applies) and/or its variant (a variant id; null or "" for the primary).',
  input: z.object({
    ...InstanceTarget,
    values: z.record(z.string(), PropValueSchema.nullable()).optional(),
    variant: z.union([IdSchema, z.literal('')]).nullable().optional()
  }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, nodeId, values = {}, variant, ...tree }, ctx) => {
    const reserved = Object.keys(values).find(key => (RESERVED_INSTANCE_KEYS as readonly string[]).includes(key))
    if (reserved) throw new ActionError('invalid', `"${reserved}" is not a property id`)
    const props = { ...values, ...(variant === undefined ? {} : { variant: variant || null }) }
    if (!Object.keys(props).length) throw new ActionError('invalid', 'Give values or variant')
    const project = await ctx.services.mutate(ctx, projectId, 'Set instance values', [{ op: 'setProps', ...treeOf(tree), nodeId, props }])
    return { version: project.version }
  }
})

export const instanceSetSlot = defineAction({
  name: 'instance_set_slot',
  description: 'Fill or clear a slot of a component instance. filled: true gives the slot its own content (a SlotFill node, empty at first) and returns its fillId: add content with node_insert { parentId: fillId }, or move nodes in with nodeIds. filled: false removes that content, so the component\'s default content shows again.',
  input: z.object({
    ...InstanceTarget,
    slot: IdSchema.describe('The slot property id'),
    filled: z.boolean(),
    nodeIds: z.array(IdSchema).min(1).optional().describe('With filled: nodes of the same tree to move into the slot, in order')
  }).refine(oneTree, ONE_TREE),
  run: async ({ projectId, nodeId, slot, filled, nodeIds = [], ...target }, ctx) => {
    const tree = treeOf(target)
    const current = await ctx.services.loadProject(projectId)
    const existing = instanceIn(current, tree, nodeId).children.find(c => c.type === SLOT_FILL_TYPE && c.props.slot === slot)
    if (!filled) {
      if (nodeIds.length) throw new ActionError('invalid', 'nodeIds needs filled: true')
      const project = existing ? await ctx.services.mutate(ctx, projectId, 'Clear slot', [{ op: 'remove', ...tree, nodeId: existing.id }]) : current
      return { version: project.version, fillId: null }
    }
    const fill = existing ?? createNode(SLOT_FILL_TYPE, { slot })
    const ops: Operation[] = [
      ...(existing ? [] : [{ op: 'insert' as const, ...tree, parentId: nodeId, index: Number.MAX_SAFE_INTEGER, node: fill }]),
      ...nodeIds.map((id, i) => ({ op: 'move' as const, ...tree, nodeId: id, parentId: fill.id, index: fill.children.length + i }))
    ]
    const project = ops.length ? await ctx.services.mutate(ctx, projectId, 'Fill slot', ops) : current
    return { version: project.version, fillId: fill.id }
  }
})
