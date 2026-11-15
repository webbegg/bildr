import type { ModelNode } from '@bildr/codegen/model'
import { findNode, findParent } from '../design/tree.ts'
import { moveSlot } from '../editor/drop.ts'
import type { DropTarget } from '../editor/drop.ts'
import { nearestUnlocked } from './drop.ts'

/**
 * The lifecycle of a canvas pointer drag (the hosted `shared/editor/gesture.ts` and the
 * drag parts of `reorder.ts`, over `ModelNode`), the pure part. A press on the
 * selection is `pending` until it travels past the threshold with the primary
 * button held, then `active`; a handle press is active at once. A gesture
 * ends one way: an active one commits on its release or is cancelled (like
 * Esc: its preview dropped), a pending one is abandoned (no effect, its click
 * still selects). Anything that means the press is over ends it: a move with
 * the primary button up (the release happened outside the frame), Esc,
 * pointercancel, window blur, lost pointer capture, the dragged node going
 * (`gestureTargetGone`), or a new press. Leaving the frame ends a pending
 * press only; an active drag has the pointer captured.
 */

export interface Point { x: number, y: number }

/** Px of travel past which a press on a selected node becomes a drag. */
export const REORDER_THRESHOLD = 4

export function pastThreshold(from: Point, to: Point, threshold = REORDER_THRESHOLD): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > threshold
}

export type GesturePhase = 'pending' | 'active'

export interface GestureState {
  pointerId: number
  /** Where the press started, in canvas px. */
  start: Point
  phase: GesturePhase
}

export type GestureEndReason = 'escape' | 'pointercancel' | 'blur' | 'lostcapture' | 'target-gone' | 'press' | 'leave'

export type GestureEvent
  = | { type: 'move', pointerId: number, point: Point, buttons: number }
    | { type: 'up', pointerId: number }
    /** An exit; with a `pointerId`, only that pointer's gesture ends. */
    | { type: 'end', reason: GestureEndReason, pointerId?: number }

/**
 * - `ignore`: not this gesture's event; nothing changes.
 * - `wait`: a pending press still under the threshold.
 * - `activate`: the press became a drag (capture the pointer), at this move.
 * - `drag`: a move of an active drag.
 * - `commit`: the release of an active drag.
 * - `cancel`: an active drag ended without effect.
 * - `abandon`: a pending press ended without effect.
 */
export type GestureEffect = 'ignore' | 'wait' | 'activate' | 'drag' | 'commit' | 'cancel' | 'abandon'

export function startGesture(pointerId: number, start: Point, active: boolean): GestureState {
  return { pointerId, start, phase: active ? 'active' : 'pending' }
}

/** The primary button in a `buttons` bitmask. */
const PRIMARY = 1

/** The gesture after `event` (null once it ended), and what the adapter does about it. */
export function stepGesture(state: GestureState, event: GestureEvent, threshold = REORDER_THRESHOLD): { state: GestureState | null, effect: GestureEffect } {
  const ended = { state: null, effect: state.phase === 'active' ? 'cancel' : 'abandon' } as const
  const ignore = { state, effect: 'ignore' } as const
  if (event.type === 'end') {
    if (event.pointerId !== undefined && event.pointerId !== state.pointerId) return ignore
    if (event.reason === 'leave' && state.phase === 'active') return ignore
    return ended
  }
  if (event.pointerId !== state.pointerId) return ignore
  if (event.type === 'up') return { state: null, effect: state.phase === 'active' ? 'commit' : 'abandon' }
  if ((event.buttons & PRIMARY) === 0) return ended
  if (state.phase === 'active') return { state, effect: 'drag' }
  if (!pastThreshold(state.start, event.point, threshold)) return { state, effect: 'wait' }
  return { state: { ...state, phase: 'active' }, effect: 'activate' }
}

/** Whether the node a gesture drags is gone: no longer the only selection, not in the rendered tree, or on another file. */
export function gestureTargetGone(gesture: { nodeId: string, pageId: string | undefined }, now: { pageId: string | undefined, root: ModelNode | null | undefined, selectedIds: readonly string[] }): boolean {
  return gesture.pageId !== now.pageId
    || !now.root
    || !findNode(now.root, gesture.nodeId)
    || now.selectedIds.length !== 1
    || now.selectedIds[0] !== gesture.nodeId
}

/** Whether the canvas may drag node `id`: it exists, is not the root, and neither it nor an ancestor is locked. */
export function canDragNode(root: ModelNode, id: string): boolean {
  return id !== root.id && !!findNode(root, id) && nearestUnlocked(root, id) === id
}

/** Whether moving node `id` to the drop slot `target` would leave it where it is. */
export function isNoopMove(root: ModelNode, id: string, target: DropTarget): boolean {
  const to = moveSlot(root, id, target)
  const from = findParent(root, id)
  return !!from && from.id === to.parentId && (from.children ?? []).findIndex(child => child.id === id) === to.index
}
