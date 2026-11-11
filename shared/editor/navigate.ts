import type { Project } from '../document/schema'

/**
 * What an `editor_navigate` event asks the open editor to show. The event
 * carries a page and one id: a node on that page, or a component, a variant
 * of one or a layout (ids never collide across these), which the editor then
 * opens on top of the page.
 */
export interface NavigateTarget {
  pageId: string
  /** The node to select on the page; null with a component or layout. */
  nodeId: string | null
  componentId: string | null
  layoutId: string | null
  variantId: string | null
}

/** The id an `editor_navigate` event carries for a target: the variant, else the component or layout, else the page node. */
export function navigateEventId(target: Pick<NavigateTarget, 'nodeId' | 'componentId' | 'layoutId' | 'variantId'>): string | null {
  return target.variantId ?? target.componentId ?? target.layoutId ?? target.nodeId
}

/** Reads an event's id back (see `navigateEventId`): a component, variant or layout of `project`, or else a node on the page. */
export function navigateTarget(project: Pick<Project, 'components' | 'layouts'>, pageId: string, id: string | null): NavigateTarget {
  const none = { pageId, nodeId: null, componentId: null, layoutId: null, variantId: null }
  if (!id) return none
  const component = project.components.find(c => c.id === id || c.variants.some(v => v.id === id))
  if (component) return { ...none, componentId: component.id, variantId: component.id === id ? null : id }
  if (project.layouts.some(l => l.id === id)) return { ...none, layoutId: id }
  return { ...none, nodeId: id }
}
