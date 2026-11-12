import { isDefinitionNodeId, resolveInstance } from '../runtime/instances'
import { uniqueName } from '../editor/names'
import { INSTANCE_TYPE, SLOT_FILL_TYPE } from './components'
import type { PropValue } from './components'
import { newId } from './factory'
import type { TreeRef } from './operations'
import { instanceProblems } from './schema'
import type { BreakpointBase } from '../design/tokens'
import type { ComponentDefinition, DocNode, Project } from './schema'
import { walk } from './tree'

/**
 * The pure parts of Framer's instance actions: Detach instance (the tree an
 * instance renders, as plain nodes), Replace with (an instance of another
 * component that keeps what fits), its cycle guard, and the name of a
 * duplicated component or layout. The actions (`instance_detach`,
 * `instance_replace`, `component_duplicate`, `layout_duplicate`) lower
 * these to operations.
 */

const key = (name: string) => name.trim().toLowerCase()

/**
 * The tree `instance` renders (its variant, values, defaults and slot fills
 * applied) with its definition's nodes as plain nodes with new ids, as in
 * Framer: Instances the definition holds stay Instances (linked, with their
 * values), and slot content is the host's own, so it keeps its nodes and
 * ids (what the host binds or overrides there stays valid). Layer names
 * stay: the root takes the instance's layer name (its own, else the
 * component's), definition nodes and slot content keep theirs. Null when the
 * component is missing.
 */
export function detachedTree(instance: DocNode, components: ComponentDefinition[]): DocNode | null {
  const resolved = resolveInstance(instance, components, { keepNames: true, linked: true })
  if (!resolved) return null
  const renew = (node: DocNode): DocNode => (isDefinitionNodeId(node.id) ? { ...node, id: newId('n'), children: node.children.map(renew) } : node)
  const def = components.find(c => c.id === instance.props.component)
  const name = instance.name ?? def?.name
  return { ...structuredClone(renew(resolved)), ...(name ? { name } : {}), ...(instance.locked ? { locked: true } : {}) }
}

/** A detached tree split for operations that never leave a reference dangling (see `detachParts`). */
export interface DetachParts {
  /** The detached tree without the slot content, to insert in the instance's place. */
  root: DocNode
  /** The slot content, moved (same nodes, same ids) from the instance's fills into the detached tree, in order. */
  moves: { nodeId: string, parentId: string, index: number }[]
  /** The style the definition gives the root, without the instance's own: what a host variant's `unset` on the instance shows. */
  definitionStyle: Record<string, string>
}

/**
 * `detachedTree` as an insert of the tree without the slot content, then
 * moves of the slot content into it, so the host's bindings, variant
 * overrides and layout slots or variables on that content stay valid at
 * every step. Null when the component is missing.
 */
export function detachParts(instance: DocNode, components: ComponentDefinition[]): DetachParts | null {
  const detached = detachedTree(instance, components)
  const plain = resolveInstance({ ...instance, style: {} }, components, { linked: true })
  if (!detached || !plain) return null
  const content = new Set(instance.children.flatMap(fill => fill.children.map(c => c.id)))
  const moves: DetachParts['moves'] = []
  const strip = (node: DocNode): DocNode => {
    const kept: DocNode[] = []
    for (const child of node.children) {
      if (content.has(child.id)) moves.push({ nodeId: child.id, parentId: node.id, index: moves.filter(m => m.parentId === node.id).length })
      else kept.push(strip(child))
    }
    return { ...node, children: kept }
  }
  return { root: strip(detached), moves, definitionStyle: plain.style }
}

/**
 * `instance` (of `from`) as an instance of `to`, keeping its id, layer name
 * and style: property values move to the `to` property of the same name
 * (ignoring case) and kind when `to` accepts the value, the variant to the
 * one of the same name, and slot content to the slot of the same name.
 * Everything else is dropped. `base` is the project's breakpoint base, which
 * style-bound values are checked with.
 */
export function replacedInstance(instance: DocNode, from: ComponentDefinition, to: ComponentDefinition, components: ComponentDefinition[], base: BreakpointBase = 'mobile'): DocNode {
  const props: Record<string, PropValue> = { component: to.id }
  const variant = from.variants.find(v => v.id === instance.props.variant)
  const sameVariant = variant && to.variants.find(v => key(v.name) === key(variant.name))
  if (sameVariant) props.variant = sameVariant.id
  for (const property of from.properties) {
    const value = instance.props[property.id]
    if (property.kind === 'slot' || value === undefined) continue
    const match = to.properties.find(p => p.kind === property.kind && key(p.name) === key(property.name))
    if (!match || match.id in props) continue
    const trial: DocNode = { id: instance.id, type: INSTANCE_TYPE, props: { component: to.id, [match.id]: value }, style: {}, children: [] }
    if (!instanceProblems(trial, components, false, [], base).length) props[match.id] = value
  }
  const children: DocNode[] = []
  for (const fill of instance.children) {
    const slot = from.properties.find(p => p.kind === 'slot' && p.id === fill.props.slot)
    const match = slot && to.properties.find(p => p.kind === 'slot' && key(p.name) === key(slot.name))
    if (fill.type !== SLOT_FILL_TYPE || !match || children.some(c => c.props.slot === match.id)) continue
    children.push({ ...fill, props: { ...fill.props, slot: match.id } })
  }
  return { ...instance, props, children }
}

/** Whether the definition of `componentId` has an Instance of `targetId`, directly or through other components. */
function contains(project: Pick<Project, 'components'>, componentId: string, targetId: string, seen = new Set<string>()): boolean {
  if (seen.has(componentId)) return false
  seen.add(componentId)
  const def = project.components.find(c => c.id === componentId)
  let found = false
  if (def) {
    walk(def.root, (n) => {
      if (found || n.type !== INSTANCE_TYPE) return
      const used = String(n.props.component)
      found = used === targetId || contains(project, used, targetId, seen)
    })
  }
  return found
}

/**
 * Why instances in the trees `hosts` can't become instances of
 * `componentId`: a component would contain itself (a cycle). Undefined when
 * they can; pages and layouts take any component.
 */
export function replaceProblem(project: Pick<Project, 'components'>, hosts: TreeRef[], componentId: string): string | undefined {
  const name = (id: string) => project.components.find(c => c.id === id)?.name ?? id
  for (const host of hosts) {
    if (host.componentId === undefined) continue
    if (host.componentId === componentId) return `"${name(componentId)}" cannot contain itself: replacing would create a cycle`
    if (contains(project, componentId, host.componentId)) return `"${name(componentId)}" contains "${name(host.componentId)}": replacing would create a cycle`
  }
  return undefined
}

/** The name of a duplicate: "<name> copy", numbered when taken ignoring case ("Card copy 2"). */
export function copyName(name: string, items: readonly { name: string }[]): string {
  return uniqueName(`${name} copy`, items)
}
