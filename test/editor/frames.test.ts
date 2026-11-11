import { describe, expect, it } from 'vitest'
import { canHideFrame, DEFAULT_FRAMES, frameForKey, frameRange, frameShortcut, hiddenFrames, hideFrame, parseFrames, PRIMARY_FRAME, serializeFrames, showFrame, visibleFrames } from '#shared/editor/frames'
import { breakpointAt } from '#shared/editor/dropTarget'
import { DEVICES } from '#shared/editor/styleFields'
import type { DeviceId } from '#shared/editor/styleFields'

const device = (id: DeviceId) => DEVICES.find(d => d.id === id)!
const ids = (devices: { id: DeviceId }[]) => devices.map(d => d.id)

describe('the Large phone device', () => {
  it('is 640 wide and edits the sm breakpoint, which the canvas detects at 640', () => {
    expect(device('large-phone')).toMatchObject({ label: 'Large phone', width: 640, breakpoint: 'sm' })
    expect(breakpointAt(device('large-phone').width)).toBe('sm')
    expect(breakpointAt(639)).toBeUndefined()
  })

  it('is hidden by default; Mobile is the Primary', () => {
    expect(PRIMARY_FRAME).toBe('mobile')
    expect(ids(visibleFrames(DEFAULT_FRAMES))).toEqual(['desktop', 'tablet', 'mobile'])
    expect(ids(hiddenFrames(DEFAULT_FRAMES))).toEqual(['large-phone'])
  })
})

describe('frameRange', () => {
  it('gives each frame the widths its breakpoint covers, widest first', () => {
    expect(frameRange(device('desktop'))).toBe('1024+')
    expect(frameRange(device('tablet'))).toBe('1023—768')
    expect(frameRange(device('large-phone'))).toBe('767—640')
    expect(frameRange(device('mobile'))).toBe('639—0')
  })
})

describe('visible frames', () => {
  it('lists the shown frames in frame order, whatever the stored order', () => {
    expect(ids(visibleFrames(['mobile', 'large-phone', 'desktop']))).toEqual(['desktop', 'large-phone', 'mobile'])
  })

  it('always shows the Primary', () => {
    expect(ids(visibleFrames(['tablet']))).toEqual(['tablet', 'mobile'])
    expect(ids(visibleFrames([]))).toEqual(['mobile'])
  })

  it('adds a hidden frame back, once', () => {
    const shown = showFrame(DEFAULT_FRAMES, 'large-phone')
    expect(ids(visibleFrames(shown))).toEqual(['desktop', 'tablet', 'large-phone', 'mobile'])
    expect(hiddenFrames(shown)).toEqual([])
    expect(showFrame(shown, 'large-phone')).toEqual(shown)
  })

  it('hides any frame but the Primary', () => {
    expect(ids(visibleFrames(hideFrame(DEFAULT_FRAMES, 'tablet')))).toEqual(['desktop', 'mobile'])
    expect(ids(hiddenFrames(hideFrame(DEFAULT_FRAMES, 'tablet')))).toEqual(['tablet', 'large-phone'])
    expect(hideFrame(DEFAULT_FRAMES, 'mobile')).toEqual(DEFAULT_FRAMES)
    expect(canHideFrame('mobile')).toBe(false)
    expect(canHideFrame('desktop')).toBe(true)
  })
})

describe('frame shortcuts', () => {
  const key = (shown: readonly DeviceId[], code: string) => frameForKey(shown, { code, alt: true, meta: false, shift: false })

  it('numbers Alt + digit over the visible frames, left to right', () => {
    expect(frameShortcut(DEFAULT_FRAMES, 'mobile')).toEqual(['alt', '3'])
    expect(frameShortcut(DEFAULT_FRAMES, 'large-phone')).toBeUndefined()
    const shown = showFrame(DEFAULT_FRAMES, 'large-phone')
    expect(frameShortcut(shown, 'large-phone')).toEqual(['alt', '3'])
    expect(frameShortcut(shown, 'mobile')).toEqual(['alt', '4'])
    expect([key(shown, 'Digit3'), key(shown, 'Digit4')]).toEqual(['large-phone', 'mobile'])
  })

  it('skips hidden frames', () => {
    const shown = hideFrame(DEFAULT_FRAMES, 'tablet')
    expect([key(shown, 'Digit1'), key(shown, 'Digit2'), key(shown, 'Digit3')]).toEqual(['desktop', 'mobile', null])
  })
})

describe('the stored preference', () => {
  it('round-trips through its serialized form', () => {
    const shown = showFrame(DEFAULT_FRAMES, 'large-phone')
    expect(parseFrames(serializeFrames(shown))).toEqual(shown)
  })

  it('falls back to the defaults on missing or bad data', () => {
    for (const raw of [null, undefined, '', 'not json', '{"a":1}', '42', '[1,2]', 'null']) expect(parseFrames(raw)).toEqual(DEFAULT_FRAMES)
  })

  it('drops unknown frames and keeps the Primary', () => {
    expect(parseFrames('["tablet","watch"]')).toEqual(['tablet', 'mobile'])
    expect(parseFrames('[]')).toEqual(['mobile'])
  })
})
