import type { DocNode } from '../document/schema'
import { findParent } from '../document/tree'

/** What to select after deleting node `id`: next sibling, else previous, else the parent. */
export function selectionAfterDelete(root: DocNode, id: string): string | null {
  const location = findParent(root, id)
  if (!location) return null
  const { parent, index } = location
  return parent.children[index + 1]?.id ?? parent.children[index - 1]?.id ?? parent.id
}
