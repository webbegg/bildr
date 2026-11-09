import { isContainerType } from '../document/components'
import type { DocNode } from '../document/schema'
import { containsNode, findNode, findParent } from '../document/tree'

/**
 * Pure drag-and-drop geometry shared by the canvas and the layers tree:
 * where a pointer over a node drops, and which parent slot that means.
 */

export type DropPosition = 'before' | 'inside' | 'after'

export interface DropTarget { parentId: string, index: number }

export interface Rect { top: number, left: number, width: number, height: number }

/** dataTransfer type for drags from the palette and the layers tree. */
export const DRAG_MIME = 'application/x-bildr'

export type DragPayload = { kind: 'component', type: string } | { kind: 'node', id: string }

export function parseDragPayload(raw: string): DragPayload | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const value = data as { kind?: unknown, type?: unknown, id?: unknown } | null
  if (value?.kind === 'component' && typeof value.type === 'string') return { kind: 'component', type: value.type }
  if (value?.kind === 'node' && typeof value.id === 'string') return { kind: 'node', id: value.id }
  return null
}

const NODE_TYPE_PREFIX = `${DRAG_MIME}-node;`

/**
 * An extra dataTransfer type carrying the dragged node id: drop targets can
 * read the types during dragover, but not the data.
 */
export function nodeDragType(id: string): string {
  return `${NODE_TYPE_PREFIX}${id}`
}

export function draggedNodeId(types: readonly string[]): string | undefined {
  return types.find(type => type.startsWith(NODE_TYPE_PREFIX))?.slice(NODE_TYPE_PREFIX.length)
}

/** Share of a container's size, at each edge, that drops beside it rather than inside. */
const CONTAINER_EDGE = 0.25

/** Leaves split in halves along the axis; containers keep their middle for `inside`. */
export function dropPosition(rect: Rect, point: { x: number, y: number }, options: { container: boolean, horizontal: boolean }): DropPosition {
  const ratio = options.horizontal
    ? (point.x - rect.left) / (rect.width || 1)
    : (point.y - rect.top) / (rect.height || 1)
  if (!options.container) return ratio < 0.5 ? 'before' : 'after'
  if (ratio < CONTAINER_EDGE) return 'before'
  if (ratio > 1 - CONTAINER_EDGE) return 'after'
  return 'inside'
}

/**
 * The parent slot for dropping at `position` relative to node `overId`.
 * Anything dropped on the root goes inside it, at the end. Null when the
 * target is missing or when `draggedId` would land inside itself.
 */
export function resolveDrop(root: DocNode, overId: string, position: DropPosition, draggedId?: string): DropTarget | null {
  const over = findNode(root, overId)
  if (!over) return null
  if (draggedId) {
    const dragged = findNode(root, draggedId)
    if (!dragged || dragged === root || containsNode(dragged, overId)) return null
  }
  if (over === root || (position === 'inside' && isContainerType(over.type))) {
    return { parentId: over.id, index: over.children.length }
  }
  const location = findParent(root, overId)
  if (!location) return null
  return { parentId: location.parent.id, index: position === 'before' ? location.index : location.index + 1 }
}

/** Converts a drop slot into the `node_move` index, which counts after the node leaves its parent. */
export function moveTarget(root: DocNode, nodeId: string, target: DropTarget): DropTarget {
  const location = findParent(root, nodeId)
  if (location && location.parent.id === target.parentId && location.index < target.index) {
    return { parentId: target.parentId, index: target.index - 1 }
  }
  return target
}

/** Where a palette click inserts: into a selected container, after a selected leaf, else at the page end. */
export function insertTargetForSelection(root: DocNode, selectedId: string | null): DropTarget {
  const selected = selectedId ? findNode(root, selectedId) : undefined
  if (!selected) return { parentId: root.id, index: root.children.length }
  return resolveDrop(root, selected.id, isContainerType(selected.type) ? 'inside' : 'after')!
}
