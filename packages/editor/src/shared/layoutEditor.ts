import type { LayoutFile, Model, ModelNode, PageFile, PropertyDef, Value } from '@bildr/codegen/model'
import { layoutDragPayload, parseLayoutPayload } from '../editor/drop.ts'
import { CHILDREN_SLOT, layoutSelection, pageSlots } from '../editor/layouts.ts'
import { boundProperty, propertyField } from './componentEditor.ts'
import type { Command, CommandContext } from './commands.ts'
import { propDefsOf } from './nodeProps.ts'
import type { PropDef } from './nodeProps.ts'
import { matches } from './sidebar.ts'

/**
 * The layout editor's pure parts (the hosted `composables/layoutEditor.ts`, over the
 * model's files): the Assets list of layouts (with the pages using each), the delete
 * confirmation, the page's Layout select, variable fields and the quick actions. The
 * drag payload, `layoutSelection` and `pageSlots` live in `editor/`.
 */

export { layoutDragPayload, layoutSelection, pageSlots, parseLayoutPayload }

export interface LayoutEntry {
  layout: LayoutFile
  /** The pages that use it, in page order: they detach when it is deleted. */
  pages: PageFile[]
}

const pagesOf = (model: Pick<Model, 'modules'>): PageFile[] => Object.values(model.modules).flatMap(entry => entry.pages)

export const layoutPages = (model: Pick<Model, 'modules'>, layoutId: string): PageFile[] => pagesOf(model).filter(page => page.layout === layoutId)

/** The layouts whose name matches `query`, with their pages. */
export const layoutEntries = (model: Pick<Model, 'modules' | 'layouts'>, query: string): LayoutEntry[] => model.layouts.filter(layout => matches(query, layout.name)).map(layout => ({ layout, pages: layoutPages(model, layout.id) }))

/** The delete confirm (EditorConfirm): the pages that will detach. */
export function layoutDeleteConfirm(layout: Pick<LayoutFile, 'name'>, pages: Pick<PageFile, 'name'>[]): { title: string, description: string, items: string[], confirmLabel: string, danger: true } {
  const n = pages.length
  return {
    title: `Delete "${layout.name}"?`,
    description: n
      ? `Used by ${n} page${n === 1 ? '' : 's'}. ${n === 1 ? 'It keeps its' : 'They keep their'} content and lose${n === 1 ? 's' : ''} the layout; undo brings it back.`
      : 'No page uses it. Undo brings it back.',
    items: pages.map(page => page.name),
    confirmLabel: 'Delete layout',
    danger: true
  }
}

/** The `<USelect>` value of "no layout" (select items cannot be empty). */
export const NO_LAYOUT = '__none'

/** The page's Layout select: None, then each layout with the number of pages using it. */
export const layoutItems = (model: Pick<Model, 'modules' | 'layouts'>): { label: string, value: string, pages?: number }[] =>
  [{ label: 'None', value: NO_LAYOUT }, ...model.layouts.map(layout => ({ label: layout.name, value: layout.id, pages: layoutPages(model, layout.id).length }))]

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** A layout choice's second line: the pages using it, then what a page can set in it (its named slots, the children slot aside, and its variables). */
export function layoutChoiceHint(layout: Pick<LayoutFile, 'slots' | 'variables'>, pages: number): string {
  const slots = layout.slots.filter(slot => slot.id !== CHILDREN_SLOT).length
  const variables = layout.variables?.length ?? 0
  const sets = slots || variables ? [slots && count(slots, 'slot'), variables && count(variables, 'variable')].filter(Boolean).join(', ') : 'No slots or variables'
  return `${pages ? count(pages, 'page') : 'No pages'} · ${sets}`
}

/** What a page's variable row needs to show (the hosted `PropDef`): keyed by the variable id, its default and options from the model. */
export type VariableField = PropDef

/**
 * A variable as a prop field of the page settings (a layout variable takes the kinds `LAYOUT_VARIABLE_KINDS`
 * lists, all of them prop kinds): keyed by its id, its default and options from the first bound prop or
 * style key of the layout's node (`propertyField`).
 */
export const variableField = (layout: Pick<LayoutFile, 'name'> & Partial<Pick<LayoutFile, 'root'>>, variable: PropertyDef): VariableField => {
  const root: ModelNode = layout.root ?? { id: '', type: 'Container' }
  return propertyField({ name: layout.name, root }, variable, 'variable', `layout ${layout.name}`) ?? { name: variable.id, label: variable.label ?? variable.name, kind: 'text', default: '' }
}

/** The slot bound to layout node `nodeId`, if any. */
export const slotOf = (layout: Pick<LayoutFile, 'slots'>, nodeId: string): LayoutFile['slots'][number] | undefined => layout.slots.find(slot => slot.nodeId === nodeId)

/** The node of the layout's children slot, where each page's content shows (the layout view draws a placeholder on it). */
export const childrenSlotNode = (layout: Pick<LayoutFile, 'slots'> | null | undefined): string | null => layout?.slots.find(slot => slot.id === CHILDREN_SLOT)?.nodeId ?? null

/** The props of a layout node that "+" can turn into a variable; the ones a variable drives already are disabled. */
export function variableAddItems(layout: Pick<LayoutFile, 'variables'>, node: ModelNode): { id: string, label: string, disabled: boolean, hint?: string }[] {
  if (node.type === 'Instance' || node.type === 'SlotFill') return []
  // A style binding of the same name (style `text` is the font size) leaves the prop free.
  const bound = (prop: string) => !!boundProperty(layout.variables ?? [], node.id, prop, 'prop')
  return propDefsOf(node.type).map(def => ({ id: def.name, label: def.label, disabled: bound(def.name), ...(bound(def.name) ? { hint: 'Already a variable' } : {}) }))
}

/** The page's own value for a variable; undefined when the default applies. */
export const layoutValue = (page: Pick<PageFile, 'layoutValues'>, variable: Pick<PropertyDef, 'id'>): Value | undefined => page.layoutValues?.[variable.id]

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
export function layoutCommands(model: Pick<Model, 'layouts'>, state: { editingId: string | null, pageLayoutId: string | undefined, fromSelection: boolean }, actions: LayoutCommandActions): Command<CommandContext>[] {
  const icon = 'i-lucide-layout-template'
  const choices = [{ id: null, name: 'None' }, ...model.layouts]
  return [
    { id: 'layout:new', group: 'actions', label: 'New layout', icon, keywords: ['layout', 'frame', 'template', 'add'], enabled: () => true, run: () => actions.create() },
    { id: 'layout:from-selection', group: 'actions', label: 'Create layout from selection', icon, keywords: ['layout', 'nav', 'footer', 'share'], enabled: c => onCanvas(c) && state.fromSelection, run: () => actions.createFromSelection() },
    ...model.layouts.map((layout): Command<CommandContext> => ({
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
