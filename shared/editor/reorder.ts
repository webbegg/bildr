import { isContainerType } from '../document/components'
import type { DocNode } from '../document/schema'
import { findNode, findParent, isLockedAt } from '../document/tree'
import type { Breakpoint } from '../design/tokens'
import type { DropPosition, DropTarget, Rect } from './dropTarget'
import { dropNodeAt, dropPosition, laysOutInRow, moveTarget, resolveDrop } from './dropTarget'

/**
 * Canvas drags of nodes, the pure part: where the pointer over a node drops
 * (a sibling slot of an auto layout, or inside another container), shared by
 * the palette's and layers' HTML drags and the canvas's own drag-to-reorder
 * of a selected node. Locks are respected: a locked node is never dragged,
 * and a drop on one goes to its nearest unlocked ancestor (`dropNodeAt`).
 */

/** Px of travel past which a press on a selected node becomes a drag. */
export const REORDER_THRESHOLD = 4

export function pastThreshold(from: { x: number, y: number }, to: { x: number, y: number }, threshold = REORDER_THRESHOLD): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > threshold
}

/** Whether the canvas may drag node `id`: it exists, is not the root, and neither it nor an ancestor is locked. */
export function canDragNode(root: DocNode, id: string): boolean {
  return id !== root.id && !!findNode(root, id) && !isLockedAt(root, id)
}

export interface ReorderHit {
  target: DropTarget
  /** The node the drop is relative to (the one under the pointer, or its nearest unlocked ancestor). */
  nodeId: string
  position: DropPosition
  /** Whether that node's parent lays out in a row, so the indicator is a vertical line. */
  horizontal: boolean
  /** That node's rect, where the indicator goes. */
  rect: Rect
}

/**
 * The drop slot for a pointer at `point` over node `over.id` (a container
 * placeholder's when `over.placeholder`), at `breakpoint`: before or after it
 * along its parent's axis, or inside a container through its middle. `rectOf`
 * measures a node (`redirected` when a lock moved the drop to an ancestor, so
 * not the element under the pointer). Null for a missing or fully locked
 * target, or a drop of `draggedId` into itself.
 */
export function reorderTarget(
  root: DocNode,
  over: { id: string | null | undefined, placeholder: boolean },
  point: { x: number, y: number },
  breakpoint: Breakpoint | undefined,
  draggedId: string | undefined,
  rectOf: (nodeId: string, redirected: boolean) => Rect | null
): ReorderHit | null {
  const reached = dropNodeAt(root, over.id, over.placeholder)
  const node = reached ? findNode(root, reached.nodeId) : undefined
  const rect = reached && node ? rectOf(reached.nodeId, reached.redirected) : null
  if (!reached || !node || !rect) return null
  const parent = findParent(root, node.id)?.parent
  const horizontal = !!parent && laysOutInRow(parent, breakpoint)
  const position = reached.placeholder || node === root
    ? 'inside'
    : dropPosition(rect, point, { container: isContainerType(node.type), horizontal })
  const target = resolveDrop(root, node.id, position, draggedId)
  return target ? { target, nodeId: node.id, position, horizontal, rect } : null
}

/** Whether moving node `id` to the drop slot `target` would leave it where it is. */
export function isNoopMove(root: DocNode, id: string, target: DropTarget): boolean {
  const to = moveTarget(root, id, target)
  const from = findParent(root, id)
  return !!from && from.parent.id === to.parentId && from.index === to.index
}
