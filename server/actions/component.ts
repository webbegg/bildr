import { z } from 'zod'
import { INSTANCE_TYPE, SLOT_FILL_TYPE } from '#shared/document/components'
import { cloneWithNewIds, createNode, newId } from '#shared/document/factory'
import type { Operation, TreeRef } from '#shared/document/operations'
import { IdSchema, INTERACTION_DELAY_MAX, INTERACTION_EVENTS, PRIMARY_VARIANT, PROPERTY_DESCRIPTION_MAX, PROPERTY_PLACEHOLDER_MAX, PropertyBindingSchema, PropertyKindSchema, PropValueSchema, RESERVED_INSTANCE_KEYS, STATE_KINDS, TransitionSchema, VariantRefSchema } from '#shared/document/schema'
import type { ComponentDefinition, DocNode, Interaction, Project, PropertyDef, Variant } from '#shared/document/schema'
import type { PropValue } from '#shared/document/components'
import { findNode, findParent } from '#shared/document/tree'
import { componentInstances, componentUsages } from '#shared/document/usages'
import { copyName, detachParts, replacedInstance, replaceProblem } from '#shared/document/instanceEdits'
import { nameProblem, uniqueName } from '#shared/editor/names'
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

/** Refuses a component name another component has, ignoring case (`exceptId` is the one being renamed). */
function assertComponentName(project: Project, name: string, exceptId?: string): void {
  const problem = nameProblem(name, project.components, 'component', exceptId)
  if (problem) throw new ActionError('invalid', problem)
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
  description: 'Turn a selection into a reusable component: the node (or, with nodeIds, several siblings wrapped in a Container, in the nodeIds order) becomes the definition, with ids of its own, and an Instance of it takes its place on the page. Instances render the definition, so editing it updates every instance. name may use / for folders, e.g. "Cards/Product"; names are unique ignoring case. Without a name, the component is named after the node (its layer name or type; "Component" for several), numbered when taken. One undo step. Returns the component id and the instance node id.',
  input: z.object({
    projectId: IdSchema,
    pageId: IdSchema,
    nodeId: IdSchema.optional().describe('The node to turn into a component; or give nodeIds'),
    nodeIds: z.array(IdSchema).min(1).optional().describe('Several siblings to turn into one component; replaces nodeId'),
    name: NameSchema.optional().describe('Unique ignoring case; defaults to a name from the node')
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
    if (name !== undefined) assertComponentName(current, name)
    const finalName = name ?? uniqueName(nodes.length === 1 ? nodes[0]!.name ?? nodes[0]!.type : 'Component', current.components)

    const root = nodes.length === 1 ? cloneWithNewIds(nodes[0]!) : { ...createNode('Container'), children: nodes.map(cloneWithNewIds) }
    const component: ComponentDefinition = { id: newId('cmp'), name: finalName, root, properties: [], variants: [] }
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
  description: 'Rename a component. / in the name makes folders, e.g. "Cards/Product". Names are unique ignoring case: another component\'s name is refused.',
  input: z.object({ projectId: IdSchema, componentId: ComponentRef, name: NameSchema }),
  run: async ({ projectId, componentId, name }, ctx) => {
    assertComponentName(await ctx.services.loadProject(projectId), name, componentId)
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

/** The fields that only describe a property to the editor (and the agent): add takes them, update also removes them (null). */
export const PropertyDetails = {
  description: z.string().max(PROPERTY_DESCRIPTION_MAX).optional().describe('What the property is for, shown as a tooltip where it is set'),
  optional: z.boolean().optional().describe('Whether instances (or pages) may leave it empty'),
  placeholder: z.string().max(PROPERTY_PLACEHOLDER_MAX).optional().describe('The hint an empty text field shows')
}

/** The update form of `PropertyDetails`, where null removes a field. */
export const PropertyDetailsPatch = {
  description: PropertyDetails.description.unwrap().nullable().optional().describe('What the property is for; null removes it'),
  optional: z.boolean().nullable().optional().describe('Whether instances (or pages) may leave it empty; false or null removes it'),
  placeholder: PropertyDetails.placeholder.unwrap().nullable().optional().describe('The hint an empty text field shows; null removes it'),
  index: z.number().int().nonnegative().optional().describe('Move it to this position in the list')
}

/** `PropertyDetails` given in an add, without the ones left out. */
export function givenDetails(input: { description?: string, optional?: boolean, placeholder?: string }) {
  return {
    ...(input.description ? { description: input.description } : {}),
    ...(input.optional ? { optional: true } : {}),
    ...(input.placeholder ? { placeholder: input.placeholder } : {})
  }
}

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
    ...PropertyDetails,
    index: z.number().int().nonnegative().optional().describe('Position in the property list; defaults to the end')
  }),
  run: async ({ projectId, componentId, name, kind, default: value, bindings = [], index, ...details }, ctx) => {
    const property = { id: newId('prop'), name, kind, ...(value === undefined ? {} : { default: value }), ...givenDetails(details), bindings }
    const project = await ctx.services.mutate(ctx, projectId, 'Add property', [
      { op: 'addProperty', componentId, index: index ?? Number.MAX_SAFE_INTEGER, property }
    ])
    return { version: project.version, propertyId: property.id }
  }
})

export const componentPropertyUpdate = defineAction({
  name: 'component_property_update',
  description: 'Change a component property: name, default, description, optional, placeholder (null removes any of these) or bindings, and with index its position in the list. One undo step. To change its kind, remove it and add it again.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    propertyId: IdSchema,
    name: NameSchema.optional(),
    default: PropValueSchema.nullable().optional().describe('The value instances get when they set none; null removes it'),
    ...PropertyDetailsPatch,
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
  description: 'Delete a variant of a component, with its hover and pressed states and the interactions that go to it or them. Instances that used any of them go back to the primary variant. One undo step.',
  input: z.object({ projectId: IdSchema, componentId: ComponentRef, variantId: IdSchema }),
  run: async ({ projectId, componentId, variantId }, ctx) => {
    const current = await ctx.services.loadProject(projectId)
    const def = definitionIn(current, componentId)
    const states = def.variants.filter(v => v.state?.of === variantId).map(v => v.id)
    const doomed = new Set([variantId, ...states])
    const users = componentInstances(current, componentId).filter(i => doomed.has(String(i.node.props.variant)))
    // Interactions that would point at a deleted variant go first, then the states, then the variant: no step leaves a dangling reference.
    const owners: { variantId: string, list: Interaction[] }[] = [
      { variantId: PRIMARY_VARIANT, list: def.interactions ?? [] },
      ...def.variants.filter(v => !doomed.has(v.id)).map(v => ({ variantId: v.id, list: v.interactions ?? [] }))
    ]
    const unlink = owners.filter(o => o.list.some(i => doomed.has(i.to))).map(o => motionOp(def.id, o.variantId, { interactions: o.list.filter(i => !doomed.has(i.to)) }))
    const project = await ctx.services.mutate(ctx, projectId, 'Delete variant', [
      ...users.map(user => ({ op: 'setProps' as const, ...treeOf(user), nodeId: user.nodeId, props: { variant: null } })),
      ...unlink,
      ...states.map(id => ({ op: 'removeVariant' as const, componentId, variantId: id })),
      { op: 'removeVariant', componentId, variantId }
    ])
    return { version: project.version }
  }
})

const VariantRef = VariantRefSchema.describe('A variant id of the component; "" for the primary')

/** Variant `variantId` of `def`, or undefined for the primary (`''`). */
function variantIn(def: ComponentDefinition, variantId: string): Variant | undefined {
  if (variantId === PRIMARY_VARIANT) return undefined
  return assertFound(def.variants.find(v => v.id === variantId), `Variant "${variantId}" not found in "${def.name}"`)
}

/** The op that sets the interactions or transition of variant `variantId` (the component's own for the primary); an empty list removes them. */
function motionOp(componentId: string, variantId: string, patch: { interactions?: Interaction[], transition?: z.infer<typeof TransitionSchema> | null }): Operation {
  const motion = { ...patch, ...(patch.interactions ? { interactions: patch.interactions.length ? patch.interactions : null } : {}) }
  return variantId === PRIMARY_VARIANT ? { op: 'updateComponent', componentId, ...motion } : { op: 'updateVariant', componentId, variantId, ...motion }
}

/** Where interaction `interactionId` of `def` is: the variant that has it (`''` for the primary) and that variant's list. */
function interactionIn(def: ComponentDefinition, interactionId: string): { variantId: string, list: Interaction[], interaction: Interaction } {
  for (const [variantId, list] of [[PRIMARY_VARIANT, def.interactions ?? []] as const, ...def.variants.map(v => [v.id, v.interactions ?? []] as const)]) {
    const interaction = list.find(i => i.id === interactionId)
    if (interaction) return { variantId, list, interaction }
  }
  throw new ActionError('not_found', `Interaction "${interactionId}" not found in "${def.name}"`)
}

const STATE_LABELS = { hover: 'Hover', pressed: 'Pressed' } as const

export const componentStateAdd = defineAction({
  name: 'component_state_add',
  description: 'Add a hover or pressed state to a variant of a component (baseVariantId; "" for the primary). A state is a variant that instances show by themselves while the pointer is over (hover) or pressing (pressed) them in that base variant, in the preview and in published apps. It starts with no overrides of its own (it looks like its base); component_variant_set_override changes it, on top of the base\'s overrides. A base has at most one state of each kind, and a state has no states. Named "<base> · Hover" ("Primary · Hover") unless name is given; listed after its base. One undo step. Returns the variantId.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    baseVariantId: VariantRef,
    kind: z.enum(STATE_KINDS),
    name: NameSchema.optional().describe('Defaults to "<base name> · Hover" or "<base name> · Pressed"')
  }),
  run: async ({ projectId, componentId, baseVariantId, kind, name }, ctx) => {
    const def = definitionIn(await ctx.services.loadProject(projectId), componentId)
    const base = variantIn(def, baseVariantId)
    const variant: Variant = { id: newId('var'), name: name ?? `${base?.name ?? 'Primary'} · ${STATE_LABELS[kind]}`, overrides: {}, state: { of: baseVariantId, kind } }
    // After the base and the states it already has (first, for the primary).
    const after = def.variants.reduce((last, v, i) => (v.id === baseVariantId || v.state?.of === baseVariantId ? i : last), -1)
    const project = await ctx.services.mutate(ctx, projectId, 'Add state', [{ op: 'addVariant', componentId, index: after + 1, variant }])
    return { version: project.version, variantId: variant.id }
  }
})

const InteractionFields = {
  on: z.enum(INTERACTION_EVENTS).describe('click, mouseenter, mouseleave, or appear (once, when the instance enters the viewport)'),
  to: VariantRef.describe('The variant to switch to; "" for the primary. Not a state: states show from the pointer'),
  delay: z.number().min(0).max(INTERACTION_DELAY_MAX).describe(`Seconds before switching, 0–${INTERACTION_DELAY_MAX}`)
}

export const componentInteractionAdd = defineAction({
  name: 'component_interaction_add',
  description: 'Add an interaction to a variant of a component (variantId; "" or none for the primary): on the event, an instance showing that variant (or one of its states) switches to variant to, after delay seconds. Interactions run in the preview and in published apps, never while editing. One undo step. Returns the interactionId.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    variantId: VariantRef.optional().describe('The variant the interaction starts from; "" or none for the primary'),
    ...InteractionFields,
    delay: InteractionFields.delay.optional()
  }),
  run: async ({ projectId, componentId, variantId = PRIMARY_VARIANT, on, to, delay }, ctx) => {
    const def = definitionIn(await ctx.services.loadProject(projectId), componentId)
    const owner = variantIn(def, variantId)
    const interaction: Interaction = { id: newId('ix'), on, to, ...(delay ? { delay } : {}) }
    const list = (owner ? owner.interactions : def.interactions) ?? []
    const project = await ctx.services.mutate(ctx, projectId, 'Add interaction', [motionOp(def.id, variantId, { interactions: [...list, interaction] })])
    return { version: project.version, interactionId: interaction.id }
  }
})

export const componentInteractionUpdate = defineAction({
  name: 'component_interaction_update',
  description: 'Change the event, target variant or delay of an interaction of a component (null delay removes it). One undo step.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    interactionId: IdSchema,
    on: InteractionFields.on.optional(),
    to: InteractionFields.to.optional(),
    delay: InteractionFields.delay.nullable().optional().describe('Seconds before switching; null removes the delay')
  }),
  run: async ({ projectId, componentId, interactionId, on, to, delay }, ctx) => {
    const def = definitionIn(await ctx.services.loadProject(projectId), componentId)
    const { variantId, list, interaction } = interactionIn(def, interactionId)
    const { delay: _delay, ...rest } = interaction
    const nextDelay = delay === undefined ? interaction.delay : delay
    const next: Interaction = { ...rest, ...(on ? { on } : {}), ...(to === undefined ? {} : { to }), ...(nextDelay ? { delay: nextDelay } : {}) }
    const project = await ctx.services.mutate(ctx, projectId, 'Update interaction', [motionOp(def.id, variantId, { interactions: list.map(i => (i === interaction ? next : i)) })])
    return { version: project.version }
  }
})

export const componentInteractionRemove = defineAction({
  name: 'component_interaction_remove',
  description: 'Remove an interaction of a component. One undo step.',
  input: z.object({ projectId: IdSchema, componentId: ComponentRef, interactionId: IdSchema }),
  run: async ({ projectId, componentId, interactionId }, ctx) => {
    const def = definitionIn(await ctx.services.loadProject(projectId), componentId)
    const { variantId, list, interaction } = interactionIn(def, interactionId)
    const project = await ctx.services.mutate(ctx, projectId, 'Remove interaction', [motionOp(def.id, variantId, { interactions: list.filter(i => i !== interaction) })])
    return { version: project.version }
  }
})

export const componentTransitionSet = defineAction({
  name: 'component_transition_set',
  description: 'Set how an instance animates its style changes when it changes variant. Without variantId (or ""), the component\'s transition: the primary\'s and every variant\'s default; with variantId, that variant\'s own, used when changing to it (and, for a hover or pressed state, into and out of it). type: instant; ease with duration (seconds, default 0.3) and easing (ease, ease-in, ease-out, ease-in-out, linear; default ease); spring with stiffness (default 300) and damping (default 30). Without any, changes ease over 0.3 s. Visitors who prefer reduced motion get instant changes. null removes it. One undo step.',
  input: z.object({
    projectId: IdSchema,
    componentId: ComponentRef,
    variantId: VariantRef.optional().describe('A variant to set its own transition; "" or none for the component'),
    transition: TransitionSchema.nullable().describe('e.g. { "type": "spring", "stiffness": 400, "damping": 25 } or { "type": "ease", "duration": 0.2, "easing": "ease-out" }; null removes it')
  }),
  run: async ({ projectId, componentId, variantId = PRIMARY_VARIANT, transition }, ctx) => {
    const def = definitionIn(await ctx.services.loadProject(projectId), componentId)
    variantIn(def, variantId)
    const project = await ctx.services.mutate(ctx, projectId, 'Set transition', [motionOp(def.id, variantId, { transition })])
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

/**
 * The ops that move what the host tree ties to node `fromId` over to `toId`:
 * bindings of the host component's properties (or the host layout's
 * variables) and, in a component, its variants' style overrides, which are
 * cleared on `fromId`. `revealed` is what an `unset` on `fromId` showed
 * underneath (a detached instance's definition style): those keys become
 * that value on `toId`, so the variant renders the same.
 */
function retargetOps(project: Project, tree: TreeRef, fromId: string, toId: string, revealed: Record<string, string> = {}): Operation[] {
  const retarget = (bindings: PropertyDef['bindings']) => bindings.map(b => (b.nodeId === fromId ? { ...b, nodeId: toId } : b))
  const bound = (p: PropertyDef) => p.bindings.some(b => b.nodeId === fromId)
  if (tree.layoutId !== undefined) {
    const layout = assertFound(project.layouts.find(l => l.id === tree.layoutId), `Layout "${tree.layoutId}" not found`)
    return layout.variables.filter(bound).map(v => ({ op: 'updateLayoutVariable' as const, layoutId: layout.id, variableId: v.id, bindings: retarget(v.bindings) }))
  }
  if (tree.componentId === undefined) return []
  const def = definitionIn(project, tree.componentId)
  const ops: Operation[] = def.properties.filter(bound).map(p => ({ op: 'updateProperty' as const, componentId: def.id, propertyId: p.id, bindings: retarget(p.bindings) }))
  for (const variant of def.variants) {
    const override = variant.overrides[fromId]
    if (!override) continue
    const keys = [...Object.keys(override.style ?? {}), ...(override.unset ?? [])]
    const unset = (override.unset ?? []).filter(k => revealed[k] === undefined)
    const style = { ...override.style, ...Object.fromEntries((override.unset ?? []).filter(k => revealed[k] !== undefined).map(k => [k, revealed[k]!])) }
    ops.push(
      { op: 'setOverride', componentId: def.id, variantId: variant.id, nodeId: toId, ...(Object.keys(style).length ? { style } : {}), ...(unset.length ? { unset } : {}) },
      { op: 'setOverride', componentId: def.id, variantId: variant.id, nodeId: fromId, style: Object.fromEntries(keys.map(k => [k, null])) }
    )
  }
  return ops
}

export const instanceDetach = defineAction({
  name: 'instance_detach',
  description: 'Detach a component instance (Framer\'s Detach instance): the tree it renders, with its variant, values, defaults and slot content applied, takes its place, no longer linked to the component. The component\'s own nodes become plain nodes with new ids; instances of other components inside it stay instances (linked, with their values); slot content keeps its nodes and ids. The root keeps the instance\'s layer name (else the component\'s name) and its style; definition layers keep their names. In a component or layout, bindings and variant style overrides of the instance move to the new root (a variant that removed a style key shows the component\'s value for it), and those on slot content stay. One undo step. Returns the new root node id.',
  input: z.object(InstanceTarget).refine(oneTree, ONE_TREE),
  run: async ({ projectId, nodeId, ...target }, ctx) => {
    const tree = treeOf(target)
    const current = await ctx.services.loadProject(projectId)
    const instance = instanceIn(current, tree, nodeId)
    const parts = detachParts(instance, current.components)
    if (!parts) throw new ActionError('invalid', `Instance "${nodeId}" uses the missing component "${String(instance.props.component)}"`)
    const location = findParent(treeRoot(current, tree), nodeId)!
    // Insert, move the slot content in, retarget, then remove: no step leaves a reference dangling.
    const project = await ctx.services.mutate(ctx, projectId, 'Detach instance', [
      { op: 'insert', ...tree, parentId: location.parent.id, index: location.index, node: parts.root },
      ...parts.moves.map(move => ({ op: 'move' as const, ...tree, ...move })),
      ...retargetOps(current, tree, nodeId, parts.root.id, parts.definitionStyle),
      { op: 'remove', ...tree, nodeId }
    ])
    return { version: project.version, nodeId: parts.root.id }
  }
})

const ReplaceTarget = z.object({
  projectId: IdSchema,
  pageId: IdSchema.optional().describe('The page the instance is on; or give inComponentId or layoutId'),
  inComponentId: IdSchema.optional().describe('The component definition the instance is nested in; replaces pageId'),
  layoutId: IdSchema.optional().describe('The layout the instance is in; replaces pageId'),
  nodeId: IdSchema.describe('The Instance node'),
  componentId: ComponentRef.describe('The component to use instead'),
  all: z.boolean().optional().describe('Replace every instance of the instance\'s component, on pages, in components and in layouts')
}).refine(input => [input.pageId, input.inComponentId, input.layoutId].filter(id => id !== undefined).length === 1, { message: 'Give pageId, inComponentId or layoutId', path: ['pageId'] })

/**
 * Ops that turn `instance` (in `tree`) into `next` in place: the fills it
 * drops go, then its props change and the kept fills are re-keyed to their
 * new slots in the same step, so slot content (and what the host binds or
 * overrides there) never leaves the tree.
 */
function replaceOps(tree: TreeRef, instance: DocNode, next: DocNode): Operation[] {
  const props: Record<string, PropValue | null> = { ...next.props }
  for (const key of Object.keys(instance.props)) if (!(key in next.props)) props[key] = null
  const kept = new Map(next.children.map(fill => [fill.id, String(fill.props.slot)]))
  return [
    ...instance.children.filter(fill => !kept.has(fill.id)).map(fill => ({ op: 'remove' as const, ...tree, nodeId: fill.id })),
    { op: 'setProps', ...tree, nodeId: instance.id, props, ...(kept.size ? { slots: Object.fromEntries(kept) } : {}) }
  ]
}

export const instanceReplace = defineAction({
  name: 'instance_replace',
  description: 'Replace a component instance with an instance of another component (Framer\'s Replace with). It keeps its id, layer name and style, the property values whose property names match (ignoring case; same kind, and only values the new property accepts), the variant of the same name, and slot content for slots of the same name; the rest is dropped. componentId is the component to use; the instance is on pageId, in layoutId, or nested in the definition inComponentId. Kept slot content stays in place (same nodes and ids), so host bindings and overrides on it stay. Without all, only that instance changes, not instances of the same component in its slot content; with all: true, every instance of the old component is replaced, on pages, in components and in layouts. A swap that would make a component contain itself is refused. One undo step.',
  input: ReplaceTarget,
  run: async ({ projectId, nodeId, componentId, all, pageId, inComponentId, layoutId }, ctx) => {
    const tree = treeOf({ pageId, componentId: inComponentId, layoutId })
    const current = await ctx.services.loadProject(projectId)
    const instance = instanceIn(current, tree, nodeId)
    const to = definitionIn(current, componentId)
    const fromId = String(instance.props.component)
    if (fromId === to.id) throw new ActionError('invalid', `The instance already uses "${to.name}"`)
    const from = current.components.find(c => c.id === fromId) ?? { id: fromId, name: fromId, root: instance, properties: [], variants: [] }
    // With all, every instance, those in another one's slot content too: inner ones first (reverse document order), so an outer one dropping a fill never strands an op.
    const usages: { tree: TreeRef, node: DocNode }[] = all
      ? componentInstances(current, fromId).reverse().map(u => ({ tree: treeOf(u), node: u.node }))
      : [{ tree, node: instance }]
    const problem = replaceProblem(current, usages.map(u => u.tree), to.id)
    if (problem) throw new ActionError('invalid', problem)
    const ops = usages.flatMap(u => replaceOps(u.tree, u.node, replacedInstance(u.node, from, to, current.components)))
    const project = await ctx.services.mutate(ctx, projectId, all ? 'Replace all instances' : 'Replace instance', ops)
    return { version: project.version, replaced: usages.map(u => u.node.id).reverse() }
  }
})

export const componentDuplicate = defineAction({
  name: 'component_duplicate',
  description: 'Duplicate a component: its definition, properties and variants, listed right after it, with no instances. Without a name it is "<name> copy" ("Card copy", numbered when taken); names are unique ignoring case. One undo step. Returns the new component id.',
  input: z.object({ projectId: IdSchema, componentId: ComponentRef, name: NameSchema.optional().describe('Unique ignoring case; defaults to "<name> copy"') }),
  run: async ({ projectId, componentId, name }, ctx) => {
    const current = await ctx.services.loadProject(projectId)
    const def = definitionIn(current, componentId)
    if (name !== undefined) assertComponentName(current, name)
    const copy: ComponentDefinition = { ...structuredClone(def), id: newId('cmp'), name: name ?? copyName(def.name, current.components) }
    const project = await ctx.services.mutate(ctx, projectId, 'Duplicate component', [
      { op: 'addComponent', index: current.components.indexOf(def) + 1, component: copy }
    ])
    return { version: project.version, componentId: copy.id }
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
