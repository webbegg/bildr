import { describe, expect, it } from 'vitest'
import { ADD_TILE_MAX, boardDropTarget, boardFrameKey, boardFrames, boardLayout, boardShown, boardVariantAt, STATE_TILE_HEIGHT } from '../../src/shared/variantBoard.ts'

const hover = { id: 'var_hover', name: 'Hover' }
const pressed = { id: 'var_pressed', name: 'Pressed' }

// States: Primary · Pressed is listed before Primary · Hover, and On has a hover state.
const on = { id: 'var_on', name: 'On' }
const primaryPressed = { id: 'var_pp', name: 'Primary · Pressed', state: { of: '', kind: 'pressed' as const } }
const primaryHover = { id: 'var_ph', name: 'Primary · Hover', state: { of: '', kind: 'hover' as const } }
const onHover = { id: 'var_oh', name: 'On · Hover', state: { of: 'var_on', kind: 'hover' as const } }
const withStates = [primaryPressed, on, primaryHover, onHover]

describe('boardFrames', () => {
  it('puts the primary first, then each variant in order, labelled by name', () => {
    expect(boardFrames([hover, pressed])).toEqual([
      { key: 'primary', variantId: null, label: 'Primary', primary: true },
      { key: 'var_hover', variantId: 'var_hover', label: 'Hover', primary: false },
      { key: 'var_pressed', variantId: 'var_pressed', label: 'Pressed', primary: false }
    ])
  })

  it('is the primary alone without variants', () => {
    expect(boardFrames([])).toEqual([{ key: 'primary', variantId: null, label: 'Primary', primary: true }])
  })

  it('puts each base\'s states right after it, hover before pressed, marked with their base frame and kind', () => {
    expect(boardFrames(withStates)).toEqual([
      { key: 'primary', variantId: null, label: 'Primary', primary: true },
      { key: 'var_ph', variantId: 'var_ph', label: 'Primary · Hover', primary: false, state: { base: 'primary', kind: 'hover' } },
      { key: 'var_pp', variantId: 'var_pp', label: 'Primary · Pressed', primary: false, state: { base: 'primary', kind: 'pressed' } },
      { key: 'var_on', variantId: 'var_on', label: 'On', primary: false },
      { key: 'var_oh', variantId: 'var_oh', label: 'On · Hover', primary: false, state: { base: 'var_on', kind: 'hover' } }
    ])
  })

  it('shows a state whose base is gone as a base of its own', () => {
    expect(boardFrames([{ id: 'var_x', name: 'X', state: { of: 'var_gone', kind: 'hover' } }])).toEqual([
      { key: 'primary', variantId: null, label: 'Primary', primary: true },
      { key: 'var_x', variantId: 'var_x', label: 'X', primary: false }
    ])
  })
})

describe('boardFrameKey and boardVariantAt', () => {
  it('keys the primary "primary" and a variant by its id', () => {
    expect(boardFrameKey(null)).toBe('primary')
    expect(boardFrameKey('var_hover')).toBe('var_hover')
  })

  it('finds the variant a frame key shows; undefined for an unknown key', () => {
    const frames = boardFrames([hover])
    expect(boardVariantAt(frames, 'primary')).toBeNull()
    expect(boardVariantAt(frames, 'var_hover')).toBe('var_hover')
    expect(boardVariantAt(frames, 'var_gone')).toBeUndefined()
  })
})

describe('boardShown', () => {
  it('is on by default with 2 or more variants, counting the primary', () => {
    expect(boardShown(undefined, 0)).toBe(false)
    expect(boardShown(undefined, 1)).toBe(true)
    expect(boardShown(undefined, 3)).toBe(true)
  })

  it('follows the remembered choice over the default', () => {
    expect(boardShown(false, 2)).toBe(false)
    expect(boardShown(true, 0)).toBe(true)
  })
})

describe('boardLayout', () => {
  const plain = boardFrames([hover])

  it('places the bases left to right, top-aligned, gap apart, at the breakpoint width', () => {
    const { frames } = boardLayout(plain, [800, 900], 390, 80)
    expect(frames).toEqual([
      { x: 0, y: 0, width: 390, height: 800 },
      { x: 470, y: 0, width: 390, height: 900 }
    ])
  })

  it('ends with the "+ Variant" tile one gap after the last column, no wider or taller than the cap', () => {
    const { add } = boardLayout(plain, [800, 900], 390, 80)
    expect(add).toEqual({ x: 940, y: 0, width: ADD_TILE_MAX.width, height: ADD_TILE_MAX.height })
  })

  it('keeps the tile within a narrow, short frame', () => {
    const { add } = boardLayout(boardFrames([]), [120], 100, 80)
    expect(add).toEqual({ x: 180, y: 0, width: 100, height: 120 })
  })

  it('stacks each base\'s states under it in its column, gap apart', () => {
    const frames = boardFrames(withStates)
    // primary, Primary · Hover, Primary · Pressed, On, On · Hover
    const placed = boardLayout(frames, [300, 200, 250, 400, 100], 390, 80)
    expect(placed.frames).toEqual([
      { x: 0, y: 0, width: 390, height: 300 },
      { x: 0, y: 380, width: 390, height: 200 },
      { x: 0, y: 660, width: 390, height: 250 },
      { x: 470, y: 0, width: 390, height: 400 },
      { x: 470, y: 480, width: 390, height: 100 }
    ])
    expect(placed.add).toEqual({ x: 940, y: 0, width: ADD_TILE_MAX.width, height: ADD_TILE_MAX.height })
  })

  it('joins a base and its states with a vertical line through the column\'s centre, one segment per gap', () => {
    const placed = boardLayout(boardFrames(withStates), [300, 200, 250, 400, 100], 390, 80)
    expect(placed.links).toEqual([
      { base: 'primary', x: 195, y1: 300, y2: 380 },
      { base: 'primary', x: 195, y1: 580, y2: 660 },
      { base: 'var_on', x: 665, y1: 400, y2: 480 }
    ])
  })

  it('puts a "+ Hover / Pressed" tile, as wide as the column, under each column that lacks a state kind, with the kinds it has', () => {
    const placed = boardLayout(boardFrames(withStates), [300, 200, 250, 400, 100], 390, 80)
    // Primary has both, so no tile; On has a hover.
    expect(placed.stateAdds).toEqual([
      { base: 'var_on', variantId: 'var_on', taken: ['hover'], rect: { x: 470, y: 660, width: 390, height: STATE_TILE_HEIGHT } }
    ])
    const bare = boardLayout(plain, [800, 900], 390, 80)
    expect(bare.stateAdds).toEqual([
      { base: 'primary', variantId: null, taken: [], rect: { x: 0, y: 880, width: 390, height: STATE_TILE_HEIGHT } },
      { base: 'var_hover', variantId: 'var_hover', taken: [], rect: { x: 470, y: 980, width: 390, height: STATE_TILE_HEIGHT } }
    ])
    expect(bare.links).toEqual([])
  })
})

describe('boardDropTarget', () => {
  const frames = boardFrames(withStates)
  const rects = boardLayout(frames, [300, 200, 250, 400, 100], 390, 80).frames

  it('is the base frame under the point, other than the source', () => {
    expect(boardDropTarget(frames, rects, { x: 500, y: 100 }, 'primary')?.key).toBe('var_on')
    expect(boardDropTarget(frames, rects, { x: 100, y: 100 }, 'var_on')?.key).toBe('primary')
  })

  it('is nothing over the source, a state, or empty canvas', () => {
    expect(boardDropTarget(frames, rects, { x: 100, y: 100 }, 'primary')).toBeUndefined()
    expect(boardDropTarget(frames, rects, { x: 100, y: 400 }, 'var_on')).toBeUndefined()
    expect(boardDropTarget(frames, rects, { x: 430, y: 100 }, 'primary')).toBeUndefined()
  })
})
