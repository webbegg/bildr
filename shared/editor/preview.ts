import { applyStylePreview, showsPatch } from '@bildr/editor-core/preview'
import type { StylePatch } from '@bildr/editor-core/preview'
import type { DocNode } from '../document/schema'
import { findNode } from '../document/tree'

// Patches, the preview state, throttling and menu option previews are
// format-independent (@bildr/editor-core, P1); applying previews to a
// hosted document tree stays here.
export * from '@bildr/editor-core/preview'

/** The tree with each node's preview applied; branches without a preview are kept as they are. */
export function previewTree(root: DocNode, previews: Record<string, StylePatch>): DocNode {
  if (!Object.keys(previews).length) return root
  const patch = previews[root.id]
  const children = root.children.map(child => previewTree(child, previews))
  if (!patch && children.every((child, i) => child === root.children[i])) return root
  return { ...root, style: applyStylePreview(root.style, patch), children }
}

/**
 * The previews still needed after a render of `root`: one the render already
 * shows has been committed, and one whose node is gone has nothing to show.
 */
export function settlePreviews(previews: Record<string, StylePatch>, root: DocNode): Record<string, StylePatch> {
  return Object.fromEntries(Object.entries(previews).filter(([id, patch]) => {
    const node = findNode(root, id)
    return node !== undefined && !showsPatch(node.style, patch)
  }))
}
