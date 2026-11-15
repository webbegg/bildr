import { describe, expect, it } from 'vitest'
import type { ModelNode } from '../../../codegen/src/model/schemas.ts'
import type { GestureState } from '../../src/canvas/gesture.ts'
import { canDragNode, gestureTargetGone, isNoopMove, pastThreshold, REORDER_THRESHOLD, startGesture, stepGesture } from '../../src/canvas/gesture.ts'

/** The lifecycle of a canvas pointer drag (the hosted `gesture` and `reorder` modules, over `ModelNode`). */

const at = (x: number, y: number) => ({ x, y })
const move = (x: number, y: number, buttons = 1, pointerId = 1) => ({ type: 'move' as const, pointerId, point: at(x, y), buttons })
const pending = (): GestureState => startGesture(1, at(10, 10), false)
const active = (): GestureState => startGesture(1, at(10, 10), true)

describe('the gesture lifecycle: pending → active → done or cancelled', () => {
  it('a press waits under the threshold and activates past it, with the button held', () => {
    expect(pending().phase).toBe('pending')
    expect(stepGesture(pending(), move(12, 12))).toEqual({ state: pending(), effect: 'wait' })
    const next = stepGesture(pending(), move(20, 10))
    expect(next.effect).toBe('activate')
    expect(next.state?.phase).toBe('active')
    expect(stepGesture(active(), move(20, 10)).effect).toBe('drag')
  })

  it('a move with the primary button up ends a pending press without effect, and cancels an active drag', () => {
    // The release happened outside the frame: hover on re-entry is no drag.
    expect(stepGesture(pending(), move(40, 40, 0))).toEqual({ state: null, effect: 'abandon' })
    expect(stepGesture(pending(), move(40, 40, 2))).toEqual({ state: null, effect: 'abandon' })
    expect(stepGesture(active(), move(40, 40, 0))).toEqual({ state: null, effect: 'cancel' })
  })

  it('a release commits an active drag; a release of a press that never moved is no drag', () => {
    expect(stepGesture(active(), { type: 'up', pointerId: 1 })).toEqual({ state: null, effect: 'commit' })
    expect(stepGesture(pending(), { type: 'up', pointerId: 1 })).toEqual({ state: null, effect: 'abandon' })
  })

  it('ignores another pointer', () => {
    expect(stepGesture(active(), move(40, 40, 0, 2))).toEqual({ state: active(), effect: 'ignore' })
    expect(stepGesture(active(), { type: 'up', pointerId: 2 })).toEqual({ state: active(), effect: 'ignore' })
    expect(stepGesture(active(), { type: 'end', reason: 'lostcapture', pointerId: 2 })).toEqual({ state: active(), effect: 'ignore' })
  })

  it('Esc, pointercancel, window blur, lost capture, the target going and a new press cancel an active drag', () => {
    for (const reason of ['escape', 'pointercancel', 'blur', 'lostcapture', 'target-gone', 'press'] as const) {
      expect(stepGesture(active(), { type: 'end', reason, pointerId: 1 }), reason).toEqual({ state: null, effect: 'cancel' })
      expect(stepGesture(pending(), { type: 'end', reason }), reason).toEqual({ state: null, effect: 'abandon' })
    }
  })

  it('leaving the frame ends a pending press, but not a captured drag', () => {
    expect(stepGesture(pending(), { type: 'end', reason: 'leave' })).toEqual({ state: null, effect: 'abandon' })
    expect(stepGesture(active(), { type: 'end', reason: 'leave' })).toEqual({ state: active(), effect: 'ignore' })
  })
})

const root: ModelNode = {
  id: 'n_page',
  type: 'Page',
  children: [
    { id: 'n_row', type: 'Row', children: [{ id: 'n_a', type: 'Text' }, { id: 'n_b', type: 'Text' }, { id: 'n_c', type: 'Text' }] },
    { id: 'n_lock', type: 'Container', locked: true, children: [{ id: 'n_in', type: 'Text' }] }
  ]
}

describe('gestureTargetGone', () => {
  it('is gone when the node is no longer the selection, no longer rendered, or the page changed', () => {
    const g = { nodeId: 'n_a', pageId: 'p1' }
    expect(gestureTargetGone(g, { pageId: 'p1', root, selectedIds: ['n_a'] })).toBe(false)
    expect(gestureTargetGone(g, { pageId: 'p1', root, selectedIds: ['n_b'] })).toBe(true)
    expect(gestureTargetGone(g, { pageId: 'p1', root, selectedIds: ['n_a', 'n_b'] })).toBe(true)
    expect(gestureTargetGone(g, { pageId: 'p1', root: { ...root, children: [] }, selectedIds: ['n_a'] })).toBe(true)
    expect(gestureTargetGone(g, { pageId: 'p2', root, selectedIds: ['n_a'] })).toBe(true)
    expect(gestureTargetGone(g, { pageId: 'p1', root: null, selectedIds: ['n_a'] })).toBe(true)
  })
})

describe('pastThreshold', () => {
  it('starts a drag only beyond 4px of travel', () => {
    expect(REORDER_THRESHOLD).toBe(4)
    expect(pastThreshold({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(false)
    expect(pastThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false)
    expect(pastThreshold({ x: 0, y: 0 }, { x: 4, y: 1 })).toBe(true)
  })
})

describe('canDragNode', () => {
  it('drags an unlocked node that is not the root', () => {
    expect(canDragNode(root, 'n_a')).toBe(true)
    expect(canDragNode(root, 'n_page')).toBe(false)
    expect(canDragNode(root, 'missing')).toBe(false)
    expect(canDragNode(root, 'n_lock')).toBe(false)
    // Inside a lock too.
    expect(canDragNode(root, 'n_in')).toBe(false)
  })
})

describe('isNoopMove', () => {
  it('is a no-op when the node would land where it is', () => {
    expect(isNoopMove(root, 'n_a', { parentId: 'n_row', index: 0 })).toBe(true)
    expect(isNoopMove(root, 'n_a', { parentId: 'n_row', index: 1 })).toBe(true)
    expect(isNoopMove(root, 'n_a', { parentId: 'n_row', index: 2 })).toBe(false)
    expect(isNoopMove(root, 'n_b', { parentId: 'n_row', index: 0 })).toBe(false)
    expect(isNoopMove(root, 'n_b', { parentId: 'n_page', index: 0 })).toBe(false)
  })
})
