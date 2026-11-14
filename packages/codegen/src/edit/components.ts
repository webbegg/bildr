import { z } from 'zod'
import { isStyleKeyOf, styleTokenProblem } from '../design/tokens.ts'
import {
  ArtifactIdSchema, LocalIdSchema, PROPERTY_KINDS, PropertyBindingSchema, PropertySchema, STATE_KINDS, TransitionSchema, ValueSchema, VARIANT_EVENTS, VariantRefSchema
} from '../model/schemas.ts'
import type { ComponentFile, ModelNode, PropertyDef, Value } from '../model/schemas.ts'
import { camel, defineEdit, fail, kebab, pascal, rootName, uniqueName } from './core.ts'
import type { Draft, Tree } from './core.ts'
import { buildNode, checkStyle, FileRef, idsOf, located, NodeRef, removeNode } from './nodes.ts'
import { cloneWithNewIds, findNode, walk } from './tree.ts'

/** Component files: create from a selection, rename, duplicate, delete; properties, variants, states, interactions and transitions. */

export const ComponentRef = ArtifactIdSchema.describe('A component id, e.g. "cmp_post_card"')
const VariantRef = VariantRefSchema.describe('A variant id of the component; "" for the primary variant')
const NameSchema = z.string().trim().min(1).max(100)

type Variant = ComponentFile['variants'][number]
type VariantInteraction = NonNullable<ComponentFile['interactions']>[number]

/** Every Instance of component `id`, as `{ tree, node }`, in file then document order. */
export const instancesOf = (draft: Draft, id: string): Array<{ tree: Tree, node: ModelNode }> => draft.trees().flatMap((tree) => {
  const found: Array<{ tree: Tree, node: ModelNode }> = []
  walk(tree.root, (node) => {
    if (node.type === 'Instance' && node.props?.component === id) found.push({ tree, node })
  })
  return found
})

const componentName = (draft: Draft, module: string, given: string, except?: string): string => {
  const name = pascal(given)
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) fail('invalid', `"${given}" can't be a component name: start with a letter, like "PostCard"`)
  const taken = draft.module(module).components.find(component => component.name.toLowerCase() === name.toLowerCase() && component.id !== except)
  if (taken) fail('invalid', `A component is already named "${taken.name}" in module "${module}"`)
  return name
}

const memberName = (given: string, noun: string): string => {
  const name = camel(given)
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) fail('invalid', `"${given}" can't be a ${noun} name: start with a letter, like "title"`)
  return name
}

const propertyIn = (component: ComponentFile, id: string): PropertyDef =>
  component.properties.find(property => property.id === id) ?? fail('not_found', `${component.name} has no property "${id}"`)

const variantIn = (component: ComponentFile, id: string): Variant =>
  component.variants.find(variant => variant.id === id) ?? fail('not_found', `${component.name} has no variant "${id}"`)

/** The interactions and transition of the primary (`''`) or of a variant. */
const motionOwner = (component: ComponentFile, id: string): { interactions?: VariantInteraction[], transition?: ComponentFile['transition'] } =>
  id === '' ? component : variantIn(component, id)

const move = <T>(list: T[], item: T, index: number | undefined) => {
  if (index === undefined) return
  if (index >= list.length) fail('invalid', `Index ${index} is out of bounds: the list has ${list.length} entries`)
  list.splice(list.indexOf(item), 1)
  list.splice(index, 0, item)
}

const insertAt = <T>(list: T[], item: T, index: number | undefined) => {
  list.splice(index === undefined ? list.length : Math.min(index, list.length), 0, item)
}

// ── Components ───────────────────────────────────────────────────────────

/** A new component file in `module` with `root`, written to `components/<kebab name>.json`. */
export const addComponent = (draft: Draft, module: string, name: string, root: ModelNode, after?: ComponentFile): { component: ComponentFile, filePath: string } => {
  const component: ComponentFile = { id: draft.mint('cmp', name), name, properties: [], variants: [], root }
  const list = draft.module(module).components
  insertAt(list, component, after ? list.indexOf(after) + 1 : undefined)
  return { component, filePath: draft.place(component.id, `.bildr/modules/${module}/components`, kebab(name)) }
}

export const componentCreate = defineEdit({
  input: z.object({
    file: FileRef,
    nodeId: NodeRef.optional().describe('The node to turn into a component; or give nodeIds'),
    nodeIds: z.array(LocalIdSchema).min(1).optional().describe('Several siblings, wrapped in a Container, in this order'),
    name: NameSchema.optional().describe('PascalCased, unique in the module ignoring case; defaults to the node\'s layer name or type')
  }),
  apply: (draft, { file, name: given, ...nodes }) => {
    const tree = draft.tree(file)
    const module = tree.module ?? draft.model.project.defaultModule
    const ids = idsOf(nodes)
    if (ids.includes(tree.root.id)) fail('forbidden', `The ${rootName(tree)} cannot become a component`)
    const locations = ids.map(id => located(tree, id, 'turned into a component'))
    const parent = locations[0]!.parent
    if (locations.some(location => location.parent !== parent)) fail('invalid', 'Only siblings (nodes of one parent) can become one component')
    const picked = ids.map(id => findNode(tree.root, id)!)
    const fallback = pascal(picked.length === 1 ? picked[0]!.name ?? picked[0]!.type : 'Component') || 'Component'
    const name = given === undefined ? uniqueName(fallback, draft.module(module).components.map(component => component.name)) : componentName(draft, module, given)
    const mint = (type: string) => draft.nodeId(type)
    const root = picked.length === 1 ? cloneWithNewIds(picked[0]!, mint) : { ...buildNode(draft, { type: 'Container' }), children: picked.map(node => cloneWithNewIds(node, mint)) }
    const { component, filePath } = addComponent(draft, module, name, root)
    const index = Math.min(...locations.map(location => location.index))
    for (const node of picked) removeNode(tree, node)
    const instance: ModelNode = { id: draft.nodeId('Instance'), type: 'Instance', props: { component: component.id } }
    parent.children!.splice(index, 0, instance)
    return { componentId: component.id, nodeId: instance.id, filePath }
  }
})

export const componentRename = defineEdit({
  input: z.object({ component: ComponentRef, name: NameSchema.describe('PascalCased, unique in the module ignoring case') }),
  apply: (draft, { component: id, name }) => {
    const { component, module } = draft.component(id)
    component.name = componentName(draft, module, name, id)
    return {}
  }
})

export const componentDuplicate = defineEdit({
  input: z.object({ component: ComponentRef, name: NameSchema.optional().describe('Defaults to "<Name>Copy", numbered when taken') }),
  apply: (draft, { component: id, name: given }) => {
    const { component, module } = draft.component(id)
    const name = given === undefined ? uniqueName(`${component.name}Copy`, draft.module(module).components.map(entry => entry.name)) : componentName(draft, module, given)
    const copy = structuredClone(component)
    delete copy.$schema
    const variantIds = new Map(copy.variants.map(variant => [variant.id, draft.mint('var', variant.id.replace(/^var_/, '').replace(/_\d+$/, ''))]))
    const remap = (to: string) => (to === '' ? '' : variantIds.get(to) ?? to)
    for (const property of copy.properties) property.id = draft.mint('prop', property.id.replace(/^prop_/, '').replace(/_\d+$/, ''))
    for (const variant of copy.variants) {
      variant.id = remap(variant.id)
      if (variant.state) variant.state.of = remap(variant.state.of)
      for (const interaction of variant.interactions ?? []) interaction.do[0].to = remap(interaction.do[0].to)
    }
    for (const interaction of copy.interactions ?? []) interaction.do[0].to = remap(interaction.do[0].to)
    const { component: added, filePath } = addComponent(draft, module, name, copy.root, component)
    Object.assign(added, { properties: copy.properties, variants: copy.variants }, copy.interactions ? { interactions: copy.interactions } : {}, copy.transition ? { transition: copy.transition } : {})
    return { componentId: added.id, filePath }
  }
})

export const componentDelete = defineEdit({
  input: z.object({ component: ComponentRef, force: z.boolean().optional().describe('Also delete its instances') }),
  apply: (draft, { component: id, force }) => {
    const { component, module } = draft.component(id)
    const users = instancesOf(draft, id).filter(use => use.tree.file !== id)
    const where = users.map(use => `${use.tree.file} (${use.node.id})`)
    if (users.length && !force) {
      const one = users.length === 1
      fail('forbidden', `Component "${component.name}" is used by ${users.length} instance${one ? '' : 's'}: ${where.join(', ')}. Delete ${one ? 'it' : 'them'} first, or pass force: true to delete ${one ? 'it' : 'them'} too`)
    }
    // Innermost first, so an outer instance never takes one still to delete.
    for (const use of [...users].reverse()) if (findNode(use.tree.root, use.node.id)) removeNode(use.tree, use.node)
    const list = draft.module(module).components
    list.splice(list.indexOf(component), 1)
    return { deletedInstances: where }
  }
})

// ── Properties ───────────────────────────────────────────────────────────

const PropertyFields = {
  label: PropertySchema.shape.label,
  description: PropertySchema.shape.description,
  options: PropertySchema.shape.options,
  entity: PropertySchema.shape.entity,
  pick: PropertySchema.shape.pick,
  many: PropertySchema.shape.many,
  required: PropertySchema.shape.required,
  optional: PropertySchema.shape.optional,
  placeholder: PropertySchema.shape.placeholder,
  default: ValueSchema.optional().describe('The value instances get when they set none'),
  nodeId: LocalIdSchema.optional().describe('A slot property: the node whose children instances replace'),
  bindings: z.array(PropertyBindingSchema).optional().describe('The node props it drives, e.g. [{ "nodeId": "n_title", "prop": "text" }]; with "target": "style", a style key')
}

/** The editable fields of a property or layout variable, with null removing one. */
export const PropertyPatchFields = {
  label: PropertyFields.label.unwrap().nullable().optional(),
  description: PropertyFields.description.unwrap().nullable().optional(),
  options: PropertyFields.options.unwrap().nullable().optional(),
  entity: PropertyFields.entity.unwrap().nullable().optional(),
  pick: PropertyFields.pick.unwrap().nullable().optional(),
  many: PropertyFields.many.unwrap().nullable().optional(),
  required: PropertyFields.required.unwrap().nullable().optional(),
  optional: PropertyFields.optional.unwrap().nullable().optional(),
  placeholder: PropertyFields.placeholder.unwrap().nullable().optional(),
  default: ValueSchema.nullable().optional().describe('The value instances get when they set none; null removes it'),
  nodeId: PropertyFields.nodeId.unwrap().nullable().optional(),
  bindings: PropertyFields.bindings.unwrap().nullable().optional()
}

export const propertyInput = <K extends readonly [string, ...string[]]>(kinds: K) => ({
  name: NameSchema.describe('camelCased, e.g. "Draft label" → "draftLabel"'),
  kind: z.enum(kinds),
  ...PropertyFields,
  index: z.int().nonnegative().optional().describe('Position in the list; defaults to the end')
})

/** A new property (or layout variable) in `list`: a camelCase name no other has, a minted `prop_` id. */
export const addProperty = (draft: Draft, list: PropertyDef[], owner: string, input: { name: string, kind: PropertyDef['kind'], index?: number } & Partial<PropertyDef>): PropertyDef => {
  const { name: given, kind, index, ...fields } = input
  const name = memberName(given, 'property')
  if (list.some(property => property.name === name)) fail('invalid', `${owner} already has a property "${name}"`)
  const property = { id: draft.mint('prop', name), name, kind, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) } as PropertyDef
  insertAt(list, property, index)
  return property
}

/** Applies a property patch: a value sets a field, null removes it; `index` moves it. */
export const patchProperty = (list: PropertyDef[], property: PropertyDef, owner: string, patch: Record<string, unknown> & { name?: string | null, index?: number }) => {
  const { index, name, ...fields } = patch
  if (name !== undefined && name !== null) {
    const value = memberName(name, 'property')
    if (list.some(other => other !== property && other.name === value)) fail('invalid', `${owner} already has a property "${value}"`)
    property.name = value
  }
  const target = property as Record<string, unknown>
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (value === null) Reflect.deleteProperty(target, key)
    else target[key] = value
  }
  move(list, property, index)
}

export const componentPropertyAdd = defineEdit({
  input: z.object({ component: ComponentRef, ...propertyInput(PROPERTY_KINDS) }),
  apply: (draft, { component: id, ...input }) => {
    const { component } = draft.component(id)
    return { propertyId: addProperty(draft, component.properties, component.name, input).id }
  }
})

export const componentPropertyUpdate = defineEdit({
  input: z.object({
    component: ComponentRef,
    property: ArtifactIdSchema.describe('A property id, e.g. "prop_title"'),
    name: NameSchema.optional(),
    ...PropertyPatchFields,
    index: z.int().nonnegative().optional().describe('Move it to this position')
  }),
  apply: (draft, { component: id, property: propertyId, ...patch }) => {
    const { component } = draft.component(id)
    patchProperty(component.properties, propertyIn(component, propertyId), component.name, patch)
    return {}
  }
})

export const componentPropertyRemove = defineEdit({
  input: z.object({ component: ComponentRef, property: ArtifactIdSchema }),
  apply: (draft, { component: id, property: propertyId }) => {
    const { component } = draft.component(id)
    const property = propertyIn(component, propertyId)
    for (const { tree, node } of instancesOf(draft, id).reverse()) {
      const values = node.props?.values
      if (values && typeof values === 'object' && !Array.isArray(values) && propertyId in values) {
        Reflect.deleteProperty(values, propertyId)
        if (!Object.keys(values).length) delete node.props!.values
      }
      for (const fill of (node.children ?? []).filter(child => child.type === 'SlotFill' && child.props?.slot === propertyId)) removeNode(tree, fill)
    }
    component.properties.splice(component.properties.indexOf(property), 1)
    return {}
  }
})

// ── Variants and states ──────────────────────────────────────────────────

const VariantId = ArtifactIdSchema.describe('A variant id, e.g. "var_compact"')

export const componentVariantAdd = defineEdit({
  input: z.object({ component: ComponentRef, name: NameSchema.describe('camelCased'), index: z.int().nonnegative().optional() }),
  apply: (draft, { component: id, name: given, index }) => {
    const { component } = draft.component(id)
    const name = memberName(given, 'variant')
    if (component.variants.some(variant => variant.name === name)) fail('invalid', `${component.name} already has a variant "${name}"`)
    const variant: Variant = { id: draft.mint('var', name), name, overrides: {} }
    insertAt(component.variants, variant, index)
    return { variantId: variant.id }
  }
})

export const componentVariantRename = defineEdit({
  input: z.object({ component: ComponentRef, variant: VariantId, name: NameSchema }),
  apply: (draft, { component: id, variant: variantId, name: given }) => {
    const { component } = draft.component(id)
    const variant = variantIn(component, variantId)
    const name = memberName(given, 'variant')
    if (component.variants.some(other => other !== variant && other.name === name)) fail('invalid', `${component.name} already has a variant "${name}"`)
    variant.name = name
    return {}
  }
})

export const componentVariantDelete = defineEdit({
  input: z.object({ component: ComponentRef, variant: VariantId }),
  apply: (draft, { component: id, variant: variantId }) => {
    const { component } = draft.component(id)
    variantIn(component, variantId)
    const doomed = new Set([variantId, ...component.variants.filter(variant => variant.state?.of === variantId).map(variant => variant.id)])
    for (const { node } of instancesOf(draft, id)) if (doomed.has(String(node.props?.variant))) delete node.props!.variant
    component.variants = component.variants.filter(variant => !doomed.has(variant.id))
    for (const owner of [component, ...component.variants]) {
      if (!owner.interactions) continue
      owner.interactions = owner.interactions.filter(interaction => !doomed.has(interaction.do[0].to))
      if (!owner.interactions.length) delete owner.interactions
    }
    return {}
  }
})

const STATE_LABELS = { hover: 'hover', pressed: 'pressed' } as const

export const componentStateAdd = defineEdit({
  input: z.object({
    component: ComponentRef,
    baseVariant: VariantRef.describe('The variant it is a state of; "" for the primary'),
    kind: z.enum(STATE_KINDS),
    name: NameSchema.optional().describe('Defaults to "<base>Hover" or "<base>Pressed"')
  }),
  apply: (draft, { component: id, baseVariant, kind, name: given }) => {
    const { component } = draft.component(id)
    const base = baseVariant === '' ? undefined : variantIn(component, baseVariant)
    const name = memberName(given ?? `${base?.name ?? 'primary'} ${STATE_LABELS[kind]}`, 'variant')
    if (component.variants.some(variant => variant.name === name)) fail('invalid', `${component.name} already has a variant "${name}"`)
    const variant: Variant = { id: draft.mint('var', name), name, overrides: {}, state: { of: baseVariant, kind } }
    const after = component.variants.reduce((last, entry, i) => (entry.id === baseVariant || entry.state?.of === baseVariant ? i : last), -1)
    component.variants.splice(after + 1, 0, variant)
    return { variantId: variant.id }
  }
})

const OverrideFields = {
  props: z.record(z.string(), ValueSchema.nullable()).optional().describe('Props of the node to override; null resets one'),
  style: z.record(z.string(), z.string().nullable()).optional().describe('Style tokens to override; null resets one'),
  unset: z.array(z.string()).optional().describe('Style keys the variant removes (rendered as absent even where the primary sets them)')
}

/** Sets one node's override in `variant`, sparse against the primary (with a state's base variant applied). */
const setOverride = (draft: Draft, component: ComponentFile, variant: Variant, nodeId: string, patch: { props?: Record<string, Value | null>, style?: Record<string, string | null>, unset?: string[] }) => {
  const own = findNode(component.root, nodeId) ?? fail('not_found', `Node "${nodeId}" not found in ${component.id}`)
  const base = variant.state?.of ? component.variants.find(entry => entry.id === variant.state!.of)?.overrides[nodeId] : undefined
  const primaryProps = { ...own.props, ...base?.props }
  const primaryStyle: Record<string, string> = { ...own.style, ...base?.style }
  for (const key of base?.unset ?? []) Reflect.deleteProperty(primaryStyle, key)
  const current = variant.overrides[nodeId]
  const props: Record<string, Value> = { ...current?.props }
  const style: Record<string, string> = { ...current?.style }
  const unset = new Set(current?.unset)
  for (const key of patch.unset ?? []) {
    if (patch.style && key in patch.style) fail('invalid', `"${key}" cannot be both set and removed`)
    if (!isStyleKeyOf(key, draft.base)) fail('invalid', styleTokenProblem(key, '', draft.colors, draft.base) ?? `Unknown style token "${key}"`)
  }
  checkStyle(draft, patch.style ?? {})
  for (const [key, value] of Object.entries(patch.props ?? {})) {
    if (value === null || JSON.stringify(value) === JSON.stringify(primaryProps[key])) Reflect.deleteProperty(props, key)
    else props[key] = value
  }
  const driven = (key: string) => component.properties.some(property => property.bindings?.some(binding => binding.nodeId === nodeId && binding.prop === key && binding.target === 'style'))
  for (const [key, value] of Object.entries(patch.style ?? {})) {
    unset.delete(key)
    if (value === null || value === '' || value === primaryStyle[key]) Reflect.deleteProperty(style, key)
    else style[key] = value
  }
  for (const key of patch.unset ?? []) {
    Reflect.deleteProperty(style, key)
    // A marker only where the primary sets the key (itself or a style binding): the variant stays sparse.
    if (primaryStyle[key] !== undefined || driven(key)) unset.add(key)
  }
  const override = {
    ...(Object.keys(props).length ? { props } : {}),
    ...(Object.keys(style).length ? { style } : {}),
    ...(unset.size ? { unset: [...unset] } : {})
  }
  if (Object.keys(override).length) variant.overrides[nodeId] = override
  else Reflect.deleteProperty(variant.overrides, nodeId)
}

export const componentVariantSetOverride = defineEdit({
  input: z.object({
    component: ComponentRef,
    variant: VariantId,
    nodeId: NodeRef.optional().describe('A node of the component; or give overrides'),
    ...OverrideFields,
    overrides: z.array(z.object({ nodeId: NodeRef, ...OverrideFields })).min(1).optional().describe('Per-node overrides, all or nothing; replaces nodeId, props, style and unset')
  }),
  apply: (draft, { component: id, variant: variantId, overrides, ...single }) => {
    const { component } = draft.component(id)
    const variant = variantIn(component, variantId)
    const { nodeId, ...patch } = single
    if (overrides && Object.values(single).some(value => value !== undefined)) fail('invalid', 'Give nodeId (with props, style or unset) or overrides, not both')
    const entries = overrides ?? (nodeId === undefined ? [] : [{ nodeId, ...patch }])
    if (!entries.length) fail('invalid', 'Give nodeId or overrides')
    for (const { nodeId: target, ...entry } of entries) setOverride(draft, component, variant, target, entry)
    return {}
  }
})

// ── Interactions and transitions ─────────────────────────────────────────

const MotionVariant = VariantRef.optional().describe('The variant whose interactions to edit; "" or none for the primary')
const InteractionFields = {
  on: z.enum(VARIANT_EVENTS).describe('click, mouseenter, mouseleave, or appear (once, when the instance shows)'),
  to: VariantRef.describe('The variant an instance switches to; "" for the primary (not a state: states follow the pointer)'),
  delay: z.number().min(0).max(10).describe('Seconds before switching')
}

const interactionAt = (component: ComponentFile, variant: string, index: number) => {
  const owner = motionOwner(component, variant)
  const label = variant === '' ? `The primary variant of ${component.name}` : `Variant ${(owner as Variant).name} of ${component.name}`
  const interaction = owner.interactions?.[index] ?? fail('not_found', `${label} has no interaction ${index}`)
  return { owner, interaction }
}

const step = (to: string, delay: number | undefined): VariantInteraction['do'] => [{ kind: 'setVariant', to, ...(delay ? { delay } : {}) }]

export const componentInteractionAdd = defineEdit({
  input: z.object({ component: ComponentRef, variant: MotionVariant, ...InteractionFields, delay: InteractionFields.delay.optional() }),
  apply: (draft, { component: id, variant = '', on, to, delay }) => {
    const { component } = draft.component(id)
    const owner = motionOwner(component, variant)
    const list = owner.interactions ??= []
    list.push({ on, do: step(to, delay) })
    return { index: list.length - 1 }
  }
})

export const componentInteractionUpdate = defineEdit({
  input: z.object({
    component: ComponentRef,
    variant: MotionVariant,
    index: z.int().nonnegative().describe('Its position in that variant\'s interactions'),
    on: InteractionFields.on.optional(),
    to: InteractionFields.to.optional(),
    delay: InteractionFields.delay.nullable().optional().describe('null removes the delay')
  }),
  apply: (draft, { component: id, variant = '', index, on, to, delay }) => {
    const { component } = draft.component(id)
    const { owner, interaction } = interactionAt(component, variant, index)
    const current = interaction.do[0]
    owner.interactions![index] = { on: on ?? interaction.on, do: step(to ?? current.to, delay === undefined ? current.delay : delay ?? undefined) }
    return {}
  }
})

export const componentInteractionRemove = defineEdit({
  input: z.object({ component: ComponentRef, variant: MotionVariant, index: z.int().nonnegative() }),
  apply: (draft, { component: id, variant = '', index }) => {
    const { component } = draft.component(id)
    const { owner } = interactionAt(component, variant, index)
    owner.interactions!.splice(index, 1)
    if (!owner.interactions!.length) delete owner.interactions
    return {}
  }
})

export const componentTransitionSet = defineEdit({
  input: z.object({
    component: ComponentRef,
    variant: VariantRef.optional().describe('A variant for its own transition; "" or none for the component\'s (every variant\'s default)'),
    transition: TransitionSchema.nullable().describe('e.g. { "type": "ease", "duration": 0.2, "easing": "ease-out" } or { "type": "spring", "stiffness": 400, "damping": 25 }; null removes it')
  }),
  apply: (draft, { component: id, variant = '', transition }) => {
    const { component } = draft.component(id)
    const owner = motionOwner(component, variant)
    if (transition) owner.transition = transition
    else delete owner.transition
    return {}
  }
})
