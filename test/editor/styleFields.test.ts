import { describe, expect, it } from 'vitest'
import { getStyleToken, STYLE_TOKENS } from '#shared/design/tokens'
import { DEFAULT_THEME } from '#shared/design/theme'
import { breakpointLabel, breakpointStyles, colorSwatchRows, DEVICES, hasStyleAt, sectionMark, setStyleTokens, spacingItems, STYLE_SECTIONS, styleFieldControl, styleProvenance, styleSection, styleSections } from '#shared/editor/styleFields'
import { DRAG_MIME, draggedNodeId, nodeDragType, parseDragPayload } from '#shared/editor/dropTarget'

describe('style fields', () => {
  it('lists the sections in Stacki order, with every design token in exactly one', () => {
    expect(STYLE_SECTIONS).toEqual(['Layout', 'Spacing', 'Size', 'Typography', 'Backgrounds', 'Borders', 'Effects'])
    const keys = styleSections().flatMap(s => s.fields.map(f => f.key))
    expect(keys.sort()).toEqual(STYLE_TOKENS.map(t => t.key).sort())
    expect(styleSections().find(s => s.section === 'Layout')!.fields.map(f => f.key)).toEqual(['direction', 'items', 'justify', 'self', 'gap', 'cols', 'colSpan', 'display'])
  })

  it('puts each token key, breakpoint-prefixed or not, in its section', () => {
    expect(styleSection('mt')).toBe('Spacing')
    expect(styleSection('md:cols')).toBe('Layout')
    expect(styleSection('gap')).toBe('Layout')
    expect(styleSection('maxW')).toBe('Size')
    expect(styleSection('color')).toBe('Typography')
    expect(styleSection('lg:align')).toBe('Typography')
    expect(styleSection('bg')).toBe('Backgrounds')
    expect(styleSection('borderColor')).toBe('Borders')
    expect(styleSection('rounded')).toBe('Borders')
    expect(styleSection('shadow')).toBe('Effects')
    expect(styleSection('bogus')).toBeUndefined()
    expect(styleSection('xl:mt')).toBeUndefined()
  })

  it('uses a select for the five-value alignments, which overflow as segments', () => {
    expect(styleFieldControl(getStyleToken('items')!)).toBe('select')
    expect(styleFieldControl(getStyleToken('self')!)).toBe('select')
  })

  it('picks a control per token: colour swatches, the spacing scale, segments for short lists, else a select', () => {
    expect(styleFieldControl(getStyleToken('bg')!)).toBe('color')
    expect(styleFieldControl(getStyleToken('borderColor')!)).toBe('color')
    expect(styleFieldControl(getStyleToken('mt')!)).toBe('spacing')
    expect(styleFieldControl(getStyleToken('gap')!)).toBe('spacing')
    expect(styleFieldControl(getStyleToken('align')!)).toBe('segmented')
    expect(styleFieldControl(getStyleToken('border')!)).toBe('segmented')
    expect(styleFieldControl(getStyleToken('rounded')!)).toBe('select')
    expect(styleFieldControl(getStyleToken('font')!)).toBe('select')
    expect(styleFieldControl(getStyleToken('cols')!)).toBe('select')
    expect(styleFieldControl(getStyleToken('colSpan')!)).toBe('select')
  })

  it('lists the set tokens in registry order with their classes', () => {
    expect(setStyleTokens({ bg: 'primary-600', mt: '10', bogus: 'x' })).toEqual([
      { key: 'mt', label: 'Margin top', value: '10', className: 'mt-10' },
      { key: 'bg', label: 'Background', value: 'primary-600', className: 'bg-primary-600' }
    ])
  })

  it('lists breakpoint-prefixed tokens after their base, with variant classes', () => {
    expect(setStyleTokens({ 'md:cols': '3', 'cols': '1', 'xl:cols': '2' })).toEqual([
      { key: 'cols', label: 'Grid columns', value: '1', className: 'grid-cols-1' },
      { key: 'md:cols', label: 'Grid columns (md)', value: '3', className: 'md:grid-cols-3' }
    ])
  })
})

describe('devices and breakpoints', () => {
  it('offers Mobile, Tablet and Desktop, mobile-first', () => {
    expect(DEVICES).toEqual([
      { id: 'mobile', label: 'Mobile', width: 390, breakpoint: undefined, icon: 'i-lucide-smartphone' },
      { id: 'tablet', label: 'Tablet', width: 768, breakpoint: 'md', icon: 'i-lucide-tablet' },
      { id: 'desktop', label: 'Desktop', width: 1280, breakpoint: 'lg', icon: 'i-lucide-monitor' }
    ])
  })

  it('splits a style into the breakpoint own tokens and those inherited from smaller breakpoints', () => {
    const style = { 'cols': '1', 'md:cols': '2', 'gap': '6', 'sm:gap': '4', 'lg:p': '8' }
    expect(breakpointStyles(style, undefined)).toEqual({ own: { cols: '1', gap: '6' }, inherited: {} })
    expect(breakpointStyles(style, 'md')).toEqual({
      own: { cols: '2' },
      inherited: { gap: { value: '4', from: 'sm' } }
    })
    expect(breakpointStyles(style, 'lg')).toEqual({
      own: { p: '8' },
      inherited: { cols: { value: '2', from: 'md' }, gap: { value: '4', from: 'sm' } }
    })
    expect(breakpointStyles({ 'cols': '1', 'md:cols': '2' }, 'md').inherited).toEqual({})
  })

  it('names breakpoints by their device, mobile-first', () => {
    expect(breakpointLabel(undefined)).toBe('Mobile')
    expect(breakpointLabel('md')).toBe('Tablet')
    expect(breakpointLabel('lg')).toBe('Desktop')
    expect(breakpointLabel('sm')).toBe('sm')
  })
})

describe('provenance', () => {
  const style = { 'mt': '4', 'md:mt': '8', 'cols': '1', 'sm:gap': '2', 'bg': 'primary' }

  it('is set when the device writes the key, with the key a reset clears', () => {
    expect(styleProvenance(style, 'mt', 'mobile')).toEqual({ state: 'set', key: 'mt', value: '4' })
    expect(styleProvenance(style, 'mt', 'tablet')).toEqual({ state: 'set', key: 'md:mt', value: '8' })
  })

  it('is inherited from the nearest smaller breakpoint otherwise', () => {
    expect(styleProvenance(style, 'mt', 'desktop')).toEqual({ state: 'inherited', value: '8', from: 'md' })
    expect(styleProvenance(style, 'cols', 'tablet')).toEqual({ state: 'inherited', value: '1', from: undefined })
    expect(styleProvenance(style, 'gap', 'tablet')).toEqual({ state: 'inherited', value: '2', from: 'sm' })
  })

  it('is unset when nothing applies at the device', () => {
    expect(styleProvenance(style, 'p', 'desktop')).toEqual({ state: 'unset' })
    expect(styleProvenance(style, 'gap', 'mobile')).toEqual({ state: 'unset' })
  })

  it('treats tokens without breakpoint variants as set on every device', () => {
    expect(styleProvenance(style, 'bg', 'tablet')).toEqual({ state: 'set', key: 'bg', value: 'primary' })
    expect(styleProvenance({ 'md:bg': 'primary' }, 'bg', 'tablet')).toEqual({ state: 'unset' })
  })

  it('marks a section blue when the device sets one of its keys, orange when it only inherits', () => {
    expect(sectionMark(style, 'Spacing', 'tablet')).toBe('set')
    expect(sectionMark(style, 'Layout', 'tablet')).toBe('inherited')
    expect(sectionMark(style, 'Layout', 'mobile')).toBe('set')
    expect(sectionMark(style, 'Backgrounds', 'desktop')).toBe('set')
    expect(sectionMark(style, 'Size', 'desktop')).toBeUndefined()
  })

  it('tells whether a node has overrides at a device breakpoint', () => {
    expect(hasStyleAt(style, 'mobile')).toBe(true)
    expect(hasStyleAt(style, 'tablet')).toBe(true)
    expect(hasStyleAt(style, 'desktop')).toBe(false)
    expect(hasStyleAt({ 'sm:gap': '2' }, 'mobile')).toBe(false)
    expect(hasStyleAt({}, 'mobile')).toBe(false)
  })
})

describe('spacing items', () => {
  it('labels each scale value with its px size for the project spacing density', () => {
    const mt = getStyleToken('mt')!
    const items = spacingItems(mt, 'default')
    expect(items.find(i => i.value === '10')).toEqual({ value: '10', label: '10 · 40px' })
    expect(items.find(i => i.value === '0.5')).toEqual({ value: '0.5', label: '0.5 · 2px' })
    expect(items.find(i => i.value === '0')).toEqual({ value: '0', label: '0 · 0px' })
    expect(items.at(-1)).toEqual({ value: 'auto', label: 'auto' })
    expect(spacingItems(mt, 'compact').find(i => i.value === '10')!.label).toBe('10 · 32px')
    expect(spacingItems(mt, 'comfortable').find(i => i.value === '1.5')!.label).toBe('1.5 · 7.2px')
    expect(items.map(i => i.value)).toEqual(mt.values)
  })
})

describe('colour swatches', () => {
  it('offers each semantic colour and its shades, painted with the project theme', () => {
    const rows = colorSwatchRows(getStyleToken('bg')!, DEFAULT_THEME)
    expect(rows.map(r => r.name)).toEqual(['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral', 'design'])
    const primary = rows[0]!.swatches
    expect(primary[0]).toEqual({ value: 'primary', label: 'primary', color: 'var(--color-green-500, oklch(72.3% 0.219 149.579))' })
    expect(primary[7]).toEqual({ value: 'primary-600', label: 'primary-600', color: expect.stringContaining('--color-green-600') })
    expect(primary).toHaveLength(12)
    // There is no bare `bg-neutral` utility, only its shades.
    expect(rows[6]!.swatches.map(s => s.value)).not.toContain('neutral')
    expect(rows[6]!.swatches).toHaveLength(11)
  })

  it('ends with the neutral design colours of that utility', () => {
    const bg = colorSwatchRows(getStyleToken('bg')!, DEFAULT_THEME).at(-1)!.swatches
    expect(bg.map(s => s.value)).toEqual(['default', 'muted', 'elevated', 'accented', 'inverted'])
    expect(bg[0]!.color).toBe('#fff')
    const text = colorSwatchRows(getStyleToken('color')!, DEFAULT_THEME).at(-1)!.swatches
    expect(text.map(s => s.value)).toEqual(['default', 'highlighted', 'toned', 'muted', 'dimmed', 'inverted'])
    expect(text[0]!.color).toBe('var(--color-slate-700, oklch(37.2% 0.044 257.287))')
  })

  it('follows the theme: a hex primary paints its own colour', () => {
    const theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#e11d48' } }
    expect(colorSwatchRows(getStyleToken('bg')!, theme)[0]!.swatches[0]!.color).toBe('#e11d48')
  })
})

describe('parseDragPayload', () => {
  it('reads palette components and tree nodes', () => {
    expect(DRAG_MIME).toBe('application/x-bildr')
    expect(parseDragPayload('{"kind":"component","type":"Button"}')).toEqual({ kind: 'component', type: 'Button' })
    expect(parseDragPayload('{"kind":"node","id":"n_1"}')).toEqual({ kind: 'node', id: 'n_1' })
  })

  it('rejects anything else', () => {
    expect(parseDragPayload('')).toBeNull()
    expect(parseDragPayload('not json')).toBeNull()
    expect(parseDragPayload('{"kind":"component"}')).toBeNull()
    expect(parseDragPayload('{"kind":"file","id":"x"}')).toBeNull()
  })

  it('exposes the dragged node id through the dataTransfer types, readable during dragover', () => {
    expect(draggedNodeId([DRAG_MIME, nodeDragType('n_abc1')])).toBe('n_abc1')
    expect(draggedNodeId([DRAG_MIME])).toBeUndefined()
  })
})
