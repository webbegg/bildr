import type { ModelNode } from '@bildr/codegen/model'
import { containsNode, findNode, findParent } from '../design/tree.ts'
import { DRAG_MIME } from '../editor/drop.ts'
import type { DropTarget } from '../editor/drop.ts'

/**
 * The layers tree's drag-and-drop geometry (the hosted `shared/editor/dropTarget.ts`,
 * over `ModelNode`): where a pointer over a row drops, and which parent slot that
 * means. The canvas has its own (`canvas/drop.ts`, the P4a geometry).
 */

export { DRAG_MIME }
export type { DropTarget }

export type DropPosition = 'before' | 'inside' | 'after'

export interface Rect { top: number, left: number, width: number, height: number }

const NODE_TYPE_PREFIX = `${DRAG_MIME}-node;`

/**
 * An extra dataTransfer type carrying the dragged node id: drop targets can
 * read the types during dragover, but not the data (the canvas reads the same).
 */
export const nodeDragType = (id: string): string => `${NODE_TYPE_PREFIX}${id}`

export const draggedNodeId = (types: readonly string[]): string | undefined => types.find(type => type.startsWith(NODE_TYPE_PREFIX))?.slice(NODE_TYPE_PREFIX.length)

/**
 * What a drag from the palette, Assets or the layers carries as `application/x-bildr`: the hosted
 * payload (`kind`), which the adapter's `drop` reads for a drop onto the canvas as well as the layers.
 */
export const insertPayload = (type: string): string => JSON.stringify({ kind: 'component', type })
export const nodePayload = (id: string): string => JSON.stringify({ kind: 'node', id })
export const instancePayload = (componentId: string): string => JSON.stringify({ kind: 'instance', componentId })

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
 * `isContainer` says which node types hold children (the store's catalog).
 */
export function resolveDrop(root: ModelNode, overId: string, position: DropPosition, draggedId: string | undefined, isContainer: (type: string) => boolean): DropTarget | null {
  const over = findNode(root, overId)
  if (!over) return null
  if (draggedId) {
    const dragged = findNode(root, draggedId)
    if (!dragged || dragged === root || containsNode(dragged, overId)) return null
  }
  if (over === root || (position === 'inside' && isContainer(over.type))) return { parentId: over.id, index: (over.children ?? []).length }
  const parent = findParent(root, overId)
  if (!parent) return null
  const at = (parent.children ?? []).findIndex(child => child.id === overId)
  return { parentId: parent.id, index: position === 'before' ? at : at + 1 }
}
