import { z } from 'zod'
import { ArtifactIdSchema, LocalIdSchema, ValueSchema } from '../model/schemas.ts'
import type { ComponentFile, ModelNode, Value } from '../model/schemas.ts'
import { defineEdit, fail } from './core.ts'
import type { Draft, Tree } from './core.ts'
import { ComponentRef, instancesOf } from './components.ts'
import { FileRef, moveNode, NodeRef, nodeIn, removeNode } from './nodes.ts'
import { findParent, walk } from './tree.ts'

/** Instances of components: their values, variant and slot content; Detach and Replace with (`shared/document/instanceEdits.ts`). */

const InstanceTarget = { file: FileRef, nodeId: NodeRef.describe('The Instance node') }

type Values = Record<string, Value>
const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

const instanceIn = (draft: Draft, tree: Tree, nodeId: string): { node: ModelNode, component: ComponentFile } => {
  const node = nodeIn(tree, nodeId)
  if (node.type !== 'Instance') fail('invalid', `Node "${nodeId}" is a ${node.type}, not a component instance`)
  return { node, component: draft.component(String(node.props?.component)).component }
}

export const instanceSetValues = defineEdit({
  input: z.object({
    ...InstanceTarget,
    values: z.record(ArtifactIdSchema, ValueSchema.nullable()).optional().describe('Property id → value (checked against the property); null removes one, so its default applies'),
    variant: z.union([ArtifactIdSchema, z.literal('')]).nullable().optional().describe('A variant id; "" or null for the primary')
  }),
  apply: (draft, { file, nodeId, values = {}, variant }) => {
    const { node, component } = instanceIn(draft, draft.tree(file), nodeId)
    const next: Values = { ...(isObject(node.props?.values) ? node.props.values : {}) }
    for (const [id, value] of Object.entries(values)) {
      if (!component.properties.some(property => property.id === id)) fail('invalid', `${component.name} has no property "${id}"`)
      if (value === null) Reflect.deleteProperty(next, id)
      else next[id] = value
    }
    const props: Record<string, Value> = { ...node.props }
    if (Object.keys(next).length) props.values = next
    else delete props.values
    if (variant !== undefined) {
      if (variant) props.variant = variant
      else delete props.variant
    }
    node.props = props
    return {}
  }
})

export const instanceSetSlot = defineEdit({
  input: z.object({
    ...InstanceTarget,
    slot: ArtifactIdSchema.describe('The slot property id'),
    filled: z.boolean().describe('true: the instance gives the slot its own content (a SlotFill); false: the component\'s default content shows'),
    nodeIds: z.array(LocalIdSchema).min(1).optional().describe('With filled: nodes of the same tree to move into the slot, in order')
  }),
  apply: (draft, { file, nodeId, slot, filled, nodeIds = [] }) => {
    const tree = draft.tree(file)
    const { node, component } = instanceIn(draft, tree, nodeId)
    if (!component.properties.some(property => property.kind === 'slot' && property.id === slot)) fail('invalid', `${component.name} has no slot property "${slot}"`)
    const existing = node.children?.find(child => child.type === 'SlotFill' && child.props?.slot === slot)
    if (!filled) {
      if (nodeIds.length) fail('invalid', 'nodeIds needs filled: true')
      if (existing) removeNode(tree, existing)
      return { fillId: null }
    }
    const fill = existing ?? { id: draft.nodeId('SlotFill'), type: 'SlotFill', props: { slot } }
    if (!existing) (node.children ??= []).push(fill)
    for (const id of nodeIds) moveNode(tree, id, fill.id, fill.children?.length ?? 0)
    return { fillId: fill.id }
  }
})

// ── Detach ───────────────────────────────────────────────────────────────

/**
 * `value` with the component's property names replaced by what the instance
 * gives them: a `$bind` of a property reads the instance's value (a binding
 * of the host follows its path), a `$template` part takes it as text.
 */
const substitute = (value: Value, values: Values): Value => {
  if (Array.isArray(value)) return value.map(item => substitute(item, values))
  if (!isObject(value)) return value
  if (typeof value.$bind === 'string') {
    const [head, ...rest] = value.$bind.split('.')
    if (head! in values) {
      const given = values[head!]!
      if (isObject(given) && typeof given.$bind === 'string') return { ...value, $bind: [given.$bind, ...rest].join('.') }
      if (!rest.length) return structuredClone(given)
      let found: Value | undefined = given
      for (const key of rest) found = isObject(found) ? found[key] : undefined
      return found ?? null
    }
  }
  if (typeof value.$template === 'string') {
    const text = value.$template.replace(/\{([^}]*)\}/g, (part, path: string) => {
      const [head, ...rest] = path.split('.')
      if (!(head! in values)) return part
      const given = values[head!]!
      if (isObject(given) && typeof given.$bind === 'string') return `{${[given.$bind, ...rest].join('.')}}`
      return !rest.length && (typeof given === 'string' || typeof given === 'number') ? String(given) : part
    })
    return /\{[^}]*\}/.test(text) ? { ...value, $template: text } : text
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, values)]))
}

const hidden = (value: Value | undefined) => value === false || value === '' || value === 0 || value === null

/**
 * The tree an instance renders (Framer's Detach instance): the definition
 * with the instance's variant overrides, values (property defaults where it
 * sets none) and slot content applied, its nodes with fresh ids. Hidden nodes
 * (a variant's `hidden`, a `visible` that reads an empty value) are left out;
 * slot content keeps its nodes and ids. The root takes the instance's style
 * over its own, and its layer name (else the component's).
 */
const detachedTree = (draft: Draft, instance: ModelNode, component: ComponentFile): ModelNode => {
  const given = isObject(instance.props?.values) ? instance.props.values : {}
  const byName: Values = {}
  const byId: Values = {}
  for (const property of component.properties) {
    const value = given[property.id] ?? property.default
    if (value === undefined || property.kind === 'slot') continue
    byName[property.name] = value
    byId[property.id] = value
  }
  const variant = component.variants.find(entry => entry.id === instance.props?.variant)
  const fills = new Map((instance.children ?? []).filter(child => child.type === 'SlotFill').map(fill => [String(fill.props?.slot), fill]))
  const slots = new Map(component.properties.filter(property => property.kind === 'slot' && property.nodeId).map(property => [property.nodeId!, property.id]))

  const resolve = (node: ModelNode): ModelNode | undefined => {
    const override = variant?.overrides[node.id]
    if (override?.props?.hidden === true) return undefined
    const copy: ModelNode = { ...node }
    const props: Record<string, Value> = { ...node.props, ...override?.props }
    delete props.hidden
    const style: Record<string, string> = { ...node.style, ...override?.style }
    for (const key of override?.unset ?? []) Reflect.deleteProperty(style, key)
    for (const property of component.properties) {
      const value = byId[property.id]
      for (const binding of property.bindings ?? []) {
        if (binding.nodeId !== node.id || value === undefined) continue
        if (binding.target === 'style') style[binding.prop] = String(value)
        else props[binding.prop] = value
      }
    }
    const resolvedProps = substitute(props, byName) as Record<string, Value>
    if ('visible' in resolvedProps && hidden(resolvedProps.visible)) return undefined
    if (Object.keys(resolvedProps).length) copy.props = resolvedProps
    else delete copy.props
    if (Object.keys(style).length) copy.style = style
    else delete copy.style
    if (node.interactions) copy.interactions = substitute(node.interactions as Value, byName) as unknown as ModelNode['interactions']
    const slot = slots.get(node.id)
    const fill = slot ? fills.get(slot) : undefined
    const children = fill ? structuredClone(fill.children ?? []) : (node.children ?? []).flatMap(child => resolve(child) ?? [])
    if (node.children || fill) copy.children = children
    return copy
  }

  const resolved = resolve(component.root) ?? fail('invalid', `The instance shows nothing: ${component.name}'s root is hidden in this variant`)
  const kept = new Set((instance.children ?? []).flatMap(fill => (fill.children ?? []).map(child => child.id)))
  // Fresh ids for the definition's nodes; slot content keeps its own.
  const renew = (node: ModelNode): ModelNode => (kept.has(node.id) ? node : { ...node, id: draft.nodeId(node.type), ...(node.children ? { children: node.children.map(renew) } : {}) })
  const root = renew(resolved)
  const name = instance.name ?? component.name
  return { ...root, name, ...(instance.locked ? { locked: true } : {}), ...(instance.style || root.style ? { style: { ...root.style, ...instance.style } } : {}) }
}

export const instanceDetach = defineEdit({
  input: z.object(InstanceTarget),
  apply: (draft, { file, nodeId }) => {
    const tree = draft.tree(file)
    const { node, component } = instanceIn(draft, tree, nodeId)
    const detached = detachedTree(draft, node, component)
    const location = findParent(tree.root, nodeId)!
    location.parent.children!.splice(location.index, 1, detached)
    return { nodeId: detached.id }
  }
})

// ── Replace with ─────────────────────────────────────────────────────────

/** Whether component `id`'s tree has an Instance of `target`, directly or through other components. */
export const contains = (draft: Draft, id: string, target: string, seen = new Set<string>()): boolean => {
  if (seen.has(id)) return false
  seen.add(id)
  const component = draft.components().find(entry => entry.id === id)
  let found = false
  if (component) {
    walk(component.root, (node) => {
      if (found || node.type !== 'Instance') return
      const used = String(node.props?.component)
      found = used === target || contains(draft, used, target, seen)
    })
  }
  return found
}

const key = (name: string) => name.toLowerCase()

/** `instance` as an instance of `to`: same-named values of the same kind (that `to` takes), variant and slot content stay. */
const replaced = (instance: ModelNode, from: ComponentFile | undefined, to: ComponentFile): ModelNode => {
  const props: Record<string, Value> = { component: to.id }
  const variant = from?.variants.find(entry => entry.id === instance.props?.variant)
  const sameVariant = variant && to.variants.find(entry => key(entry.name) === key(variant.name))
  if (sameVariant) props.variant = sameVariant.id
  const values = isObject(instance.props?.values) ? instance.props.values : {}
  const kept: Values = {}
  for (const property of from?.properties ?? []) {
    const value = values[property.id]
    if (value === undefined || property.kind === 'slot') continue
    const match = to.properties.find(entry => entry.kind === property.kind && key(entry.name) === key(property.name))
    if (!match || match.id in kept) continue
    if (match.kind === 'select' && typeof value === 'string' && !match.options?.includes(value)) continue
    kept[match.id] = value
  }
  if (Object.keys(kept).length) props.values = kept
  const children: ModelNode[] = []
  for (const fill of instance.children ?? []) {
    const slot = from?.properties.find(property => property.kind === 'slot' && property.id === fill.props?.slot)
    const match = slot && to.properties.find(property => property.kind === 'slot' && key(property.name) === key(slot.name))
    if (!match || children.some(child => child.props?.slot === match.id)) continue
    children.push({ ...fill, props: { ...fill.props, slot: match.id } })
  }
  return { ...instance, props, ...(instance.children ? { children } : {}) }
}

export const instanceReplace = defineEdit({
  input: z.object({
    ...InstanceTarget,
    component: ComponentRef.describe('The component to use instead'),
    all: z.boolean().optional().describe('Replace every instance of the old component, in every page, component and layout')
  }),
  apply: (draft, { file, nodeId, component: toId, all }) => {
    const tree = draft.tree(file)
    const instance = nodeIn(tree, nodeId)
    if (instance.type !== 'Instance') fail('invalid', `Node "${nodeId}" is a ${instance.type}, not a component instance`)
    const to = draft.component(toId).component
    const fromId = String(instance.props?.component)
    if (fromId === toId) fail('invalid', `The instance already uses ${to.name}`)
    const from = draft.components().find(entry => entry.id === fromId)
    const uses = all ? instancesOf(draft, fromId) : [{ tree, node: instance }]
    for (const use of uses) {
      if (use.tree.kind !== 'component') continue
      if (use.tree.file === toId) fail('invalid', `"${to.name}" cannot contain itself`)
      if (contains(draft, toId, use.tree.file)) fail('invalid', `"${to.name}" contains "${draft.component(use.tree.file).component.name}": replacing would create a cycle`)
    }
    for (const use of uses) {
      const location = findParent(use.tree.root, use.node.id)
      if (!location) continue
      location.parent.children![location.index] = replaced(use.node, from, to)
    }
    return { replaced: uses.map(use => `${use.tree.file} (${use.node.id})`) }
  }
})
