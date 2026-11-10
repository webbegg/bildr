import { getComponent, INSTANCE_TYPE } from '#shared/document/components'
import type { PropDef } from '#shared/document/components'
import type { ComponentDefinition, DocNode, Project, PropertyDef } from '#shared/document/schema'
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

/** A non-slot property as a prop field of its instances: keyed by the property id, its default and options from the first bound prop. */
export function propertyField(def: ComponentDefinition, property: PropertyDef): PropDef {
  const binding = property.bindings[0]
  const target = binding ? findNode(def.root, binding.nodeId) : undefined
  const targetDef = target && binding ? getComponent(target.type)?.props.find(p => p.name === binding.prop) : undefined
  const kind = property.kind === 'slot' ? 'text' : property.kind
  return {
    name: property.id,
    label: property.name,
    kind,
    default: property.default ?? (target && binding ? target.props[binding.prop] : undefined) ?? targetDef?.default ?? '',
    ...(targetDef?.options ? { options: targetDef.options } : {}),
    description: `${property.name}, a property of ${def.name}`
  }
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
