import type { LayoutFile, Model, ModelNode, PageFile } from '@bildr/codegen/model'
import { INSTANCE_TYPE } from './drop.ts'

/** The layout editor's pure parts (the hosted `layoutEditor.ts` and `interactionPanel.ts`, over the model's files). */

/** The layout slot every layout has: where a page's own content goes. */
export const CHILDREN_SLOT = 'children'
export const SLOT_FILL_TYPE = 'SlotFill'

/**
 * "Create layout from selection": the selected top-level layers of `page`
 * in page order (`layout_create_from_selection` takes them), or why the
 * selection cannot become a layout.
 */
export const layoutSelection = (page: PageFile, selectedIds: readonly string[]): { nodeIds: string[] } | { reason: string } => {
  if (page.layout !== undefined) return { reason: 'The page already has a layout' }
  if (!selectedIds.length) return { reason: 'Select the layers to share, such as a nav and a footer' }
  const top = (page.root.children ?? []).filter(child => selectedIds.includes(child.id)).map(child => child.id)
  return top.length === new Set(selectedIds).size ? { nodeIds: top } : { reason: 'Select top-level layers of the page' }
}

/** The named slots of `layout` (not `children`) and whether `page` has its own content for each. */
export const pageSlots = (layout: LayoutFile, page: PageFile): { slot: LayoutFile['slots'][number], filled: boolean }[] => layout.slots
  .filter(slot => slot.id !== CHILDREN_SLOT)
  .map(slot => ({ slot, filled: (page.root.children ?? []).some(child => child.type === SLOT_FILL_TYPE && child.props?.slot === slot.id) }))

const instances = (root: ModelNode, id: string): boolean => (root.type === INSTANCE_TYPE && root.props?.component === id) || (root.children ?? []).some(child => instances(child, id))

/**
 * The first page that shows component `componentId`: directly, through its
 * layout, or inside another component shown there, among the pages `accept`s;
 * null when no page does.
 */
export const previewPageFor = (model: Model, componentId: string, accept: (page: PageFile) => boolean = () => true): PageFile | null => {
  const components = Object.values(model.modules).flatMap(entry => entry.components)
  const shown = new Set<string>()
  const queue = [componentId]
  // Every component whose instances would show `componentId`: it and the ones containing them.
  while (queue.length) {
    const id = queue.shift()!
    if (shown.has(id)) continue
    shown.add(id)
    for (const component of components) if (!shown.has(component.id) && instances(component.root, id)) queue.push(component.id)
  }
  const showsIn = (root: ModelNode) => [...shown].some(id => instances(root, id))
  const layouts = new Set(model.layouts.filter(layout => showsIn(layout.root)).map(layout => layout.id))
  const pages = Object.values(model.modules).flatMap(entry => entry.pages)
  return pages.find(page => accept(page) && (showsIn(page.root) || (!!page.layout && layouts.has(page.layout)))) ?? null
}
