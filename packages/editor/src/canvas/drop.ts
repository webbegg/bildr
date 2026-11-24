import type { ModelNode } from '@bildr/codegen/model'
import { isContainerType } from '@bildr/codegen/edit'

/**
 * Where something dragged over the canvas drops (P4a): the geometry half of
 * the hosted `reorder`/`dropTarget`, over `.bildr` `ModelNode` trees. Over a
 * container, the slot among its children nearest the pointer along its axis
 * (inside it when empty); over a leaf, before or after it in its parent by
 * the half the pointer is in. Locked nodes (or inside a lock) take no drop:
 * their nearest unlocked ancestor does. A dragged node never drops into its
 * own subtree: over it, the drop goes around the dragged node.
 */

export interface Point { x: number, y: number }
export interface Box { x: number, y: number, width: number, height: number }

export interface DropSlot {
  parentId: string
  index: number
  /** Where the indicator goes, relative to `markId`'s box. */
  position: 'before' | 'after' | 'inside'
  markId: string
  /** The parent lays its children out in a row: the indicator is a vertical line. */
  horizontal: boolean
}

/**
 * Whether a node takes a drop inside it on the canvas: a container type,
 * except a Link (inline text) and an Instance or a SlotFill (a drop on an
 * instance lands after it).
 */
const takesDropInside = (type: string): boolean => isContainerType(type) && !['Link', 'Instance', 'SlotFill'].includes(type)

const pathTo = (node: ModelNode, id: string): ModelNode[] | undefined => {
  if (node.id === id) return [node]
  for (const child of node.children ?? []) {
    const path = pathTo(child, id)
    if (path) return [node, ...path]
  }
  return undefined
}

/** The node a pointer gesture on `id` reaches: itself, or the parent of the outermost lock around it; null under a locked root. */
export function nearestUnlocked(root: ModelNode, id: string): string | null {
  const path = pathTo(root, id)
  if (!path) return null
  const locked = path.findIndex(node => node.locked === true)
  if (locked < 0) return id
  return locked > 0 ? path[locked - 1]!.id : null
}

/**
 * The insert slot of an armed tool for a click on node `overId` at `point` (the hosted `insertTargetAt`).
 * A container (or the page root) takes the component between the children around the pointer, read
 * along its layout axis (`row`; `childRects` are its children's boxes, in order); a leaf takes it right
 * after itself. The caller resolves locks (`nearestUnlocked`) first. Null for an unknown node.
 */
export function insertTarget(root: ModelNode, overId: string, point: Point, childRects: ReadonlyArray<Box | null>, row: boolean): DropSlot | null {
  const path = pathTo(root, overId)
  const over = path?.at(-1)
  if (!path || !over) return null
  if (over !== root && !takesDropInside(over.type)) {
    const parent = path.at(-2)!
    const at = (parent.children ?? []).findIndex(child => child.id === over.id)
    return { parentId: parent.id, index: at + 1, position: 'after', markId: over.id, horizontal: false }
  }
  const children = (over.children ?? []).slice(0, childRects.length)
  // A child with no box (hidden at this breakpoint, not rendered) is nowhere on screen: it is never before the pointer.
  const boxes = children.map((_, i) => {
    const rect = childRects[i]
    return rect && (rect.width > 0 || rect.height > 0) ? rect : null
  })
  // A child is before the pointer when the pointer is past its middle; in a wrapping row, one on an earlier line is
  // before it and one on a later line is not, and only children on the pointer's line compare x.
  const before = (rect: Box) => {
    if (!row) return point.y > rect.y + rect.height / 2
    if (point.y > rect.y + rect.height) return true
    if (point.y < rect.y) return false
    return point.x > rect.x + rect.width / 2
  }
  const index = boxes.reduce((last, rect, i) => (rect && before(rect) ? i + 1 : last), 0)
  if (!children.length) return { parentId: over.id, index: 0, position: 'inside', markId: over.id, horizontal: row }
  // The indicator is drawn against a child that is on screen: the next one, else the last one before.
  const next = boxes.findIndex((rect, i) => i >= index && rect)
  if (next >= 0) return { parentId: over.id, index, position: 'before', markId: children[next]!.id, horizontal: row }
  const prev = boxes.findLastIndex(rect => rect)
  if (prev >= 0) return { parentId: over.id, index, position: 'after', markId: children[prev]!.id, horizontal: row }
  return { parentId: over.id, index: children.length, position: 'inside', markId: over.id, horizontal: row }
}

/**
 * The grid cell a drop lands in (layout-containers L4: a grid shows the cell,
 * a stack a line): before a child, its cell (it moves on); after the last one,
 * the next cell, beside it or at the start of the next row. `mark` is the
 * child's box, `grid` the grid's content box, `gap` its column and row gaps.
 */
export function gridCell(position: 'before' | 'after', mark: Box, grid: Box, gap: Point): Box {
  if (position === 'before') return mark
  const beside = mark.x + mark.width + gap.x
  return beside + mark.width <= grid.x + grid.width + 0.5
    ? { ...mark, x: beside }
    : { ...mark, x: grid.x, y: mark.y + mark.height + gap.y }
}

export function dropTarget(
  root: ModelNode,
  overId: string,
  point: Point,
  rectOf: (id: string) => Box | null,
  isRow: (id: string) => boolean,
  draggedId?: string
): DropSlot | null {
  let id = nearestUnlocked(root, overId)
  if (!id) return null
  if (draggedId && pathTo(root, id)?.some(node => node.id === draggedId)) id = draggedId
  const path = pathTo(root, id)!
  const node = path.at(-1)!
  const along = (box: Box, row: boolean) => row ? point.x > box.x + box.width / 2 : point.y > box.y + box.height / 2
  if (takesDropInside(node.type) && id !== draggedId) {
    const kids = node.children ?? []
    const row = isRow(node.id)
    if (!kids.length) return { parentId: node.id, index: 0, position: 'inside', markId: node.id, horizontal: row }
    const index = kids.filter((child) => {
      const box = rectOf(child.id)
      return box ? along(box, row) : false
    }).length
    return index < kids.length
      ? { parentId: node.id, index, position: 'before', markId: kids[index]!.id, horizontal: row }
      : { parentId: node.id, index, position: 'after', markId: kids.at(-1)!.id, horizontal: row }
  }
  const parent = path.at(-2)
  const box = rectOf(node.id)
  if (!parent || !box) return null
  const row = isRow(parent.id)
  const after = along(box, row)
  const at = (parent.children ?? []).findIndex(child => child.id === node.id)
  return { parentId: parent.id, index: at + (after ? 1 : 0), position: after ? 'after' : 'before', markId: node.id, horizontal: row }
}
