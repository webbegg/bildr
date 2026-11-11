import { getComponent, INSTANCE_TYPE, SLOT_FILL_TYPE } from '#shared/document/components'
import type { PropDef, PropValue } from '#shared/document/components'
import { CHILDREN_SLOT } from '#shared/document/schema'
import type { DocNode, Layout, LayoutSlot, Page, Project, PropertyDef } from '#shared/document/schema'
import type { Command, CommandContext } from '#shared/editor/commands'
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

const LAYOUT_DRAG_KIND = 'layout'

/** The `application/x-bildr` payload of an Insert layout tile dragged onto the canvas or the layers: the page gets that layout. */
export function layoutDragPayload(layoutId: string): string {
  return JSON.stringify({ kind: LAYOUT_DRAG_KIND, layoutId })
}

/** The layout id of a layout tile payload; null for any other payload. */
export function parseLayoutPayload(raw: string): string | null {
  try {
    const data = JSON.parse(raw) as { kind?: unknown, layoutId?: unknown } | null
    return data?.kind === LAYOUT_DRAG_KIND && typeof data.layoutId === 'string' ? data.layoutId : null
  } catch {
    return null
  }
}

/** The `<USelect>` value of "no layout" (select items cannot be empty). */
export const NO_LAYOUT = '__none'

/** The page's Layout select: None, then each layout with the number of pages using it. */
export function layoutItems(project: Project): { label: string, value: string, pages?: number }[] {
  return [{ label: 'None', value: NO_LAYOUT }, ...project.layouts.map(l => ({ label: l.name, value: l.id, pages: layoutPages(project, l.id).length }))]
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** A layout choice's second line: the pages using it, then what a page can set in it (its named slots, the children slot aside, and its variables). */
export function layoutChoiceHint(layout: Layout, pages: number): string {
  const slots = Math.max(0, layout.slots.length - 1)
  const variables = layout.variables.length
  const sets = slots || variables ? [slots && count(slots, 'slot'), variables && count(variables, 'variable')].filter(Boolean).join(', ') : 'No slots or variables'
  return `${pages ? count(pages, 'page') : 'No pages'} · ${sets}`
}

/**
 * "Create layout from selection": the selected top-level layers of `page`
 * in page order (`layout_create_from_selection` takes them), or why the
 * selection cannot become a layout.
 */
export function layoutSelection(page: Page, selectedIds: readonly string[]): { nodeIds: string[] } | { reason: string } {
  if (page.layoutId !== undefined) return { reason: 'The page already has a layout' }
  if (!selectedIds.length) return { reason: 'Select the layers to share, such as a nav and a footer' }
  const top = page.root.children.filter(c => selectedIds.includes(c.id)).map(c => c.id)
  return top.length === new Set(selectedIds).size ? { nodeIds: top } : { reason: 'Select top-level layers of the page' }
}

export interface LayoutCommandActions {
  create: () => unknown
  createFromSelection: () => unknown
  edit: (layoutId: string) => unknown
  setPageLayout: (layoutId: string | null) => unknown
}

const onCanvas = ({ editor }: CommandContext) => editor.mode === 'build' && !!editor.page

/**
 * The quick actions for layouts: New layout, Create layout from selection
 * (when `fromSelection`), "Edit layout <name>" (not the one being edited),
 * and "Set page layout › <name>" for the current page (not its current one).
 */
export function layoutCommands(project: Project, state: { editingId: string | null, pageLayoutId: string | undefined, fromSelection: boolean }, actions: LayoutCommandActions): Command<CommandContext>[] {
  const icon = 'i-lucide-layout-template'
  const choices = [{ id: null, name: 'None' }, ...project.layouts]
  return [
    { id: 'layout:new', group: 'actions', label: 'New layout', icon, keywords: ['layout', 'frame', 'template', 'add'], enabled: () => true, run: () => actions.create() },
    { id: 'layout:from-selection', group: 'actions', label: 'Create layout from selection', icon, keywords: ['layout', 'nav', 'footer', 'share'], enabled: c => onCanvas(c) && state.fromSelection, run: () => actions.createFromSelection() },
    ...project.layouts.map((layout): Command<CommandContext> => ({
      id: `layout:edit:${layout.id}`,
      group: 'goto',
      label: `Edit layout ${layout.name}`,
      hint: 'Layout',
      icon,
      keywords: ['layout', 'edit'],
      enabled: c => !(c.editor.mode === 'build' && state.editingId === layout.id),
      run: () => actions.edit(layout.id)
    })),
    ...choices.map((choice): Command<CommandContext> => ({
      id: `layout:set:${choice.id ?? 'none'}`,
      group: 'actions',
      label: `Set page layout › ${choice.name}`,
      icon,
      keywords: ['layout', 'page'],
      enabled: c => onCanvas(c) && (state.pageLayoutId ?? null) !== choice.id,
      run: () => actions.setPageLayout(choice.id)
    }))
  ]
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

/** The node of the layout's children slot, where each page's content shows (the layout view draws a placeholder on it). */
export function childrenSlotNode(layout: Layout | null | undefined): string | null {
  return layout?.slots.find(s => s.id === CHILDREN_SLOT)?.nodeId ?? null
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
