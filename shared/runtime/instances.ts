import { INSTANCE_TYPE, SLOT_FILL_TYPE } from '../document/components'
import type { PropValue } from '../document/components'
import type { ComponentDefinition, DocNode, PropertyDef } from '../document/schema'
import { resolvePropRefs } from './bindings'

/**
 * Resolves a component Instance into the tree it renders, at render time
 * and never stored in the document. Starting from the definition's root
 * (the primary variant), it applies the selected variant's sparse overrides,
 * resolves `{{ prop.NAME }}` in the definition's strings, sets bound props
 * and style keys (see `applySetters`, `applyStyleSetters`), and puts slot fills in place of the bound
 * container's children.
 *
 * Nodes that come from the definition get the id `<instanceId>/<nodeId>`
 * (nested instances compose the prefix), which stays unique per page and
 * maps back to the instance (`pageNodeId`), so the canvas selects the
 * instance whichever part of it is clicked. Slot content keeps its page
 * ids: it is the page's own, editable content. Page Instances inside slot
 * content stay Instances for the renderer to resolve; Instances from the
 * definition are expanded here, which is where cycles and runaway nesting
 * are cut. Invalid documents degrade instead of throwing: a missing
 * definition resolves to null, and a nested instance that cannot resolve
 * is dropped.
 */

export const INSTANCE_ID_SEPARATOR = '/'
/** Nested component depth beyond which an instance is dropped (validation already refuses cycles). */
export const MAX_INSTANCE_DEPTH = 8

/** The id of the page node a rendered id belongs to: the instance for definition-derived ids, else the id itself. */
export function pageNodeId(id: string): string {
  const at = id.indexOf(INSTANCE_ID_SEPARATOR)
  return at < 0 ? id : id.slice(0, at)
}

/** True for ids of nodes that come from a component definition, which are not editable on the page. */
export function isDefinitionNodeId(id: string): boolean {
  return id.includes(INSTANCE_ID_SEPARATOR)
}

type Definitions = Map<string, ComponentDefinition>

/**
 * Per node id, the props (or, with `target: 'style'`, the style keys) that
 * non-slot properties drive: the instance's own value (if set) and the
 * stored default (if any).
 */
export type PropertySetters = Map<string, { prop: string, target?: 'style', value?: PropValue, fallback?: PropValue }[]>

export function propertySetters(properties: PropertyDef[], values: Record<string, PropValue | undefined>): PropertySetters {
  const setters: PropertySetters = new Map()
  for (const property of properties) {
    if (property.kind === 'slot') continue
    const entry = { value: values[property.id], fallback: property.default }
    if (entry.value === undefined && entry.fallback === undefined) continue
    for (const { nodeId, prop, target } of property.bindings) setters.set(nodeId, [...(setters.get(nodeId) ?? []), { prop, ...(target ? { target } : {}), ...entry }])
  }
  return setters
}

/**
 * Sets the bound props of one node in `props` (its own props with the
 * variant's `overridden` props merged in). A bound prop is the instance's
 * (or page's) own value, else the variant's override, else the stored
 * default, else the node's own value, so editing the definition reaches
 * every instance that does not set the prop itself.
 */
export function applySetters(props: Record<string, PropValue>, setters: PropertySetters, nodeId: string, overridden?: Record<string, PropValue>): void {
  for (const { prop, target, value, fallback } of setters.get(nodeId) ?? []) {
    if (target === 'style') continue
    if (value !== undefined) props[prop] = value
    else if (fallback !== undefined && overridden?.[prop] === undefined) props[prop] = fallback
  }
}

/**
 * `applySetters` for style bindings: sets the bound style keys of one node
 * in `style` (its own style with the variant's `overridden` style merged
 * in), in the same order of precedence.
 */
export function applyStyleSetters(style: Record<string, string>, setters: PropertySetters, nodeId: string, overridden?: Record<string, string>): void {
  for (const { prop, target, value, fallback } of setters.get(nodeId) ?? []) {
    if (target !== 'style') continue
    if (value !== undefined) style[prop] = String(value)
    else if (fallback !== undefined && overridden?.[prop] === undefined) style[prop] = String(fallback)
  }
}

export function resolveInstance(instance: DocNode, components: ComponentDefinition[]): DocNode | null {
  return expand(instance, new Map(components.map(c => [c.id, c])), [])
}

function expand(instance: DocNode, definitions: Definitions, stack: string[]): DocNode | null {
  const def = definitions.get(String(instance.props.component))
  if (!def || stack.includes(def.id) || stack.length >= MAX_INSTANCE_DEPTH) return null
  const variantId = instance.props.variant
  const variant = typeof variantId === 'string' && variantId ? def.variants.find(v => v.id === variantId) : undefined

  const refs: Record<string, PropValue> = {}
  const setters = propertySetters(def.properties, instance.props)
  const fills = new Map<string, DocNode[]>()
  for (const property of def.properties) {
    if (property.kind === 'slot') {
      const fill = instance.children.find(c => c.type === SLOT_FILL_TYPE && c.props.slot === property.id)
      const target = property.bindings[0]?.nodeId
      if (fill && target) fills.set(target, fill.children)
      continue
    }
    refs[property.name] = instance.props[property.id] ?? property.default ?? ''
  }

  const next = [...stack, def.id]
  const build = (node: DocNode): DocNode | null => {
    const override = variant?.overrides[node.id]
    const props: Record<string, PropValue> = { ...node.props, ...override?.props }
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'string') props[key] = resolvePropRefs(value, refs)
    }
    applySetters(props, setters, node.id, override?.props)
    const style = { ...node.style, ...override?.style }
    applyStyleSetters(style, setters, node.id, override?.style)
    const children = fills.get(node.id) ?? node.children.map(build).filter(child => child !== null)
    const built: DocNode = {
      id: `${instance.id}${INSTANCE_ID_SEPARATOR}${node.id}`,
      type: node.type,
      props,
      style,
      children
    }
    return node.type === INSTANCE_TYPE ? expand(built, definitions, next) : built
  }

  const root = build(def.root)
  return root && { ...root, style: { ...root.style, ...instance.style } }
}

/**
 * Visits `root` and every descendant as rendered: an Instance is replaced by
 * its resolved tree (definition nodes and slot content) and unresolvable
 * ones are skipped. For data walks (Lists, Forms) that must see what a
 * visitor sees.
 */
export function walkResolved(root: DocNode, components: ComponentDefinition[], visit: (node: DocNode, parent?: DocNode) => void): void {
  const definitions: Definitions = new Map(components.map(c => [c.id, c]))
  const go = (node: DocNode, parent?: DocNode) => {
    if (node.type === INSTANCE_TYPE) {
      const resolved = expand(node, definitions, [])
      if (resolved) go(resolved, parent)
      return
    }
    visit(node, parent)
    for (const child of node.children) go(child, node)
  }
  go(root)
}
