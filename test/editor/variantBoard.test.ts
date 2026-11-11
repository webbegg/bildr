import { describe, expect, it } from 'vitest'
import { ADD_TILE_MAX, boardFrameKey, boardFrames, boardLayout, boardShown, boardVariantAt } from '#shared/editor/variantBoard'

const hover = { id: 'var_hover', name: 'Hover' }
const pressed = { id: 'var_pressed', name: 'Pressed' }

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
  it('places the frames left to right, top-aligned, gap apart, at the breakpoint width', () => {
    const { frames } = boardLayout([800, 900], 390, 80)
    expect(frames).toEqual([
      { x: 0, y: 0, width: 390, height: 800 },
      { x: 470, y: 0, width: 390, height: 900 }
    ])
  })

  it('ends with the "+ Variant" tile one gap after the last frame, no wider or taller than the cap', () => {
    const { add } = boardLayout([800, 900], 390, 80)
    expect(add).toEqual({ x: 940, y: 0, width: ADD_TILE_MAX.width, height: ADD_TILE_MAX.height })
  })

  it('keeps the tile within a narrow, short frame', () => {
    const { add } = boardLayout([120], 100, 80)
    expect(add).toEqual({ x: 180, y: 0, width: 100, height: 120 })
  })
})
