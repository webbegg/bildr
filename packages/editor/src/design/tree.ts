import type { ModelNode } from '@bildr/codegen/model'

/** Tree helpers over `.bildr` `ModelNode` trees (the hosted `shared/document` lookups, on the model's shapes). */

export const findNode = (node: ModelNode, id: string): ModelNode | undefined => {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

export const findParent = (node: ModelNode, id: string): ModelNode | undefined => {
  if (node.children?.some(child => child.id === id)) return node
  for (const child of node.children ?? []) {
    const found = findParent(child, id)
    if (found) return found
  }
  return undefined
}

export const containsNode = (node: ModelNode, id: string): boolean => !!findNode(node, id)

/** Every node id of a tree, depth first. */
export const nodeIds = (node: ModelNode): string[] => [node.id, ...(node.children ?? []).flatMap(nodeIds)]

export type DropPosition = 'before' | 'after' | 'inside'

/**
 * The index `node_move` takes (the node's index *after* the move) for a slot
 * among the current children of `parentId`: the slot counts the dragged node
 * while it is still there, so a node moving later in its own parent lands one
 * earlier.
 */
export const slotIndex = (root: ModelNode, draggedId: string, parentId: string, slot: number): number => {
  const siblings = findNode(root, parentId)?.children ?? []
  const from = siblings.findIndex(child => child.id === draggedId)
  return from >= 0 && from < slot ? slot - 1 : slot
}

/**
 * Where dropping `draggedId` before, after or inside the layer `overId` puts
 * it, as `node_move`'s parent and index; null for a drop that does nothing
 * sensible: onto itself or inside its own subtree, beside the root, or inside
 * a leaf (`inside` needs the caller to have checked the target holds children).
 */
export const moveTarget = (root: ModelNode, draggedId: string, overId: string, position: DropPosition): { parentId: string, index: number } | null => {
  const dragged = findNode(root, draggedId)
  const over = findNode(root, overId)
  if (!dragged || !over || containsNode(dragged, overId)) return null
  if (position === 'inside') {
    if (!over.children) return null
    return { parentId: over.id, index: slotIndex(root, draggedId, over.id, over.children.length) }
  }
  const parent = findParent(root, overId)
  if (!parent) return null
  const at = parent.children!.findIndex(child => child.id === overId)
  return { parentId: parent.id, index: slotIndex(root, draggedId, parent.id, at + (position === 'after' ? 1 : 0)) }
}
