import { describe, expect, it } from 'vitest'
import { labelPlacement } from '#shared/editor/labelPlacement'

describe('labelPlacement', () => {
  it('puts the label above the box when it fits below the frame top', () => {
    expect(labelPlacement(20, 20)).toBe('above')
    expect(labelPlacement(240, 20)).toBe('above')
  })

  it('puts it inside the box when the box starts closer to the frame top than the label is tall', () => {
    expect(labelPlacement(0, 20)).toBe('inside')
    expect(labelPlacement(19.5, 20)).toBe('inside')
    // Zoomed out to 50%, the label is 40 canvas px tall.
    expect(labelPlacement(30, 40)).toBe('inside')
    expect(labelPlacement(-8, 20)).toBe('inside')
  })
})
