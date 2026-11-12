import { describe, expect, it } from 'vitest'
import { DEFAULT_FRAMES, defaultFrames, hiddenFrames, parseFrames, serializeFrames, showFrame, visibleFrames } from '#shared/editor/frames'
import type { DeviceId } from '#shared/editor/styleFields'

const ids = (devices: { id: DeviceId }[]) => devices.map(d => d.id)

describe('every project starts with one frame', () => {
  it('shows only the Primary of either base until the preference says otherwise', () => {
    expect(defaultFrames('mobile')).toEqual(['mobile'])
    expect(defaultFrames('desktop')).toEqual(['desktop'])
    expect(DEFAULT_FRAMES).toEqual(['mobile'])
    expect(parseFrames(null, 'mobile')).toEqual(['mobile'])
    expect(parseFrames('not json', 'mobile')).toEqual(['mobile'])
  })

  it('offers every other device with "+" in a new mobile project', () => {
    expect(ids(visibleFrames(defaultFrames('mobile'), 'mobile'))).toEqual(['mobile'])
    expect(ids(hiddenFrames(defaultFrames('mobile'), 'mobile'))).toEqual(['desktop', 'tablet', 'large-phone'])
  })

  it('keeps a saved preference, so changed projects keep their frames', () => {
    const saved = serializeFrames(['desktop', 'tablet', 'mobile'])
    expect(parseFrames(saved, 'mobile')).toEqual(['desktop', 'tablet', 'mobile'])
    expect(showFrame(defaultFrames('mobile'), 'tablet', 'mobile')).toEqual(['tablet', 'mobile'])
  })
})
