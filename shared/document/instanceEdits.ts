import { resolveInstance } from '../runtime/instances'
import { uniqueName } from '../editor/names'
import { INSTANCE_TYPE, SLOT_FILL_TYPE } from './components'
import type { PropValue } from './components'
import { cloneWithNewIds } from './factory'
import type { TreeRef } from './operations'
import { instanceProblems } from './schema'
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
 * applied, nested definition instances expanded) as plain nodes with new
 * ids. Layer names stay: the root takes the instance's layer name (its own,
 * else the component's), definition nodes and slot content keep theirs.
 * Null when the component is missing.
 */
export function detachedTree(instance: DocNode, components: ComponentDefinition[]): DocNode | null {
  const resolved = resolveInstance(instance, components, { keepNames: true })
  if (!resolved) return null
  const def = components.find(c => c.id === instance.props.component)
  const name = instance.name ?? def?.name
  return { ...cloneWithNewIds(resolved), ...(name ? { name } : {}), ...(instance.locked ? { locked: true } : {}) }
}

/**
 * `instance` (of `from`) as an instance of `to`, keeping its id, layer name
 * and style: property values move to the `to` property of the same name
 * (ignoring case) and kind when `to` accepts the value, the variant to the
 * one of the same name, and slot content to the slot of the same name.
 * Everything else is dropped.
 */
export function replacedInstance(instance: DocNode, from: ComponentDefinition, to: ComponentDefinition, components: ComponentDefinition[]): DocNode {
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
    if (!instanceProblems(trial, components).length) props[match.id] = value
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
