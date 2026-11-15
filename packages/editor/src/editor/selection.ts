import type { ModelNode } from '@bildr/codegen/model'
import { containsNode, findNode, findParent } from '../design/tree.ts'

/**
 * The hosted `shared/editor/selection.ts`, over `ModelNode` trees (children are
 * optional here, `.bildr` has no `DocNode`): what a click, a key or a delete
 * does to the selection.
 */

const childrenOf = (node: ModelNode): ModelNode[] => node.children ?? []

/** The ids from the root down to `id` (empty when it is not in the tree). */
export const pathTo = (root: ModelNode, id: string): string[] => {
  if (root.id === id) return [id]
  for (const child of childrenOf(root)) {
    const path = pathTo(child, id)
    if (path.length) return [root.id, ...path]
  }
  return []
}

/** Whether `id` or one of its ancestors is locked. */
export const isLockedAt = (root: ModelNode, id: string): boolean => pathTo(root, id).some(step => findNode(root, step)?.locked === true)

/** What to select after deleting node `id`: next sibling, else previous, else the parent. */
export const selectionAfterDelete = (root: ModelNode, id: string): string | null => {
  const parent = findParent(root, id)
  if (!parent) return null
  const siblings = childrenOf(parent)
  const index = siblings.findIndex(child => child.id === id)
  return siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? parent.id
}

/**
 * What a canvas click on `clickedId` selects. Deep mode (Cmd/Ctrl+click, or
 * the Deep select setting) selects the clicked element itself. Otherwise, as
 * in Figma: inside a selected ancestor the click selects that ancestor's
 * child toward the element; inside a sibling of a selected node it selects at
 * the same depth; else it selects the root's top-level child that holds it.
 */
export const drillTarget = (root: ModelNode, selectedIds: readonly string[], clickedId: string, { deep }: { deep: boolean }): string | null => {
  const path = pathTo(root, clickedId)
  if (!path.length) return null
  if (deep) return clickedId
  const ancestor = Math.max(...selectedIds.map(id => path.indexOf(id)))
  if (ancestor >= 0) return path[ancestor + 1] ?? clickedId
  const level = Math.max(...selectedIds.map(id => path.indexOf(findParent(root, id)?.id ?? '')))
  if (level >= 0) return path[level + 1] ?? clickedId
  return path[1] ?? root.id
}

/** Shift+click: adds `id` at the end (the new primary selection), or removes it. */
export const toggleSelection = (ids: readonly string[], id: string): string[] => ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]

/** Cmd/Ctrl+A: every child of the primary (last) selection's parent; the root's children with nothing or the root selected. */
export const selectAllSiblings = (root: ModelNode, ids: readonly string[]): string[] => {
  const primary = ids.at(-1)
  const parent = primary ? findParent(root, primary) ?? root : root
  return childrenOf(parent).map(child => child.id)
}

export type SelectionStep = 'child' | 'parent' | 'next' | 'prev'

/** Enter (first child), Shift+Enter (parent), Tab / Shift+Tab (next / previous sibling, wrapping); null when there is none. */
export const navigateSelection = (root: ModelNode, id: string, step: SelectionStep): string | null => {
  if (step === 'child') return childrenOf(findNode(root, id) ?? { id, type: '' })[0]?.id ?? null
  const parent = findParent(root, id)
  if (!parent) return null
  if (step === 'parent') return parent.id
  const siblings = childrenOf(parent)
  const index = siblings.findIndex(child => child.id === id)
  return siblings[(index + (step === 'next' ? 1 : siblings.length - 1)) % siblings.length]?.id ?? null
}

/** The nodes a delete or duplicate acts on: known, not the root, once each, and not inside another selected node. */
export const topLevelSelection = (root: ModelNode, ids: readonly string[]): string[] => {
  const known = [...new Set(ids)].filter(id => id !== root.id && findNode(root, id))
  return known.filter(id => !known.some(other => other !== id && containsNode(findNode(root, other)!, id)))
}

/** The nodes a canvas arrow-key move acts on: the `topLevelSelection` without locked nodes or nodes inside a lock. */
export const canvasMovable = (root: ModelNode, ids: readonly string[]): string[] => topLevelSelection(root, ids).filter(id => !isLockedAt(root, id))

/**
 * What a canvas click or hover on `id` reaches: `id`, or when it or an
 * ancestor is locked, the nearest ancestor above every lock. Null when the
 * root is locked or `id` is missing.
 */
export const nearestUnlocked = (root: ModelNode, id: string): string | null => {
  const path = pathTo(root, id)
  const firstLocked = path.findIndex(step => findNode(root, step)?.locked === true)
  if (firstLocked < 0) return path.at(-1) ?? null
  return firstLocked > 0 ? path[firstLocked - 1]! : null
}

/** Escape, as in Framer: the selection becomes the primary selection's parent; on the root (or nothing) it clears. */
export const escapeSelection = (root: ModelNode, ids: readonly string[]): string[] => {
  const primary = ids.at(-1)
  const parent = primary ? findParent(root, primary) : undefined
  return parent ? [parent.id] : []
}

/** The ids of the nodes of `root` that `test` accepts, in document order. */
const collect = (root: ModelNode, test: (node: ModelNode) => boolean): string[] => [...(test(root) ? [root.id] : []), ...childrenOf(root).flatMap(child => collect(child, test))]

/** Select ▸ Same type: every node of `id`'s type, in document order. */
export const sameTypeNodes = (root: ModelNode, id: string): string[] => {
  const node = findNode(root, id)
  return node ? collect(root, other => other.type === node.type) : []
}

/** Select ▸ Same component: every instance of `id`'s component, in document order; none when `id` is not an instance. */
export const sameComponentNodes = (root: ModelNode, id: string): string[] => {
  const node = findNode(root, id)
  if (node?.type !== 'Instance') return []
  return collect(root, other => other.type === 'Instance' && other.props?.component === node.props?.component)
}

/** The parent shared by all `ids` (siblings only); undefined for none, the root, or nodes of different parents. */
export const siblingParent = (root: ModelNode, ids: readonly string[]): ModelNode | undefined => {
  const parents = ids.map(id => findParent(root, id))
  const first = parents[0]
  return first && parents.every(parent => parent === first) ? first : undefined
}
