import type { Model, ModelNode } from '@bildr/codegen/model'
import { containsNode, findNode, findParent } from '../design/tree.ts'
import { pathTo } from './selection.ts'

/**
 * Where things go and what a drag carries (the hosted `dropTarget.ts`, `layers.ts`
 * and `componentEditor.ts` helpers, over `ModelNode`): the adapter's `insert`,
 * `drop`, `moveBy` and `moveSelection` use them.
 */

export interface DropTarget { parentId: string, index: number }

export const INSTANCE_TYPE = 'Instance'

/** dataTransfer type for drags from the palette and the layers tree. */
export const DRAG_MIME = 'application/x-bildr'

export type DragPayload = { kind: 'component', type: string } | { kind: 'node', id: string }

export const parseDragPayload = (raw: string): DragPayload | null => {
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

/** The `application/x-bildr` payload of an Assets row dragged onto the canvas or the layers. */
export const instanceDragPayload = (componentId: string): string => JSON.stringify({ kind: 'instance', componentId })

/** The component id of an Assets row payload; null for any other payload. */
export const parseInstancePayload = (raw: string): string | null => {
  try {
    const data = JSON.parse(raw) as { kind?: unknown, componentId?: unknown } | null
    return data?.kind === 'instance' && typeof data.componentId === 'string' ? data.componentId : null
  } catch {
    return null
  }
}

/** The `application/x-bildr` payload of an Insert layout tile. */
export const layoutDragPayload = (layoutId: string): string => JSON.stringify({ kind: 'layout', layoutId })

/** The layout id of an Insert layout tile payload; null for any other payload. */
export const parseLayoutPayload = (raw: string): string | null => {
  try {
    const data = JSON.parse(raw) as { kind?: unknown, layoutId?: unknown } | null
    return data?.kind === 'layout' && typeof data.layoutId === 'string' ? data.layoutId : null
  } catch {
    return null
  }
}

/** `target`, or when it is inside an Instance (which takes slot content only), the place right after that instance. */
export const outsideInstance = (root: ModelNode, target: DropTarget): DropTarget => {
  const parent = findNode(root, target.parentId)
  if (parent?.type !== INSTANCE_TYPE) return target
  const above = findParent(root, parent.id)
  if (!above) return target
  return { parentId: above.id, index: (above.children ?? []).findIndex(child => child.id === parent.id) + 1 }
}

/** Converts a drop slot into the `node_move` index, which counts after the node leaves its parent. */
export const moveSlot = (root: ModelNode, nodeId: string, target: DropTarget): DropTarget => {
  const parent = findParent(root, nodeId)
  const from = parent ? (parent.children ?? []).findIndex(child => child.id === nodeId) : -1
  return parent && parent.id === target.parentId && from < target.index ? { parentId: target.parentId, index: target.index - 1 } : target
}

/** The `node_move` slot one step up (-1) or down (1) among the node's siblings; null at either end or for the root. */
export const siblingMove = (root: ModelNode, id: string, delta: -1 | 1): DropTarget | null => {
  const parent = findParent(root, id)
  if (!parent) return null
  const siblings = parent.children ?? []
  const index = siblings.findIndex(child => child.id === id) + delta
  return index < 0 || index >= siblings.length ? null : { parentId: parent.id, index }
}

export interface Move extends DropTarget { nodeId: string }

/**
 * The `node_move_many` moves that step every node in `ids` one place up (-1)
 * or down (1) among its siblings, as one block: null when one of them is at
 * the end already or is the root. Moves run nearest-the-end first, so each
 * index is still right when its move runs.
 */
export const siblingMoves = (root: ModelNode, ids: readonly string[], delta: -1 | 1): Move[] | null => {
  const moves: Move[] = []
  for (const id of new Set(ids)) {
    const to = siblingMove(root, id, delta)
    if (!to) return null
    moves.push({ nodeId: id, ...to })
  }
  return moves.sort((a, b) => (a.index - b.index) * -delta)
}

/** The collapsed rows, root first, that hide node `id`. */
export const collapsedAncestors = (root: ModelNode, collapsed: ReadonlySet<string>, id: string): string[] => pathTo(root, id).slice(0, -1).filter(ancestor => collapsed.has(ancestor))

/** Whether component `id` (through its own tree and the components in it) has an Instance of `target`. */
const usesComponent = (model: Model, id: string, target: string, seen = new Set<string>()): boolean => {
  if (seen.has(id)) return false
  seen.add(id)
  const component = Object.values(model.modules).flatMap(entry => entry.components).find(entry => entry.id === id)
  if (!component) return false
  const used: string[] = []
  const walk = (node: ModelNode) => {
    if (node.type === INSTANCE_TYPE && typeof node.props?.component === 'string') used.push(node.props.component)
    node.children?.forEach(walk)
  }
  walk(component.root)
  return used.some(next => next === target || usesComponent(model, next, target, seen))
}

/** The components an Instance of can go into the tree being edited: on a page all; in component `editingId` neither it nor the ones that use it. */
export const insertableComponents = (model: Model, editingId: string | null) => {
  const all = Object.values(model.modules).flatMap(entry => entry.components)
  return editingId ? all.filter(component => component.id !== editingId && !usesComponent(model, component.id, editingId)) : all
}

/** Whether dropping node `draggedId` at `target` would move it into itself. */
export const movesIntoItself = (root: ModelNode, draggedId: string, target: DropTarget): boolean => {
  const node = findNode(root, draggedId)
  return !node || node === root || containsNode(node, target.parentId)
}
