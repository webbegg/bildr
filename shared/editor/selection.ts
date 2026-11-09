import type { DocNode } from '../document/schema'
import { findNode, findParent, pathTo } from '../document/tree'

/** What to select after deleting node `id`: next sibling, else previous, else the parent. */
export function selectionAfterDelete(root: DocNode, id: string): string | null {
  const location = findParent(root, id)
  if (!location) return null
  const { parent, index } = location
  return parent.children[index + 1]?.id ?? parent.children[index - 1]?.id ?? parent.id
}

/** The ancestors of node `id`, from the page root down, for the inspector breadcrumb. */
export function breadcrumb(root: DocNode, id: string): { id: string, type: string }[] {
  return pathTo(root, id).slice(0, -1).map(ancestor => ({ id: ancestor, type: findNode(root, ancestor)!.type }))
}
