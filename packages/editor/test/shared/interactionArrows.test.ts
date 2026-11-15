import { describe, expect, it } from 'vitest'
import { ARROW_BOW, ARROW_LANE, ARROW_LOOP, ARROW_TOP, arrowGeometry, boardArrows } from '../../src/shared/interactionArrows.ts'
import { boardFrames } from '../../src/shared/variantBoard.ts'

const left = { x: 0, y: 0, width: 100, height: 400 }
const right = { x: 180, y: 0, width: 100, height: 400 }
const below = { x: 0, y: 480, width: 100, height: 200 }

describe('arrowGeometry', () => {
  it('goes from the right edge to the next frame\'s left edge near their tops, bowing up', () => {
    const arrow = arrowGeometry(left, right)
    const y = ARROW_TOP
    expect(arrow.start).toEqual({ x: 100, y })
    expect(arrow.end).toEqual({ x: 180, y })
    expect(arrow.d).toBe(`M 100 ${y} C 140 ${y - ARROW_BOW} 140 ${y - ARROW_BOW} 180 ${y}`)
    expect(arrow.mid).toEqual({ x: 140, y: y - ARROW_BOW * 0.75 })
  })

  it('goes back from the left edge to the previous frame\'s right edge, lower and bowing down, so a pair of arrows does not overlap', () => {
    const arrow = arrowGeometry(right, left)
    const y = ARROW_TOP + ARROW_LANE / 2
    expect(arrow.start).toEqual({ x: 180, y })
    expect(arrow.end).toEqual({ x: 100, y })
    expect(arrow.d).toBe(`M 180 ${y} C 140 ${y + ARROW_BOW} 140 ${y + ARROW_BOW} 100 ${y}`)
  })

  it('moves further arrows between the same frames down one lane each', () => {
    expect(arrowGeometry(left, right, { lane: 2 }).start).toEqual({ x: 100, y: ARROW_TOP + 2 * ARROW_LANE })
  })

  it('keeps the ends within the top half of short frames', () => {
    const short = { x: 180, y: 0, width: 100, height: 40 }
    expect(arrowGeometry(left, short).end).toEqual({ x: 180, y: 20 })
  })

  it('loops out of the right edge between frames of one column', () => {
    const arrow = arrowGeometry(below, left)
    expect(arrow.start).toEqual({ x: 100, y: 480 + ARROW_TOP })
    expect(arrow.end).toEqual({ x: 100, y: ARROW_TOP })
    expect(arrow.d).toBe(`M 100 ${480 + ARROW_TOP} C ${100 + ARROW_LOOP} ${480 + ARROW_TOP} ${100 + ARROW_LOOP} ${ARROW_TOP} 100 ${ARROW_TOP}`)
  })

  it('ends in an arrowhead whose tip is the end, pointing along the curve', () => {
    const arrow = arrowGeometry(below, left, { head: 10 })
    // The loop comes back leftwards into the frame: the wings are to the right of the tip.
    const [tip, wing1, wing2] = arrow.head.split(' ').map(p => p.split(',').map(Number))
    expect(tip).toEqual([100, ARROW_TOP])
    expect(wing1![0]).toBeCloseTo(110)
    expect(wing2![0]).toBeCloseTo(110)
    expect(Math.abs(wing1![1]! - wing2![1]!)).toBeCloseTo(10)
  })
})

describe('boardArrows', () => {
  const frames = boardFrames([{ id: 'var_on', name: 'On' }, { id: 'var_ph', name: 'Primary · Hover', state: { of: '', kind: 'hover' } }])

  // The model's interactions have no ids: an arrow is named by its `<variant>:<index>` key, and goes where its step does.
  const go = (on: 'click' | 'mouseenter' | 'mouseleave' | 'appear', to: string, delay?: number) => ({ on, do: [{ kind: 'setVariant' as const, to, ...(delay ? { delay } : {}) }] as [{ kind: 'setVariant', to: string, delay?: number }] })
  const variant = (id: string, interactions: ReturnType<typeof go>[]) => ({ id, name: id, overrides: {}, interactions })

  it('lists every interaction as an arrow between frame keys, the primary\'s first, with a lane per repeated pair', () => {
    const def = {
      interactions: [go('click', 'var_on'), go('mouseenter', 'var_on')],
      variants: [
        variant('var_on', [go('click', '')]),
        variant('var_ph', [go('appear', 'var_on', 1)])
      ]
    }
    expect(boardArrows(def, frames)).toEqual([
      { id: ':0', from: 'primary', to: 'var_on', on: 'click', lane: 0 },
      { id: ':1', from: 'primary', to: 'var_on', on: 'mouseenter', lane: 1 },
      { id: 'var_on:0', from: 'var_on', to: 'primary', on: 'click', lane: 0 },
      { id: 'var_ph:0', from: 'var_ph', to: 'var_on', on: 'appear', lane: 0 }
    ])
  })

  it('skips interactions whose frames are not on the board', () => {
    const def = { interactions: [go('click', 'var_gone')], variants: [] }
    expect(boardArrows(def, frames)).toEqual([])
  })
})
