import { describe, expect, it } from 'vitest'
import type { DocNode, PropertyDef } from '#shared/document/schema'
import { styleBindingDot, unbindLabel } from '#shared/editor/bindingDot'
import { CLIP_KIND, clipStyle, parseClip, pasteInput, serializeClip } from '#shared/editor/clipboard'
import type { Clip } from '#shared/editor/clipboard'
import { shortcutsFor } from '#shared/editor/commands'
import { deviceOrder } from '#shared/editor/devices'
import { breakpointAt, laysOutInRow } from '#shared/editor/dropTarget'
import { canHideFrame, defaultFrames, frameCaption, frameForKey, frameShortcut, hiddenFrames, hideFrame, parseFrames, primaryFrame, showFrame, visibleFrames } from '#shared/editor/frames'
import { paddingDragKey, resizePatch, spacingDragPatch } from '#shared/editor/handles'
import { hiddenBadge, visibilityAt, visibilityToggle } from '#shared/editor/layers'
import { layoutReset, layoutType, layoutTypeWrite, panelRows, rowProvenance, rowReset, spacingProvenance } from '#shared/editor/panel'
import { boxWrite, spacingSide } from '#shared/editor/spacing'
import { breakpointLabel, breakpointStyles, devicesFor, hasStyleAt, provenanceHint, sectionMark, styleProvenance } from '#shared/editor/styleFields'
import type { DeviceId } from '#shared/editor/styleFields'
import { viewportUnitRules } from '#shared/editor/viewport'

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
    expect(shortcutsFor(['desktop'], DESKTOP).filter(s => s.id.startsWith('device:')).map(s => s.id)).toEqual(['device:desktop'])
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

describe('panel writes and reads at each device', () => {
  it('writes the Type row and resets at the device\'s breakpoint', () => {
    expect(layoutType('Column', { 'display': 'grid', 'max-lg:display': 'flex' }, 'tablet', DESKTOP)).toBe('stack')
    expect(layoutType('Column', { display: 'grid' }, 'tablet', DESKTOP)).toBe('grid')
    expect(layoutTypeWrite('Column', {}, 'tablet', 'grid', DESKTOP)).toEqual({ 'max-lg:display': 'grid', 'max-lg:cols': '2' })
    expect(layoutTypeWrite('Column', {}, 'desktop', 'grid', DESKTOP)).toEqual({ display: 'grid', cols: '2' })
    expect(layoutTypeWrite('Column', {}, 'tablet', 'grid', MOBILE)).toEqual({ 'md:display': 'grid', 'md:cols': '2' })
    expect(rowReset({ 'align': 'left', 'max-lg:align': 'center' }, 'textAlign', 'max-lg')).toEqual({ 'max-lg:align': null })
    expect(rowProvenance({ align: 'left' }, 'textAlign', 'tablet', DESKTOP)).toEqual({ state: 'inherited', value: 'left', from: undefined })
    expect(layoutReset({ 'gap': '4', 'max-lg:gap': '2', 'max-lg:display': 'grid' }, 'tablet', DESKTOP)).toEqual({ 'max-lg:gap': null, 'max-lg:display': null })
  })

  it('makes an optional row removable where the device sets it', () => {
    const rows = (device: DeviceId) => panelRows({ type: 'Text', style: { 'tracking': 'wide', 'max-lg:tracking': 'tight' } }, { device, base: DESKTOP })
      .flatMap(s => s.rows).find(r => r.id === 'letterSpacing')!
    expect(rows('tablet').removable).toBe(true)
    expect(rows('large-phone').removable).toBe(false)
    expect(rows('desktop').removable).toBe(true)
  })

  it('reads and writes spacing down the desktop cascade', () => {
    const style = { 'p': '4', 'max-lg:px': '2' }
    expect(spacingSide(style, 'p', 'left', 'max-md')).toEqual({ value: '2', key: 'max-lg:px', via: 'px', state: 'inherited' })
    expect(spacingSide(style, 'p', 'top', 'max-md')).toEqual({ value: '4', key: 'p', via: 'p', state: 'inherited' })
    expect(spacingProvenance(style, 'p', 'left', 'max-lg')).toEqual({ state: 'set', key: 'max-lg:px', value: '2' })
    expect(spacingProvenance(style, 'p', 'top', 'max-sm')).toEqual({ state: 'inherited', value: '4', from: undefined })
    expect(boxWrite(style, 'p', 'max-lg', 'all', '8')).toEqual({ 'max-lg:p': '8', 'max-lg:px': null })
    // A mobile key never leaks into the desktop cascade.
    expect(spacingSide({ 'md:p': '9' }, 'p', 'top', 'max-lg')).toBeUndefined()
  })

  it('drags handles at the frame\'s breakpoint', () => {
    expect(paddingDragKey({ 'p': '4', 'max-lg:py': '2' }, 'top', 'max-lg')).toBe('py')
    expect(paddingDragKey({ 'p': '4', 'max-lg:py': '2' }, 'top', 'max-md')).toBe('pt')
    expect(spacingDragPatch({}, { kind: 'gap', axis: 'row' }, 16, { dx: 0, dy: 0 }, { breakpoint: 'max-lg', basePx: 4, shift: false })).toEqual({ 'max-lg:gap': '4' })
    expect(resizePatch({ handle: 'e', width: 256, height: 100, breakpoint: 'max-md', basePx: 4 }, { dx: 30, dy: 0 }, false)).toEqual({ 'max-md:w': '72' })
  })
})

describe('the canvas per base', () => {
  it('finds the breakpoint of a frame width', () => {
    expect([1280, 1024, 1023, 768, 767, 640, 639, 390].map(w => breakpointAt(w, DESKTOP))).toEqual([undefined, undefined, 'max-lg', 'max-lg', 'max-md', 'max-md', 'max-sm', 'max-sm'])
    expect([1280, 768, 640, 390].map(w => breakpointAt(w, MOBILE))).toEqual(['lg', 'md', 'sm', undefined])
    expect([1280, 390].map(w => breakpointAt(w))).toEqual(['lg', undefined])
  })

  it('lays out a stack by its direction down the desktop cascade', () => {
    const stack: DocNode = { id: 's', type: 'Column', props: {}, style: { 'direction': 'row', 'max-md:direction': 'col' }, children: [] }
    expect(laysOutInRow(stack, undefined)).toBe(true)
    expect(laysOutInRow(stack, 'max-lg')).toBe(true)
    expect(laysOutInRow(stack, 'max-md')).toBe(false)
    expect(laysOutInRow(stack, 'max-sm')).toBe(false)
  })

  it('maps screen heights with exact class selectors, so max-md: never matches md:', () => {
    const rules = viewportUnitRules('max-md', '[data-v]', '--vh')
    expect(rules).toContain('[data-v] .h-screen:not([class^="max-lg:h-"]):not([class*=" max-lg:h-"]):not([class^="max-md:h-"]):not([class*=" max-md:h-"]) { height: var(--vh) }')
    expect(rules).toContain('[data-v] .max-lg\\:h-screen:not([class^="max-md:h-"]):not([class*=" max-md:h-"]) { height: var(--vh) }')
    expect(rules).toContain('[data-v] .max-md\\:min-h-screen { min-height: var(--vh) }')
    expect(rules).toHaveLength(9)
    expect(viewportUnitRules('md', '[data-v]', '--vh')).toContain('[data-v] .sm\\:h-screen:not([class^="md:h-"]):not([class*=" md:h-"]) { height: var(--vh) }')
  })
})

describe('the layers eye in a desktop project', () => {
  const shown: DeviceId[] = ['desktop', 'tablet']

  it('hides on Tablet only, below 1024', () => {
    expect(visibilityToggle({}, 'tablet', 'flex', shown, DESKTOP)).toEqual({ 'max-lg:display': 'hidden' })
    expect(visibilityAt({ 'max-lg:display': 'hidden' }, 'tablet', DESKTOP)).toEqual({ hidden: true, source: 'max-lg', value: 'hidden' })
    expect(visibilityAt({ 'max-lg:display': 'hidden' }, 'desktop', DESKTOP).hidden).toBe(false)
    expect(hiddenBadge({ 'max-lg:display': 'hidden' }, 'desktop', shown, DESKTOP)).toBe('max-lg')
  })

  it('hides on Desktop and keeps the narrower frame showing', () => {
    expect(visibilityToggle({}, 'desktop', 'flex', shown, DESKTOP)).toEqual({ 'display': 'hidden', 'max-lg:display': 'flex' })
    expect(visibilityToggle({ 'display': 'hidden', 'max-lg:display': 'flex' }, 'desktop', 'flex', shown, DESKTOP)).toEqual({ 'display': null, 'max-lg:display': null })
  })
})

describe('the binding dot down the desktop cascade', () => {
  it('inherits a binding from the wider levels', () => {
    const property: PropertyDef = { id: 'pad', name: 'Pad', kind: 'text', bindings: [{ nodeId: 'n', prop: 'p', target: 'style' }] }
    expect(styleBindingDot([property], 'n', {}, 'max-md:p').state).toBe('inherited')
    expect(styleBindingDot([property], 'n', { 'max-lg:p': '4' }, 'max-md:p').state).toBe('none')
    const tablet: PropertyDef = { ...property, bindings: [{ nodeId: 'n', prop: 'max-lg:p', target: 'style' }] }
    const unbind = styleBindingDot([tablet], 'n', {}, 'max-md:p').actions[0]!
    expect(unbind.kind === 'unbind' && unbindLabel(unbind, 'property')).toBe('Unbind property from max-lg down')
  })
})

describe('paste across bases', () => {
  const clip = (style: Record<string, string>, base?: 'mobile' | 'desktop'): Clip => ({
    kind: CLIP_KIND, sourceIds: ['a'], copiedAt: 1, ...(base ? { base } : {}),
    nodes: [{ type: 'Container', props: {}, style, children: [{ type: 'Text', props: {}, style: { 'text': 'sm', 'md:text': 'lg' }, children: [] }] }]
  })

  it('converts the styles of a clip from a mobile project into a desktop one', () => {
    const input = pasteInput(clip({ 'p': '4', 'lg:p': '8' }, 'mobile'), DESKTOP)
    expect(input).toEqual({ exact: true, nodes: [{ type: 'Container', props: {}, style: { 'p': '8', 'max-lg:p': '4' }, children: [{ type: 'Text', props: {}, style: { 'text': 'lg', 'max-md:text': 'sm' }, children: [] }] }] })
    // A clip from before S37 is mobile-first.
    expect(pasteInput(clip({ p: '4' }), DESKTOP)).toMatchObject({ exact: true })
    expect(pasteInput(clip({ 'p': '4', 'lg:p': '8' }, 'mobile'), MOBILE).nodes[0]!.style).toEqual({ 'p': '4', 'lg:p': '8' })
  })

  it('refuses a style the other base cannot express, with a clear message', () => {
    expect(() => pasteInput(clip({ 'md:p': '4' }, 'mobile'), DESKTOP)).toThrow('Cannot paste here: style token "md:p" has no base value, so it cannot be converted to a desktop-first project')
  })

  it('keeps the base through the system clipboard', () => {
    expect(parseClip(serializeClip(clip({ p: '4' }, 'desktop')))!.base).toBe('desktop')
    expect(parseClip(serializeClip(clip({ p: '4' })))).not.toHaveProperty('base')
    expect(parseClip(JSON.stringify({ ...clip({ p: '4' }), base: 'tablet' }))).toBeNull()
  })

  it('converts Paste style too', () => {
    expect(clipStyle(clip({ 'p': '4', 'lg:p': '8' }, 'mobile'), DESKTOP)).toEqual({ 'p': '8', 'max-lg:p': '4' })
  })
})
