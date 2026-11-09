import type { DocNode } from '../document/schema'
import { findNode, findParent, pathTo } from '../document/tree'
import type { DropTarget } from './dropTarget'

/**
 * The layers tree's pure behaviour: which rows show when some are collapsed,
 * what the arrow keys do, and where Move up / Move down send a node.
 */

/** Row ids top to bottom; the children of a collapsed row are hidden. */
export function visibleLayers(root: DocNode, collapsed: ReadonlySet<string>): string[] {
  const ids: string[] = []
  const visit = (node: DocNode) => {
    ids.push(node.id)
    if (!collapsed.has(node.id)) node.children.forEach(visit)
  }
  visit(root)
  return ids
}

export type LayerKeyAction = { select: string } | { collapse: string } | { expand: string }

/**
 * What an arrow key does on the layers tree: Up/Down step through the visible
 * rows; Left collapses an open row, else goes to the parent; Right expands a
 * collapsed row. Null when the key does nothing there.
 */
export function layerKeyAction(root: DocNode, collapsed: ReadonlySet<string>, selectedId: string | null, key: string): LayerKeyAction | null {
  const rows = visibleLayers(root, collapsed)
  const node = selectedId ? findNode(root, selectedId) : undefined
  if (!node) return key === 'ArrowDown' || key === 'ArrowUp' ? { select: rows[0]! } : null
  const open = node.children.length > 0 && !collapsed.has(node.id)
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const next = rows[rows.indexOf(node.id) + (key === 'ArrowDown' ? 1 : -1)]
      return next ? { select: next } : null
    }
    case 'ArrowLeft': {
      if (open) return { collapse: node.id }
      const parent = findParent(root, node.id)?.parent
      return parent ? { select: parent.id } : null
    }
    case 'ArrowRight':
      return node.children.length && !open ? { expand: node.id } : null
    default:
      return null
  }
}

/** The collapsed rows, root first, that hide node `id`. */
export function collapsedAncestors(root: DocNode, collapsed: ReadonlySet<string>, id: string): string[] {
  return pathTo(root, id).slice(0, -1).filter(ancestor => collapsed.has(ancestor))
}

/**
 * The `node_move_many` moves that step every node in `ids` one place up (-1)
 * or down (1) among its siblings, as one block: null when one of them is at
 * the end already or is the root. Moves run nearest-the-end first, so each
 * index is still right when its move runs.
 */
export function siblingMoves(root: DocNode, ids: readonly string[], delta: -1 | 1): { nodeId: string, parentId: string, index: number }[] | null {
  const moves: { nodeId: string, parentId: string, index: number }[] = []
  for (const id of new Set(ids)) {
    const to = siblingMove(root, id, delta)
    if (!to) return null
    moves.push({ nodeId: id, ...to })
  }
  return moves.sort((a, b) => (a.index - b.index) * -delta)
}

/** The `node_move` slot one step up (-1) or down (1) among the node's siblings; null at either end or for the root. */
export function siblingMove(root: DocNode, id: string, delta: -1 | 1): DropTarget | null {
  const location = findParent(root, id)
  if (!location) return null
  const index = location.index + delta
  if (index < 0 || index >= location.parent.children.length) return null
  return { parentId: location.parent.id, index }
}
