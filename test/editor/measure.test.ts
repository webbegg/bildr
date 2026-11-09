import { describe, expect, it } from 'vitest'
import { measure } from '#shared/editor/measure'

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe('measure', () => {
  it('measures the horizontal gap to a box on the right, across their shared height', () => {
    expect(measure(rect(0, 0, 100, 40), rect(124, 10, 50, 40))).toEqual([
      { x1: 100, y1: 25, x2: 124, y2: 25, length: 24 }
    ])
  })

  it('measures the vertical gap to a box above', () => {
    expect(measure(rect(0, 100, 100, 40), rect(20, 0, 40, 60))).toEqual([
      { x1: 40, y1: 60, x2: 40, y2: 100, length: 40 }
    ])
  })

  it('measures both gaps to a diagonal box, from the selection centre', () => {
    expect(measure(rect(0, 0, 100, 40), rect(150, 100, 50, 50))).toEqual([
      { x1: 100, y1: 20, x2: 150, y2: 20, length: 50 },
      { x1: 50, y1: 40, x2: 50, y2: 100, length: 60 }
    ])
  })

  it('measures the inner distances when one box contains the other, skipping zero ones', () => {
    const outer = rect(0, 0, 200, 100)
    const inner = rect(16, 0, 100, 60)
    const lines = [
      { x1: 66, y1: 60, x2: 66, y2: 100, length: 40 },
      { x1: 0, y1: 30, x2: 16, y2: 30, length: 16 },
      { x1: 116, y1: 30, x2: 200, y2: 30, length: 84 }
    ]
    expect(measure(inner, outer)).toEqual(lines)
    expect(measure(outer, inner)).toEqual(lines)
  })

  it('draws nothing for the same box', () => {
    expect(measure(rect(0, 0, 10, 10), rect(0, 0, 10, 10))).toEqual([])
  })
})
