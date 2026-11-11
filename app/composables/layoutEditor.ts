import { getComponent, INSTANCE_TYPE, SLOT_FILL_TYPE } from '#shared/document/components'
import type { PropDef, PropValue } from '#shared/document/components'
import { CHILDREN_SLOT } from '#shared/document/schema'
import type { DocNode, Layout, LayoutSlot, Page, Project, PropertyDef } from '#shared/document/schema'
import { matches } from '#shared/editor/sidebar'
import { boundProperty, propertyField } from './componentEditor'

/**
 * The layout editor's pure parts: the Assets list of layouts (with the pages
 * using each), the delete confirmation, the page's Layout select, variable
 * fields, slots, and the props a layout node can turn into variables. The
 * panels call these; actions do the edits.
 */

export interface LayoutEntry {
  layout: Layout
  /** The pages that use it, in page order: they detach when it is deleted. */
  pages: Page[]
}

export function layoutPages(project: Project, layoutId: string): Page[] {
  return project.pages.filter(p => p.layoutId === layoutId)
}

/** The layouts whose name matches `query`, with their pages. */
export function layoutEntries(project: Project, query: string): LayoutEntry[] {
  return project.layouts.filter(l => matches(query, l.name)).map(layout => ({ layout, pages: layoutPages(project, layout.id) }))
}

/** The delete confirm (EditorConfirm): the pages that will detach. */
export function layoutDeleteConfirm(layout: Layout, pages: Page[]): { title: string, description: string, items: string[], confirmLabel: string, danger: true } {
  const n = pages.length
  return {
    title: `Delete "${layout.name}"?`,
    description: n
      ? `Used by ${n} page${n === 1 ? '' : 's'}. ${n === 1 ? 'It keeps its' : 'They keep their'} content and lose${n === 1 ? 's' : ''} the layout; undo brings it back.`
      : 'No page uses it. Undo brings it back.',
    items: pages.map(p => p.name),
    confirmLabel: 'Delete layout',
    danger: true
  }
}

/** The `<USelect>` value of "no layout" (select items cannot be empty). */
export const NO_LAYOUT = '__none'

export function layoutItems(project: Project): { label: string, value: string }[] {
  return [{ label: 'None', value: NO_LAYOUT }, ...project.layouts.map(l => ({ label: l.name, value: l.id }))]
}

/** A variable as a prop field of the page settings: keyed by its id, its default and options from the first bound prop. */
export function variableField(layout: Layout, variable: PropertyDef): PropDef {
  const field = propertyField({ id: layout.id, name: layout.name, root: layout.root, properties: [], variants: [] }, variable)
  return { ...field, description: variable.description ?? `${variable.name}, a variable of layout ${layout.name}` }
}

/** The page's own value for a variable; undefined when the default applies. */
export function layoutValue(page: Page, variable: PropertyDef): PropValue | undefined {
  return page.layoutValues?.[variable.id]
}

/** The slot bound to layout node `nodeId`, if any. */
export function slotOf(layout: Layout, nodeId: string): LayoutSlot | undefined {
  return layout.slots.find(s => s.nodeId === nodeId)
}

/** The named slots of `layout` (not `children`) and whether `page` has its own content for each. */
export function pageSlots(layout: Layout, page: Page): { slot: LayoutSlot, filled: boolean }[] {
  return layout.slots
    .filter(s => s.id !== CHILDREN_SLOT)
    .map(slot => ({ slot, filled: page.root.children.some(c => c.type === SLOT_FILL_TYPE && c.props.slot === slot.id) }))
}

/** The props of a layout node that "+" can turn into a variable; the ones a variable drives already are disabled. */
export function variableAddItems(layout: Layout, node: DocNode): { id: string, label: string, disabled: boolean, hint?: string }[] {
  if (node.type === INSTANCE_TYPE || node.type === SLOT_FILL_TYPE) return []
  // A style binding of the same name (style `text` is the font size) leaves the prop free.
  const bound = (prop: string) => !!boundProperty(layout.variables, node.id, prop, 'prop')
  return (getComponent(node.type)?.props ?? []).map(p => ({ id: p.name, label: p.label, disabled: bound(p.name), ...(bound(p.name) ? { hint: 'Already a variable' } : {}) }))
}
