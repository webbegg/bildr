import { describe, expect, it } from 'vitest'
import { boxWrite, spacingSide } from '@bildr/editor-core/spacing'
import type { DeviceId } from '@bildr/editor-core/styleFields'
import { hiddenBadge, visibilityAt, visibilityToggle } from '../../src/shared/layers.ts'
import { layoutReset, layoutType, layoutTypeWrite, panelRows, rowProvenance, rowReset, spacingProvenance } from '../../src/shared/panel.ts'

/** Ported from the hosted `test/editor/breakpointBase.test.ts` (S37): the panel and the layers eye in a desktop-first project. */

const DESKTOP = 'desktop' as const
const MOBILE = 'mobile' as const

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
