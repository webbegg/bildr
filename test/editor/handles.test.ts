import { describe, expect, it } from 'vitest'
import { SHIFT_STOPS } from '#shared/editor/scale'
import { changedPatch, gapRects, handleCursor, handlePoint, HANDLES, hitHandle, hitPoint, hitRadius, nearestStop, paddingDragKey, paddingRects, resizePatch, scaleLabel, spacingDragPatch, spacingHandles } from '#shared/editor/handles'

const rect = { x: 100, y: 50, width: 200, height: 80 }

describe('resize handles', () => {
  it('has 8 handles: corners and edge midpoints', () => {
    expect(HANDLES).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
    expect(handlePoint(rect, 'nw')).toEqual({ x: 100, y: 50 })
    expect(handlePoint(rect, 'n')).toEqual({ x: 200, y: 50 })
    expect(handlePoint(rect, 'e')).toEqual({ x: 300, y: 90 })
    expect(handlePoint(rect, 'se')).toEqual({ x: 300, y: 130 })
    expect(handlePoint(rect, 'w')).toEqual({ x: 100, y: 90 })
  })

  it('hit-tests the nearest handle within the radius, else none', () => {
    expect(hitHandle(rect, { x: 302, y: 128 }, 5)).toBe('se')
    expect(hitHandle(rect, { x: 198, y: 52 }, 5)).toBe('n')
    expect(hitHandle(rect, { x: 200, y: 90 }, 5)).toBeNull()
    expect(hitHandle(rect, { x: 310, y: 130 }, 5)).toBeNull()
  })

  it('inside a box that is small on screen, the hit radius shrinks so its middle drags instead', () => {
    const small = { x: 0, y: 0, width: 80, height: 24 }
    expect(hitRadius(small, { x: 40, y: 12 }, 22)).toBe(6)
    expect(hitHandle(small, { x: 40, y: 12 }, hitRadius(small, { x: 40, y: 12 }, 22))).toBeNull()
    expect(hitRadius(small, { x: 40, y: -10 }, 22)).toBe(22)
    expect(hitRadius(rect, { x: 200, y: 90 }, 5)).toBe(5)
  })

  it('gives each handle its resize cursor', () => {
    expect(handleCursor('nw')).toBe('nwse-resize')
    expect(handleCursor('se')).toBe('nwse-resize')
    expect(handleCursor('ne')).toBe('nesw-resize')
    expect(handleCursor('n')).toBe('ns-resize')
    expect(handleCursor('w')).toBe('ew-resize')
  })
})

describe('snapping to the scale', () => {
  it('picks the stop nearest a px size (4px base: w-64 is 256px)', () => {
    expect(nearestStop('w', 250, 4)).toBe('64')
    expect(nearestStop('w', 270, 4)).toBe('64')
    expect(nearestStop('w', 280, 4)).toBe('72')
    expect(nearestStop('md:h', 1, 4)).toBe('0')
    expect(nearestStop('w', 9999, 4)).toBe('96')
    expect(nearestStop('pt', 15, 4)).toBe('4')
    expect(nearestStop('gap', 7.6, 4)).toBe('2')
  })

  it('with Shift, moves by 4 stops from where the drag started', () => {
    // From w-64 (index 11 of 0..96): one stop up is 72, Shift snaps to 4 stops (96, clamped).
    expect(nearestStop('w', 290, 4, { shift: true, startPx: 256 })).toBe('64')
    expect(nearestStop('w', 400, 4, { shift: true, startPx: 256 })).toBe('96')
    // From pt-4 (16px), the nearest stop to 30px is 8 (3 stops up), which Shift rounds to 4 stops: 10.
    expect(nearestStop('pt', 30, 4, { shift: true, startPx: 16 })).toBe('10')
    expect(SHIFT_STOPS).toBe(4)
  })

  it('labels a value with its class and px size', () => {
    expect(scaleLabel('w', '64', 'default')).toBe('w-64 · 256px')
    expect(scaleLabel('md:pt', '4', 'default')).toBe('pt-4 · 16px')
    expect(scaleLabel('gap', '6', 'compact')).toBe('gap-6 · 19.2px')
  })
})

describe('resizePatch', () => {
  const drag = { handle: 'e' as const, width: 256, height: 64, breakpoint: undefined, basePx: 4 }

  it('writes the nearest W step under the pointer, at the breakpoint', () => {
    expect(resizePatch(drag, { dx: 30, dy: 0 }, false)).toEqual({ w: '72' })
    expect(resizePatch({ ...drag, breakpoint: 'md' }, { dx: 30, dy: 0 }, false)).toEqual({ 'md:w': '72' })
  })

  it('grows from a left or top handle as the pointer moves out', () => {
    expect(resizePatch({ ...drag, handle: 'w' }, { dx: -30, dy: 0 }, false)).toEqual({ w: '72' })
    expect(resizePatch({ ...drag, handle: 'n' }, { dx: 0, dy: -40 }, false)).toEqual({ h: '24' })
  })

  it('a corner writes both W and H once each axis has moved; a still axis is left alone', () => {
    expect(resizePatch({ ...drag, handle: 'se' }, { dx: 30, dy: 40 }, false)).toEqual({ w: '72', h: '24' })
    expect(resizePatch({ ...drag, handle: 'se' }, { dx: 30, dy: 1 }, false)).toEqual({ w: '72' })
    expect(resizePatch({ ...drag, handle: 'e' }, { dx: 1, dy: 50 }, false)).toEqual({})
  })

  it('switches a Fit or Fill size to a fixed token (it always writes a number)', () => {
    expect(resizePatch({ ...drag, width: 123 }, { dx: 5, dy: 0 }, false)).toEqual({ w: '32' })
  })

  it('Shift moves by 4 stops', () => {
    expect(resizePatch({ ...drag, width: 128 }, { dx: 40, dy: 0 }, true)).toEqual({ w: '32' })
    expect(resizePatch({ ...drag, width: 128 }, { dx: 90, dy: 0 }, true)).toEqual({ w: '64' })
  })
})

describe('changedPatch', () => {
  it('drops the keys the style already has', () => {
    expect(changedPatch({ w: '64', h: 'fit' }, { w: '64', h: '16' })).toEqual({ h: '16' })
    expect(changedPatch({ w: '64' }, { w: '64' })).toEqual({})
  })
})

describe('padding and gap overlays', () => {
  const padding = { top: 16, right: 8, bottom: 16, left: 8 }

  it('paints the four padding areas inside the box', () => {
    expect(paddingRects(rect, padding)).toEqual([
      { side: 'top', x: 100, y: 50, width: 200, height: 16 },
      { side: 'right', x: 292, y: 66, width: 8, height: 48 },
      { side: 'bottom', x: 100, y: 114, width: 200, height: 16 },
      { side: 'left', x: 100, y: 66, width: 8, height: 48 }
    ])
  })

  it('paints the gaps between children on the same line of the main axis', () => {
    const content = { x: 108, y: 66, width: 184, height: 48 }
    const children = [{ x: 108, y: 66, width: 40, height: 20 }, { x: 160, y: 66, width: 40, height: 30 }, { x: 212, y: 66, width: 40, height: 20 }]
    expect(gapRects(content, children, 'row')).toEqual([
      { x: 148, y: 66, width: 12, height: 48 },
      { x: 200, y: 66, width: 12, height: 48 }
    ])
    const column = [{ x: 108, y: 66, width: 100, height: 10 }, { x: 108, y: 84, width: 100, height: 10 }]
    expect(gapRects(content, column, 'col')).toEqual([{ x: 108, y: 76, width: 184, height: 8 }])
  })

  it('keeps a zero gap (a handle to drag from) and skips a wrap to the next line', () => {
    const content = { x: 0, y: 0, width: 100, height: 100 }
    expect(gapRects(content, [{ x: 0, y: 0, width: 50, height: 10 }, { x: 50, y: 0, width: 50, height: 10 }], 'row')).toEqual([{ x: 50, y: 0, width: 0, height: 100 }])
    expect(gapRects(content, [{ x: 0, y: 0, width: 80, height: 10 }, { x: 0, y: 20, width: 80, height: 10 }], 'row')).toEqual([])
  })

  it('puts a handle in each padding area (at least `inset` in) and in each gap', () => {
    const gaps = [{ x: 148, y: 66, width: 12, height: 48 }]
    const handles = spacingHandles(rect, { top: 16, right: 0, bottom: 16, left: 8 }, gaps, 6)
    expect(handles).toEqual([
      { kind: 'padding', side: 'top', x: 200, y: 58 },
      { kind: 'padding', side: 'right', x: 294, y: 90 },
      { kind: 'padding', side: 'bottom', x: 200, y: 122 },
      { kind: 'padding', side: 'left', x: 106, y: 90 },
      { kind: 'gap', index: 0, x: 154, y: 90 }
    ])
    expect(hitPoint(handles, { x: 155, y: 91 }, 4)).toEqual(handles[4])
    expect(hitPoint(handles, { x: 180, y: 91 }, 4)).toBeNull()
  })
})

describe('spacing drags', () => {
  it('writes the key the side uses at the breakpoint: p, py or pt', () => {
    expect(paddingDragKey({ p: '4' }, 'top', undefined)).toBe('p')
    expect(paddingDragKey({ py: '4', px: '2' }, 'top', undefined)).toBe('py')
    expect(paddingDragKey({ p: '4', pt: '2' }, 'top', undefined)).toBe('pt')
    expect(paddingDragKey({}, 'left', undefined)).toBe('pl')
    // Inherited from a smaller breakpoint: only this side, at the edited one.
    expect(paddingDragKey({ p: '4' }, 'top', 'md')).toBe('pt')
    expect(paddingDragKey({ 'p': '4', 'md:px': '6' }, 'right', 'md')).toBe('px')
  })

  it('snaps a padding drag to the spacing scale, growing inward', () => {
    const opts = { breakpoint: undefined, basePx: 4, shift: false }
    expect(spacingDragPatch({ p: '4' }, { kind: 'padding', side: 'top' }, 16, { dx: 0, dy: 15 }, opts)).toEqual({ p: '8' })
    expect(spacingDragPatch({ p: '4' }, { kind: 'padding', side: 'bottom' }, 16, { dx: 0, dy: 14 }, opts)).toEqual({ p: '0.5' })
    expect(spacingDragPatch({}, { kind: 'padding', side: 'right' }, 0, { dx: -24, dy: 0 }, { ...opts, breakpoint: 'lg' })).toEqual({ 'lg:pr': '6' })
  })

  it('snaps a gap drag along the main axis', () => {
    const opts = { breakpoint: 'md' as const, basePx: 4, shift: false }
    expect(spacingDragPatch({ gap: '2' }, { kind: 'gap', axis: 'row' }, 8, { dx: 8, dy: 100 }, opts)).toEqual({ 'md:gap': '4' })
    expect(spacingDragPatch({ gap: '2' }, { kind: 'gap', axis: 'col' }, 8, { dx: 100, dy: -8 }, opts)).toEqual({ 'md:gap': '0' })
  })
})
