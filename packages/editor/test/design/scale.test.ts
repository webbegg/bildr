import { describe, expect, it } from 'vitest'
import { fitScale, zoomLabel } from '../../src/design/scale.ts'

/** Framing a device in the stage: the canvas lays out at the device width and is scaled down to fit. */

describe('fitScale', () => {
  it('is 1 while the device fits the stage minus its padding, or the stage is not measured', () => {
    expect(fitScale(768, 1440)).toBe(1)
    expect(fitScale(1280, 1328)).toBe(1)
    expect(fitScale(1280, 0)).toBe(1)
  })

  it('scales a wider device down to the room the stage leaves (never below the zoom floor)', () => {
    expect(fitScale(1280, 1000)).toBeCloseTo(0.74375)
    expect(fitScale(1280, 800)).toBeCloseTo(752 / 1280)
    expect(fitScale(1280, 40)).toBe(0.1)
  })
})

describe('zoomLabel', () => {
  it('labels the zoom as a percentage', () => {
    expect(zoomLabel(0.74375)).toBe('74%')
    expect(zoomLabel(1)).toBe('100%')
  })
})
