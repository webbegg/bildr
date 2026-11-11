import { describe, expect, it } from 'vitest'
import type { GestureState } from '#shared/editor/gesture'
import { gestureTargetGone, startGesture, stepGesture } from '#shared/editor/gesture'

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

describe('gestureTargetGone', () => {
  const root = { id: 'root', type: 'Page', props: {}, style: {}, children: [{ id: 'a', type: 'Text', props: {}, style: {}, children: [] }] }

  it('is gone when the node is no longer the selection, no longer rendered, or the page changed', () => {
    const g = { nodeId: 'a', pageId: 'p1' }
    expect(gestureTargetGone(g, { pageId: 'p1', root, selectedIds: ['a'] })).toBe(false)
    expect(gestureTargetGone(g, { pageId: 'p1', root, selectedIds: ['b'] })).toBe(true)
    expect(gestureTargetGone(g, { pageId: 'p1', root, selectedIds: ['a', 'b'] })).toBe(true)
    expect(gestureTargetGone(g, { pageId: 'p1', root: { ...root, children: [] }, selectedIds: ['a'] })).toBe(true)
    expect(gestureTargetGone(g, { pageId: 'p2', root, selectedIds: ['a'] })).toBe(true)
    expect(gestureTargetGone(g, { pageId: 'p1', root: null, selectedIds: ['a'] })).toBe(true)
  })
})
