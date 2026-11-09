import { describe, expect, it } from 'vitest'
import { boundsOf, clampZoom, fitView, layoutFrames, stepZoom, wheelPixels, wheelZoom, zoomAround, zoomShortcut } from '#shared/editor/viewport'

describe('clampZoom', () => {
  it('keeps the zoom within 10%–400%', () => {
    expect(clampZoom(0.05)).toBe(0.1)
    expect(clampZoom(0.5)).toBe(0.5)
    expect(clampZoom(9)).toBe(4)
  })
})

describe('zoomAround', () => {
  it('keeps the content point under the pointer where it was', () => {
    // At 100% with the content origin at (100, 50), the pointer at (300, 250) is over content (200, 200).
    const next = zoomAround({ x: 100, y: 50, zoom: 1 }, 2, { x: 300, y: 250 })
    expect(next).toEqual({ x: -100, y: -150, zoom: 2 })
    // Content (200, 200) at 200% from origin (-100, -150) is back on screen (300, 250).
    expect(next.x + 200 * next.zoom).toBe(300)
  })

  it('clamps the zoom and still keeps the pointer fixed', () => {
    const next = zoomAround({ x: 0, y: 0, zoom: 1 }, 10, { x: 100, y: 100 })
    expect(next).toEqual({ x: -300, y: -300, zoom: 4 })
  })
})

describe('stepZoom', () => {
  it('moves to the next preset level in or out', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
    // Between levels, a step lands on the nearest level in that direction.
    expect(stepZoom(0.3, 1)).toBe(0.5)
    expect(stepZoom(0.3, -1)).toBe(0.25)
  })

  it('stops at the zoom limits', () => {
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(0.1, -1)).toBe(0.1)
  })
})

describe('wheelZoom', () => {
  it('zooms in on a wheel up and out on a wheel down, proportionally', () => {
    expect(wheelZoom(1, -100)).toBeCloseTo(2)
    expect(wheelZoom(1, 100)).toBeCloseTo(0.5)
    expect(wheelZoom(1, 0)).toBe(1)
  })

  it('is clamped', () => {
    expect(wheelZoom(4, -100)).toBe(4)
  })
})

describe('wheelPixels', () => {
  it('turns line and page wheel deltas into pixels', () => {
    expect(wheelPixels(3, 0)).toBe(3)
    expect(wheelPixels(3, 1)).toBe(48)
    expect(wheelPixels(1, 2)).toBe(800)
  })
})

describe('zoomShortcut', () => {
  const key = (code: string, key: string, mods: { meta?: boolean, shift?: boolean } = {}) => ({ code, key, meta: false, shift: false, ...mods })

  it('maps Shift+1 to fit and Shift+0 to 100%, whatever the layout prints', () => {
    expect(zoomShortcut(key('Digit1', '!', { shift: true }))).toBe('fit')
    expect(zoomShortcut(key('Digit0', ')', { shift: true }))).toBe('reset')
    expect(zoomShortcut(key('Digit1', '1'))).toBeNull()
  })

  it('maps Cmd/Ctrl + plus and minus to stepping in and out', () => {
    expect(zoomShortcut(key('Equal', '=', { meta: true }))).toBe('in')
    expect(zoomShortcut(key('Equal', '+', { meta: true, shift: true }))).toBe('in')
    expect(zoomShortcut(key('NumpadAdd', '+', { meta: true }))).toBe('in')
    expect(zoomShortcut(key('Minus', '-', { meta: true }))).toBe('out')
    expect(zoomShortcut(key('Minus', '-'))).toBeNull()
  })

  it('leaves other keys alone', () => {
    expect(zoomShortcut(key('KeyZ', 'z', { meta: true }))).toBeNull()
    expect(zoomShortcut(key('Digit1', '!', { shift: true, meta: true }))).toBeNull()
  })
})

describe('layoutFrames', () => {
  it('places frames left to right, top-aligned, a gap apart', () => {
    const frames = layoutFrames([{ width: 390, height: 800 }, { width: 768, height: 1200 }, { width: 1280, height: 900 }], 100)
    expect(frames).toEqual([
      { x: 0, y: 0, width: 390, height: 800 },
      { x: 490, y: 0, width: 768, height: 1200 },
      { x: 1358, y: 0, width: 1280, height: 900 }
    ])
    expect(boundsOf(frames)).toEqual({ x: 0, y: 0, width: 2638, height: 1200 })
  })

  it('has empty bounds without frames', () => {
    expect(boundsOf([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('fitView', () => {
  it('scales the content to fit inside the padded stage and centres it', () => {
    // 2000×1000 content in a 1100×800 stage with 50 px padding: the width limits, 1000/2000 = 50%.
    expect(fitView({ x: 0, y: 0, width: 2000, height: 1000 }, { width: 1100, height: 800 }, 50)).toEqual({ x: 50, y: 150, zoom: 0.5 })
  })

  it('fits by height when the content is tall', () => {
    // 500×4000 in 1100×800: the height limits, 700/4000 = 17.5%; 500 px wide shows as 87.5.
    expect(fitView({ x: 0, y: 0, width: 500, height: 4000 }, { width: 1100, height: 800 }, 50)).toEqual({ x: 506.25, y: 50, zoom: 0.175 })
  })

  it('accounts for the content origin and clamps the zoom', () => {
    // 10×10 at (100, 100) would fit at 2000%; at 400% it shows 40×40, centred at 80, so the origin sits at 80 - 400.
    expect(fitView({ x: 100, y: 100, width: 10, height: 10 }, { width: 200, height: 200 }, 0)).toEqual({ x: -320, y: -320, zoom: 4 })
  })
})
