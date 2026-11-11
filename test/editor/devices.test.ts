import { describe, expect, it } from 'vitest'
import { DEVICE_ORDER, deviceForKey, deviceHint, deviceShortcut, revealFrame } from '#shared/editor/devices'
import { DEVICES } from '#shared/editor/styleFields'

describe('DEVICE_ORDER', () => {
  it('lists the devices as the frames sit, Desktop to the Primary Mobile', () => {
    expect(DEVICE_ORDER.map(d => d.label)).toEqual(['Desktop', 'Tablet', 'Large phone', 'Mobile'])
  })
})

/** The frames shown by default: Large phone starts hidden. */
const SHOWN = DEVICE_ORDER.filter(d => d.id !== 'large-phone')

describe('deviceForKey', () => {
  const key = (code: string, mods: Partial<{ alt: boolean, meta: boolean, shift: boolean }> = {}) =>
    deviceForKey({ code, alt: false, meta: false, shift: false, ...mods }, SHOWN)

  it('maps Alt/Option + 1, 2, 3 to Desktop, Tablet, Mobile by the physical key', () => {
    expect([key('Digit1', { alt: true }), key('Digit2', { alt: true }), key('Digit3', { alt: true })]).toEqual(['desktop', 'tablet', 'mobile'])
  })

  it('ignores the digits without Alt, with other modifiers, and other keys', () => {
    expect(key('Digit1')).toBeNull()
    expect(key('Digit1', { alt: true, meta: true })).toBeNull()
    expect(key('Digit1', { alt: true, shift: true })).toBeNull()
    expect(key('Digit4', { alt: true })).toBeNull()
    expect(key('KeyA', { alt: true })).toBeNull()
  })
})

describe('deviceShortcut and deviceHint', () => {
  it('gives each device its Alt + digit combo and a name · width hint', () => {
    expect(deviceShortcut('desktop', SHOWN)).toEqual(['alt', '1'])
    expect(deviceShortcut('mobile', SHOWN)).toEqual(['alt', '3'])
    expect(deviceShortcut('mobile')).toEqual(['alt', '4'])
    expect(deviceHint(DEVICES.find(d => d.id === 'tablet')!)).toBe('Tablet · 768')
  })
})

describe('revealFrame', () => {
  const stage = { width: 1000, height: 800 }

  it('leaves a frame already in view where it is', () => {
    const view = { x: 100, y: 0, zoom: 0.5 }
    expect(revealFrame(view, { x: 0, y: 0, width: 400, height: 800 }, stage, 50)).toEqual(view)
  })

  it('centres a frame that fits, keeping the zoom', () => {
    // At 50% the 400 px frame is 200 px wide: centred in 1000 px its left edge is at 400.
    expect(revealFrame({ x: 0, y: 0, zoom: 0.5 }, { x: 0, y: 0, width: 400, height: 800 }, stage, 50)).toEqual({ x: 400, y: 0, zoom: 0.5 })
  })

  it('puts the left edge of a frame wider than the stage at the padding', () => {
    expect(revealFrame({ x: 0, y: 0, zoom: 1 }, { x: 2000, y: 0, width: 1280, height: 800 }, stage, 50)).toEqual({ x: -1950, y: 0, zoom: 1 })
  })

  it('brings the top of a frame scrolled out of view back to the padding', () => {
    expect(revealFrame({ x: 400, y: -2000, zoom: 0.5 }, { x: 0, y: 0, width: 400, height: 800 }, stage, 50)).toEqual({ x: 400, y: 50, zoom: 0.5 })
  })
})
