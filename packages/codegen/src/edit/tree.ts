import type { ModelNode } from '../model/schemas.ts'

/** Walks over `ModelNode` trees, the way `shared/document/tree.ts` does over hosted documents. */

/** Visits `node` and every descendant, depth-first, parents before children. */
export const walk = (node: ModelNode, visit: (node: ModelNode, parent?: ModelNode) => void, parent?: ModelNode): void => {
  visit(node, parent)
  for (const child of node.children ?? []) walk(child, visit, node)
}

export const findNode = (root: ModelNode, id: string): ModelNode | undefined => {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

/** The parent of node `id` and its index there; undefined for the root or a missing node. */
export const findParent = (root: ModelNode, id: string): { parent: ModelNode, index: number } | undefined => {
  const children = root.children ?? []
  const index = children.findIndex(child => child.id === id)
  if (index >= 0) return { parent: root, index }
  for (const child of children) {
    const found = findParent(child, id)
    if (found) return found
  }
  return undefined
}

/** True when `id` is `ancestor` itself or anywhere below it. */
export const containsNode = (ancestor: ModelNode, id: string): boolean => findNode(ancestor, id) !== undefined

/** The ids of `node` and everything below it. */
export const subtreeIds = (node: ModelNode): Set<string> => {
  const ids = new Set<string>()
  walk(node, entry => ids.add(entry.id))
  return ids
}

export const clampIndex = (index: number | undefined, length: number): number =>
  index === undefined ? length : Math.max(0, Math.min(Math.trunc(index), length))

/** Inserts `node` among `parent`'s children at `index` (the end without one). */
export const insertChild = (parent: ModelNode, node: ModelNode, index?: number): void => {
  const children = parent.children ??= []
  children.splice(clampIndex(index, children.length), 0, node)
}

/** A deep copy of `node` where it and every descendant get a fresh id from `mint`, parents first. */
export const cloneWithNewIds = (node: ModelNode, mint: (type: string) => string): ModelNode => {
  const { children, ...rest } = structuredClone(node)
  const copy: ModelNode = { ...rest, id: mint(node.type) }
  if (children) copy.children = (node.children ?? []).map(child => cloneWithNewIds(child, mint))
  return copy
}
