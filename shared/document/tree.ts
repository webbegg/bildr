import type { DocNode } from './schema'

/** Visits `node` and every descendant, depth-first, parents before children. */
export function walk(node: DocNode, visit: (node: DocNode, parent?: DocNode) => void, parent?: DocNode): void {
  visit(node, parent)
  for (const child of node.children) walk(child, visit, node)
}

export function findNode(root: DocNode, id: string): DocNode | undefined {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

/** The parent of node `id` and its index there; undefined for the root or a missing node. */
export function findParent(root: DocNode, id: string): { parent: DocNode, index: number } | undefined {
  const index = root.children.findIndex(child => child.id === id)
  if (index >= 0) return { parent: root, index }
  for (const child of root.children) {
    const found = findParent(child, id)
    if (found) return found
  }
  return undefined
}

/** True when `id` is `ancestor` itself or anywhere below it. */
export function containsNode(ancestor: DocNode, id: string): boolean {
  return findNode(ancestor, id) !== undefined
}

/**
 * Whether node `id` is locked on the canvas: it or one of its ancestors has
 * `locked: true`. False for a missing node. A locked node stays selectable
 * and editable from the layers and through actions.
 */
export function isLockedAt(root: DocNode, id: string): boolean {
  if (root.id === id) return root.locked === true
  for (const child of root.children) {
    if (findNode(child, id)) return root.locked === true || isLockedAt(child, id)
  }
  return false
}

/** Ids from the root down to node `id`, inclusive; empty when missing. */
export function pathTo(root: DocNode, id: string): string[] {
  if (root.id === id) return [root.id]
  for (const child of root.children) {
    const path = pathTo(child, id)
    if (path.length) return [root.id, ...path]
  }
  return []
}
