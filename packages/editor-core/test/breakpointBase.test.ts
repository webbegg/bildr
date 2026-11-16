import { describe, expect, it } from 'vitest'
import { deviceOrder } from '../src/devices.ts'
import { canHideFrame, defaultFrames, frameCaption, frameForKey, frameShortcut, hiddenFrames, hideFrame, parseFrames, primaryFrame, showFrame, visibleFrames } from '../src/frames.ts'
import { paddingDragKey, resizePatch, spacingDragPatch } from '../src/handles.ts'
import { breakpointLabel, breakpointStyles, devicesFor, hasStyleAt, provenanceHint, sectionMark, styleProvenance } from '../src/styleFields.ts'
import type { DeviceId } from '../src/styleFields.ts'
import { viewportUnitRules } from '../src/viewport.ts'

const ids = (devices: { id: DeviceId }[]) => devices.map(d => d.id)
const DESKTOP = 'desktop' as const
const MOBILE = 'mobile' as const

describe('devices and frames per base (S37)', () => {
  it('maps each device to its breakpoint, the base device first', () => {
    expect(devicesFor(MOBILE).map(d => [d.id, d.breakpoint])).toEqual([['mobile', undefined], ['large-phone', 'sm'], ['tablet', 'md'], ['desktop', 'lg']])
    expect(devicesFor(DESKTOP).map(d => [d.id, d.breakpoint])).toEqual([['desktop', undefined], ['tablet', 'max-lg'], ['large-phone', 'max-md'], ['mobile', 'max-sm']])
    expect(devicesFor(DESKTOP).map(d => d.width)).toEqual([1280, 768, 640, 390])
    expect(ids(deviceOrder(DESKTOP))).toEqual(['desktop', 'tablet', 'large-phone', 'mobile'])
  })

  it('starts a desktop project with only the Desktop frame, the Primary', () => {
    expect(primaryFrame(DESKTOP)).toBe('desktop')
    expect(primaryFrame(MOBILE)).toBe('mobile')
    expect(defaultFrames(DESKTOP)).toEqual(['desktop'])
    expect(defaultFrames(MOBILE)).toEqual(['mobile'])
    expect(ids(visibleFrames(defaultFrames(DESKTOP), DESKTOP))).toEqual(['desktop'])
    expect(ids(hiddenFrames(defaultFrames(DESKTOP), DESKTOP))).toEqual(['tablet', 'large-phone', 'mobile'])
    expect(visibleFrames(['desktop'], DESKTOP)[0]!.breakpoint).toBeUndefined()
    expect(parseFrames(null, DESKTOP)).toEqual(['desktop'])
    expect(parseFrames('["tablet"]', DESKTOP)).toEqual(['desktop', 'tablet'])
  })

  it('adds and hides frames around the base\'s Primary', () => {
    const shown = showFrame(defaultFrames(DESKTOP), 'tablet', DESKTOP)
    expect(shown).toEqual(['desktop', 'tablet'])
    expect(ids(visibleFrames(shown, DESKTOP))).toEqual(['desktop', 'tablet'])
    expect(visibleFrames(shown, DESKTOP)[1]!.breakpoint).toBe('max-lg')
    expect(canHideFrame('desktop', DESKTOP)).toBe(false)
    expect(canHideFrame('mobile', DESKTOP)).toBe(true)
    expect(hideFrame(shown, 'desktop', DESKTOP)).toEqual(['desktop', 'tablet'])
    expect(hideFrame(shown, 'tablet', DESKTOP)).toEqual(['desktop'])
    expect(frameShortcut(shown, 'tablet', DESKTOP)).toEqual(['alt', '2'])
    expect(frameForKey(shown, { code: 'Digit1', alt: true, meta: false, shift: false }, DESKTOP)).toBe('desktop')
  })

  it('captions the frames with their widths, the Primary first', () => {
    const caption = (id: DeviceId, base: typeof DESKTOP | typeof MOBILE) => frameCaption(devicesFor(base).find(d => d.id === id)!, base)
    expect(caption('desktop', DESKTOP)).toBe('Primary · 1024+')
    expect(caption('tablet', DESKTOP)).toBe('1023—768')
    expect(caption('large-phone', DESKTOP)).toBe('767—640')
    expect(caption('mobile', DESKTOP)).toBe('639—0')
    expect(caption('mobile', MOBILE)).toBe('Primary')
    expect(caption('desktop', MOBILE)).toBe('1024+')
  })
})

describe('the cascade read per device', () => {
  const style = { 'p': '4', 'max-lg:p': '6', 'max-sm:p': '2', 'align': 'left', 'max-md:align': 'center' }

  it('inherits from the wider levels in a desktop project', () => {
    expect(breakpointStyles(style, 'max-md')).toEqual({ own: { align: 'center' }, inherited: { p: { value: '6', from: 'max-lg' } } })
    expect(breakpointStyles(style, undefined)).toEqual({ own: { p: '4', align: 'left' }, inherited: {} })
    expect(styleProvenance(style, 'p', 'desktop', DESKTOP)).toEqual({ state: 'set', key: 'p', value: '4' })
    expect(styleProvenance(style, 'p', 'tablet', DESKTOP)).toEqual({ state: 'set', key: 'max-lg:p', value: '6' })
    expect(styleProvenance(style, 'p', 'large-phone', DESKTOP)).toEqual({ state: 'inherited', value: '6', from: 'max-lg' })
    expect(styleProvenance(style, 'p', 'mobile', DESKTOP)).toEqual({ state: 'set', key: 'max-sm:p', value: '2' })
    expect(styleProvenance(style, 'align', 'mobile', DESKTOP)).toEqual({ state: 'inherited', value: 'center', from: 'max-md' })
    expect(styleProvenance({ 'md:p': '4' }, 'p', 'tablet', MOBILE)).toEqual({ state: 'set', key: 'md:p', value: '4' })
  })

  it('labels where a value comes from', () => {
    expect(breakpointLabel(undefined, DESKTOP)).toBe('Desktop')
    expect(breakpointLabel('max-lg', DESKTOP)).toBe('Tablet')
    expect(breakpointLabel(undefined)).toBe('Mobile')
    expect(provenanceHint(styleProvenance({ p: '4' }, 'p', 'tablet', DESKTOP), DESKTOP)).toBe('From Desktop: 4')
    expect(provenanceHint(styleProvenance({ p: '4' }, 'p', 'tablet', MOBILE), MOBILE)).toBe('From Mobile: 4')
  })

  it('marks what a device sets', () => {
    expect(hasStyleAt(style, 'tablet', DESKTOP)).toBe(true)
    expect(hasStyleAt(style, 'large-phone', DESKTOP)).toBe(true)
    expect(hasStyleAt({ p: '4' }, 'tablet', DESKTOP)).toBe(false)
    expect(hasStyleAt({ p: '4' }, 'desktop', DESKTOP)).toBe(true)
    expect(sectionMark(style, 'Spacing', 'tablet', DESKTOP)).toBe('set')
    expect(sectionMark(style, 'Spacing', 'large-phone', DESKTOP)).toBeUndefined()
  })
})

describe('handles per base', () => {
  it('drags handles at the frame\'s breakpoint', () => {
    expect(paddingDragKey({ 'p': '4', 'max-lg:py': '2' }, 'top', 'max-lg')).toBe('py')
    expect(paddingDragKey({ 'p': '4', 'max-lg:py': '2' }, 'top', 'max-md')).toBe('pt')
    expect(spacingDragPatch({}, { kind: 'gap', axis: 'row' }, 16, { dx: 0, dy: 0 }, { breakpoint: 'max-lg', basePx: 4, shift: false })).toEqual({ 'max-lg:gap': '4' })
    expect(resizePatch({ handle: 'e', width: 256, height: 100, breakpoint: 'max-md', basePx: 4 }, { dx: 30, dy: 0 }, false)).toEqual({ 'max-md:w': '72' })
  })
})

describe('screen heights per base', () => {
  it('maps screen heights with exact class selectors, so max-md: never matches md:', () => {
    const rules = viewportUnitRules('max-md', '[data-v]', '--vh')
    expect(rules).toContain('[data-v] .h-screen:not([class^="max-lg:h-"]):not([class*=" max-lg:h-"]):not([class^="max-md:h-"]):not([class*=" max-md:h-"]) { height: var(--vh) }')
    expect(rules).toContain('[data-v] .max-lg\\:h-screen:not([class^="max-md:h-"]):not([class*=" max-md:h-"]) { height: var(--vh) }')
    expect(rules).toContain('[data-v] .max-md\\:min-h-screen { min-height: var(--vh) }')
    expect(rules).toHaveLength(9)
    expect(viewportUnitRules('md', '[data-v]', '--vh')).toContain('[data-v] .sm\\:h-screen:not([class^="md:h-"]):not([class*=" md:h-"]) { height: var(--vh) }')
  })
})
