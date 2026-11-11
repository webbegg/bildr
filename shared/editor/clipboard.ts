/**
 * The editor clipboard (Copy, Paste, Paste style): a copied node as a
 * `node_insert` spec (type, props, style, children; no ids, which the insert
 * makes new, and no layer name or lock), kept in memory and written to the
 * system clipboard as JSON text so another editor tab can paste it.
 */
import type { PropValue } from '../document/components'
import type { DocNode } from '../document/schema'
import { findNode, findParent } from '../document/tree'
import type { DropTarget } from './dropTarget'
import { insertTargetForSelection } from './dropTarget'
import type { StylePatch } from './preview'

export const CLIP_KIND = 'bildr/node'

/** A node as `node_insert` takes it (its `NodeSpec`). */
export interface ClipNode {
  type: string
  props: Record<string, PropValue>
  style: Record<string, string>
  children: ClipNode[]
}

export interface Clip {
  kind: typeof CLIP_KIND
  /** The copied node, so a paste over it lands after it rather than inside. */
  sourceId: string
  node: ClipNode
}

function toClipNode(node: DocNode): ClipNode {
  return { type: node.type, props: { ...node.props }, style: { ...node.style }, children: node.children.map(toClipNode) }
}

/** A copy of node `id` and its subtree; null for the root (it can't be pasted) or a missing node. */
export function copyNode(root: DocNode, id: string): Clip | null {
  const node = id === root.id ? undefined : findNode(root, id)
  return node ? { kind: CLIP_KIND, sourceId: id, node: toClipNode(node) } : null
}

export function serializeClip(clip: Clip): string {
  return JSON.stringify(clip)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function isClipNode(value: unknown): value is ClipNode {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  const { props, style, children } = value
  return isRecord(props) && Object.values(props).every(v => ['string', 'number', 'boolean'].includes(typeof v))
    && isRecord(style) && Object.values(style).every(v => typeof v === 'string')
    && Array.isArray(children) && children.every(isClipNode)
}

/** The clip in a system clipboard text, or null when the text is not one. */
export function parseClip(text: string): Clip | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(data) || data.kind !== CLIP_KIND || typeof data.sourceId !== 'string' || !isClipNode(data.node)) return null
  return { kind: CLIP_KIND, sourceId: data.sourceId, node: data.node }
}

/**
 * Where a paste goes: as an insert at the selection (into a selected
 * container, after a selected leaf, else at the end of the root), except
 * over the copied node itself, which takes the copy right after it.
 */
export function pasteTarget(root: DocNode, selectedId: string | null, clip: Clip): DropTarget {
  const source = selectedId === clip.sourceId && selectedId !== root.id ? findParent(root, selectedId) : undefined
  if (source) return { parentId: source.parent.id, index: source.index + 1 }
  return insertTargetForSelection(root, selectedId)
}

/** The patch that gives a node with `target` style the copied `style`: the changed tokens, and nulls for the ones it doesn't have. */
export function pasteStylePatch(target: Record<string, string>, style: Record<string, string>): StylePatch {
  const patch: StylePatch = {}
  for (const [key, value] of Object.entries(style)) if (target[key] !== value) patch[key] = value
  for (const key of Object.keys(target)) if (!(key in style)) patch[key] = null
  return patch
}
