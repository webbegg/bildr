import { getComponent, INSTANCE_TYPE } from '#shared/document/components'
import type { PropDef } from '#shared/document/components'
import { parseStyleKey } from '#shared/design/tokens'
import { isStyleBinding } from '#shared/document/schema'
import type { ComponentDefinition, DocNode, Project, PropertyBinding, PropertyDef } from '#shared/document/schema'
import { findNode, findParent, walk } from '#shared/document/tree'
import { componentUsages } from '#shared/document/usages'
import type { ComponentUsage } from '#shared/document/usages'
import type { Command, CommandContext } from '#shared/editor/commands'
import type { DropTarget } from '#shared/editor/dropTarget'
import { matches } from '#shared/editor/sidebar'

/**
 * The component editor's pure parts: the Assets list of components (by
 * folder, with where each is used), which components can go where, the drag
 * payload of an Assets row, instance property fields, and the quick actions.
 * The editor (`useEditor`) and the panels call these; actions do the edits.
 */

export interface ComponentEntry {
  def: ComponentDefinition
  /** The name after its folder, e.g. `Primary` for `Buttons/Primary`. */
  label: string
  usages: ComponentUsage[]
}

export interface ComponentFolder {
  /** `''` for components outside a folder, listed first. */
  name: string
  entries: ComponentEntry[]
}

/** The components whose name matches `query`, grouped by the folder before the last `/` of their name. */
export function componentFolders(project: Project, query: string): ComponentFolder[] {
  const folders = new Map<string, ComponentEntry[]>([['', []]])
  for (const def of project.components) {
    if (!matches(query, def.name)) continue
    const at = def.name.lastIndexOf('/')
    const folder = at < 0 ? '' : def.name.slice(0, at)
    if (!folders.has(folder)) folders.set(folder, [])
    folders.get(folder)!.push({ def, label: def.name.slice(at + 1), usages: componentUsages(project, def.id) })
  }
  return [...folders].filter(([, entries]) => entries.length).map(([name, entries]) => ({ name, entries }))
}

/** The delete confirmation: one line per place the component is used, counting its instances there. */
export function componentDeleteMessage(def: ComponentDefinition, usages: ComponentUsage[]): string {
  if (!usages.length) return `Delete component "${def.name}"?`
  const counts = new Map<string, number>()
  for (const usage of usages) counts.set(usage.where, (counts.get(usage.where) ?? 0) + 1)
  const list = [...counts].map(([where, count]) => `• ${where}${count > 1 ? ` (${count} instances)` : ''}`).join('\n')
  return `"${def.name}" is used by ${usages.length} instance${usages.length === 1 ? '' : 's'}:\n${list}\n\nDelete the component and these instances?`
}

/** True when the definition of `componentId` has an Instance of `targetId`, directly or through other components. */
function usesComponent(project: Project, componentId: string, targetId: string, seen = new Set<string>()): boolean {
  if (seen.has(componentId)) return false
  seen.add(componentId)
  const def = project.components.find(c => c.id === componentId)
  let found = false
  if (def) {
    walk(def.root, (n) => {
      if (n.type !== INSTANCE_TYPE || found) return
      const used = String(n.props.component)
      found = used === targetId || usesComponent(project, used, targetId, seen)
    })
  }
  return found
}

/** The components an Instance of can go into the tree being edited: on a page all; in component `editingId` neither it nor the ones that use it. */
export function insertableComponents(project: Project, editingId: string | null): ComponentDefinition[] {
  if (!editingId) return project.components
  return project.components.filter(c => c.id !== editingId && !usesComponent(project, c.id, editingId))
}

const INSTANCE_DRAG_KIND = 'instance'

/** The `application/x-bildr` payload of an Assets row dragged onto the canvas or the layers. */
export function instanceDragPayload(componentId: string): string {
  return JSON.stringify({ kind: INSTANCE_DRAG_KIND, componentId })
}

/** The component id of an Assets row payload; null for any other payload. */
export function parseInstancePayload(raw: string): string | null {
  try {
    const data = JSON.parse(raw) as { kind?: unknown, componentId?: unknown } | null
    return data?.kind === INSTANCE_DRAG_KIND && typeof data.componentId === 'string' ? data.componentId : null
  } catch {
    return null
  }
}

/** `target`, or when it is inside an Instance (which takes slot content only), the place right after that instance. */
export function outsideInstance(root: DocNode, target: DropTarget): DropTarget {
  const parent = findNode(root, target.parentId)
  if (parent?.type !== INSTANCE_TYPE) return target
  const location = findParent(root, parent.id)
  return location ? { parentId: location.parent.id, index: location.index + 1 } : target
}

/**
 * A non-slot property as a prop field of its instances: keyed by the
 * property id, its default and options from the first binding: a bound
 * prop, or for a style binding the bound style key (its token scale).
 */
export function propertyField(def: ComponentDefinition, property: PropertyDef): PropDef {
  const binding = property.bindings[0]
  const target = binding ? findNode(def.root, binding.nodeId) : undefined
  const kind = property.kind === 'slot' ? 'text' : property.kind
  const common = { name: property.id, label: property.name, kind, description: `${property.name}, a property of ${def.name}` }
  if (binding && isStyleBinding(binding)) {
    const token = parseStyleKey(binding.prop)?.token
    return {
      ...common,
      default: property.default ?? target?.style[binding.prop] ?? '',
      ...(token && kind === 'select' ? { options: token.values } : {})
    }
  }
  const targetDef = target && binding ? getComponent(target.type)?.props.find(p => p.name === binding.prop) : undefined
  return {
    ...common,
    default: property.default ?? (target && binding ? target.props[binding.prop] : undefined) ?? targetDef?.default ?? '',
    ...(targetDef?.options ? { options: targetDef.options } : {})
  }
}

/** Whether a binding drives `key` of node `nodeId`: a prop, or with `target` `style` a style key. */
export function bindsKey(binding: PropertyBinding, nodeId: string, key: string, target: 'prop' | 'style'): boolean {
  return binding.nodeId === nodeId && binding.prop === key && isStyleBinding(binding) === (target === 'style')
}

/** The property (or layout variable) that drives `key` of node `nodeId`, a prop or a style key; a prop and a style key can share a name (`text`). */
export function boundProperty(properties: PropertyDef[], nodeId: string, key: string, target: 'prop' | 'style'): PropertyDef | undefined {
  return properties.find(p => p.bindings.some(b => bindsKey(b, nodeId, key, target)))
}

/** What a binding drives, for a tooltip: `Heading · text`, `Heading · style text`, a slot's container alone. */
export function bindingLabel(root: DocNode, binding: PropertyBinding | undefined): string {
  if (!binding) return 'Not bound'
  const target = findNode(root, binding.nodeId)
  if (!target) return 'Missing node'
  if (isStyleBinding(binding)) return `${target.type} · style ${binding.prop}`
  return binding.prop === 'children' ? target.type : `${target.type} · ${binding.prop}`
}

export interface BindingAdd {
  name: string
  kind: PropertyDef['kind']
  bindings: PropertyBinding[]
}

/**
 * The `component_property_add` / `layout_variable_add` fields that turn prop
 * `prop` of `node` into a property (or variable): named after the prop, of
 * its kind, bound to it. No stored default: the node's own value is the
 * default, so editing it reaches every instance (or page).
 */
export function propBindingAdd(properties: readonly Pick<PropertyDef, 'name'>[], node: DocNode, prop: string): BindingAdd | undefined {
  const propDef = getComponent(node.type)?.props.find(p => p.name === prop)
  if (!propDef) return undefined
  return { name: uniqueComponentName(propDef.label, properties), kind: propDef.kind, bindings: [{ nodeId: node.id, prop }] }
}

/** The same for style key `key` (`bg`, `md:p`) of node `nodeId`: a select property over the key's token scale, bound with `target: 'style'`. */
export function styleBindingAdd(properties: readonly Pick<PropertyDef, 'name'>[], nodeId: string, key: string): BindingAdd {
  const label = parseStyleKey(key)?.token.label ?? key
  return { name: uniqueComponentName(label, properties), kind: 'select', bindings: [{ nodeId, prop: key, target: 'style' }] }
}

/** `base`, or `base 2`, `base 3`… when a component already has that name. */
export function uniqueComponentName(base: string, components: readonly Pick<ComponentDefinition, 'name'>[]): string {
  const taken = new Set(components.map(c => c.name))
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`
  return name
}

export interface ComponentCommandActions {
  insert: (componentId: string) => unknown
  edit: (componentId: string) => unknown
  create: () => unknown
}

const onCanvas = ({ editor }: CommandContext) => editor.mode === 'build' && !!editor.page

/**
 * The quick actions for user components: insert an instance of one (Insert;
 * not one that would contain itself), open one in the component view (Go
 * to), and "Create component" from the selection when `canCreate`.
 */
export function componentCommands(project: Project, state: { editingId: string | null, canCreate: boolean }, actions: ComponentCommandActions): Command<CommandContext>[] {
  return [
    ...insertableComponents(project, state.editingId).map((def): Command<CommandContext> => ({
      id: `insert:component:${def.id}`,
      group: 'insert',
      label: def.name,
      hint: 'Component',
      icon: 'i-lucide-component',
      keywords: ['component', 'instance'],
      enabled: onCanvas,
      run: () => actions.insert(def.id)
    })),
    {
      id: 'component:create',
      group: 'actions',
      label: 'Create component',
      icon: 'i-lucide-component',
      keywords: ['component', 'symbol', 'reuse'],
      enabled: c => onCanvas(c) && state.canCreate,
      run: () => actions.create()
    },
    ...project.components.map((def): Command<CommandContext> => ({
      id: `component:${def.id}`,
      group: 'goto',
      label: def.name,
      hint: 'Component',
      icon: 'i-lucide-component',
      keywords: ['component', 'edit'],
      enabled: c => !(c.editor.mode === 'build' && state.editingId === def.id),
      run: () => actions.edit(def.id)
    }))
  ]
}
