/**
 * The editor clipboard (Copy, Paste, Paste style): the copied top-level
 * selection as `node_insert` specs (type, props, style, children; no ids,
 * which the insert makes new, and no layer name or lock), kept in memory and
 * written to the system clipboard as JSON text so another editor tab can
 * paste it. Each clip is stamped with when it was copied, so a newer clip in
 * the system clipboard (another tab's) wins over the in-memory one
 * (`newerClip`). A paste inserts every node with `nodes` and `exact: true`
 * (`pasteInput`), one undo step, so no component default the source lacks
 * comes back.
 */
import type { PropValue } from '../document/components'
import type { DocNode } from '../document/schema'
import { findNode, findParent, walk } from '../document/tree'
import type { DropTarget } from './dropTarget'
import { insertTargetForSelection } from './dropTarget'
import type { StylePatch } from './preview'
import { topLevelSelection } from './selection'

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
  /** The copied nodes' ids, so a paste over one of them lands after it rather than inside. */
  sourceIds: string[]
  /** The copied nodes, in document order (one per `sourceIds` entry). */
  nodes: ClipNode[]
  /** When it was copied (ms since the epoch); 0 for a clip from an older editor. */
  copiedAt: number
}

function toClipNode(node: DocNode): ClipNode {
  return { type: node.type, props: { ...node.props }, style: { ...node.style }, children: node.children.map(toClipNode) }
}

/**
 * A copy of the top-level nodes of `ids` (none inside another one, never the
 * root or a missing node) and their subtrees, in document order; null when
 * none is left.
 */
export function copyNodes(root: DocNode, ids: readonly string[], copiedAt = Date.now()): Clip | null {
  const top = new Set(topLevelSelection(root, ids))
  const nodes: DocNode[] = []
  walk(root, (node) => {
    if (top.has(node.id)) nodes.push(node)
  })
  if (!nodes.length) return null
  return { kind: CLIP_KIND, sourceIds: nodes.map(node => node.id), nodes: nodes.map(toClipNode), copiedAt }
}

/** A copy of node `id` and its subtree; null for the root (it can't be pasted) or a missing node. */
export function copyNode(root: DocNode, id: string, copiedAt = Date.now()): Clip | null {
  return copyNodes(root, [id], copiedAt)
}

/** The clip as JSON text; it also carries the first node as `sourceId` and `node`, the single-node format older editors read. */
export function serializeClip(clip: Clip): string {
  return JSON.stringify({ ...clip, sourceId: clip.sourceIds[0], node: clip.nodes[0] })
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function isClipNode(value: unknown): value is ClipNode {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  const { props, style, children } = value
  return isRecord(props) && Object.values(props).every(v => ['string', 'number', 'boolean'].includes(typeof v))
    && isRecord(style) && Object.values(style).every(v => typeof v === 'string')
    && Array.isArray(children) && children.every(isClipNode)
}

/** The clip in a system clipboard text, or null when the text is not one; an old single-node clip reads as copied at 0. */
export function parseClip(text: string): Clip | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(data) || data.kind !== CLIP_KIND) return null
  const { sourceIds, nodes, copiedAt } = data
  if (Array.isArray(nodes) || Array.isArray(sourceIds) || copiedAt !== undefined) {
    const valid = Array.isArray(nodes) && nodes.length > 0 && nodes.every(isClipNode)
      && Array.isArray(sourceIds) && sourceIds.length === nodes.length && sourceIds.every(id => typeof id === 'string')
      && typeof copiedAt === 'number' && Number.isFinite(copiedAt)
    return valid ? { kind: CLIP_KIND, sourceIds: sourceIds as string[], nodes, copiedAt } : null
  }
  if (typeof data.sourceId !== 'string' || !isClipNode(data.node)) return null
  return { kind: CLIP_KIND, sourceIds: [data.sourceId], nodes: [data.node], copiedAt: 0 }
}

/** The clip a paste uses: the system clipboard's when it was copied after the in-memory one (e.g. in another tab), else the in-memory one. */
export function newerClip(memory: Clip | null, system: Clip | null): Clip | null {
  if (!system) return memory
  return !memory || system.copiedAt > memory.copiedAt ? system : memory
}

/**
 * The `node_insert` input that pastes `clip` (the target aside): its nodes
 * with `exact: true`, so the copies and their descendants keep exactly the
 * copied props and style, without the component defaults the sources no
 * longer have. One insert, so one undo step.
 */
export function pasteInput(clip: Clip): { nodes: ClipNode[], exact: true } {
  return { nodes: clip.nodes, exact: true }
}

/** The style Paste style gives: the first copied node's. */
export function clipStyle(clip: Clip): Record<string, string> {
  return clip.nodes[0]!.style
}

/**
 * Where a paste goes: as an insert at the selection (into a selected
 * container, after a selected leaf, else at the end of the root), except
 * over a copied node itself, which takes the copies right after it.
 */
export function pasteTarget(root: DocNode, selectedId: string | null, clip: Clip): DropTarget {
  const source = selectedId && clip.sourceIds.includes(selectedId) && selectedId !== root.id && findNode(root, selectedId) ? findParent(root, selectedId) : undefined
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
