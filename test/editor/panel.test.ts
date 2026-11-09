import { describe, expect, it } from 'vitest'
import { STYLE_TOKENS } from '#shared/design/tokens'
import type { PanelNode, PanelSectionRows } from '#shared/editor/panel'
import { joinSplit, layoutType, layoutTypeWrite, PANEL_SECTIONS, panelRows, panelSection, panelSectionMark, rowAdd, rowProvenance, rowReset, sectionKeys, sectionRemove, sharedStyle, spacingProvenance, splitMode, tokenRemove } from '#shared/editor/panel'

/** The rows of each section as `id`, or `id+` for an "Add…" placeholder. */
const view = (sections: PanelSectionRows[]) => Object.fromEntries(sections.map(s => [s.section, s.rows.map(r => (r.add ? `${r.id}+` : r.id))]))
const rows = (node: PanelNode, device: 'mobile' | 'tablet' | 'desktop' = 'mobile', added: string[] = [], mixed: string[] = []) =>
  panelRows(node, { device, added: added as never[], mixed })

describe('panel sections', () => {
  it('follows Framer: Size, Layout, Styles, Typography, with every design token in exactly one', () => {
    expect(PANEL_SECTIONS).toEqual(['Size', 'Layout', 'Styles', 'Typography'])
    const keys = PANEL_SECTIONS.flatMap(sectionKeys)
    expect(keys.sort()).toEqual(STYLE_TOKENS.map(t => t.key).sort())
  })

  it('puts sizes in Size, spacing and stacking in Layout, paint in Styles', () => {
    expect(panelSection('w')).toBe('Size')
    expect(panelSection('lg:maxW')).toBe('Size')
    expect(panelSection('minH')).toBe('Size')
    expect(panelSection('gap')).toBe('Layout')
    expect(panelSection('md:px')).toBe('Layout')
    expect(panelSection('mx')).toBe('Layout')
    expect(panelSection('cols')).toBe('Layout')
    expect(panelSection('self')).toBe('Layout')
    expect(panelSection('md:display')).toBe('Styles')
    expect(panelSection('bg')).toBe('Styles')
    expect(panelSection('borderB')).toBe('Styles')
    expect(panelSection('roundedTl')).toBe('Styles')
    expect(panelSection('shadow')).toBe('Styles')
    expect(panelSection('color')).toBe('Typography')
    expect(panelSection('bogus')).toBeUndefined()
  })

  it('marks a section blue only when the device sets one of its keys; inheriting is no mark', () => {
    const style = { 'px': '4', 'md:w': 'full', 'bg': 'primary' }
    expect(panelSectionMark(style, 'Layout', 'mobile')).toBe('set')
    expect(panelSectionMark(style, 'Layout', 'tablet')).toBeUndefined()
    expect(panelSectionMark(style, 'Size', 'tablet')).toBe('set')
    expect(panelSectionMark(style, 'Size', 'mobile')).toBeUndefined()
    expect(panelSectionMark(style, 'Styles', 'desktop')).toBe('set')
  })
})

describe('panel rows', () => {
  it('gives a stack its Layout rows, and "Add…" rows for the optional props', () => {
    const sections = rows({ type: 'Column', parentType: 'Page', style: { gap: '3', items: 'start' } })
    expect(view(sections)).toEqual({
      Size: ['width', 'height', 'minMax+'],
      Layout: ['type', 'direction', 'distribute', 'align', 'gap', 'padding', 'margin+', 'self+'],
      Styles: ['visible', 'opacity+', 'fill+', 'border+', 'shadows+', 'radius', 'overflow+', 'display+'],
      Typography: ['fontSize', 'fontWeight', 'textAlign', 'textColor']
    })
  })

  it('collapses a section to its title while none of its tokens applies', () => {
    const sections = rows({ type: 'Column', parentType: 'Page', style: { 'gap': '3', 'md:bg': 'muted' } })
    expect(sections.map(s => [s.section, s.present])).toEqual([['Size', false], ['Layout', true], ['Styles', false], ['Typography', false]])
    expect(rows({ type: 'Text', style: {} }, 'mobile', [], ['color']).find(s => s.section === 'Typography')!.present).toBe(true)
    // Inherited from Mobile still applies on Tablet.
    expect(rows({ type: 'Text', style: { w: 'full' } }, 'tablet').find(s => s.section === 'Size')!.present).toBe(true)
  })

  it('gives a Grid columns instead of direction and alignment', () => {
    expect(view(rows({ type: 'Grid', style: {} })).Layout).toEqual(['type', 'columns', 'gap', 'padding', 'margin+', 'self+'])
  })

  it('switches a stack to the Grid rows where its display is grid', () => {
    const column = { type: 'Column', style: { 'md:display': 'grid', 'md:cols': '2' } }
    expect(view(rows(column, 'tablet')).Layout).toEqual(['type', 'columns', 'gap', 'padding', 'margin+', 'self+'])
    expect(view(rows(column, 'mobile')).Layout).toEqual(['type', 'direction', 'distribute', 'align', 'gap', 'padding', 'margin+', 'self+'])
  })

  it('gives a leaf optional padding, a Grid child its span, and the page root no margin or visibility', () => {
    expect(view(rows({ type: 'Text', parentType: 'Column', style: {} })).Layout).toEqual(['padding+', 'margin+', 'self+'])
    expect(view(rows({ type: 'Card', parentType: 'Grid', style: {} })).Layout).toEqual(['direction', 'distribute', 'align', 'gap', 'padding', 'span', 'margin+', 'self+'])
    const root = view(rows({ type: 'Page', root: true, style: {} }))
    expect(root.Layout).toEqual(['type', 'direction', 'distribute', 'align', 'gap', 'padding'])
    expect(root.Styles).toEqual(['opacity+', 'fill+', 'border+', 'shadows+', 'radius', 'overflow+'])
  })

  it('turns an "Add…" row into its control once added, set at any breakpoint, or mixed', () => {
    const text = { type: 'Text', parentType: 'Column', style: { 'lg:mt': '2', 'border': '1' } }
    expect(view(rows(text)).Layout).toEqual(['padding+', 'margin', 'self+'])
    expect(view(rows(text)).Styles).toContain('border')
    expect(view(rows(text, 'mobile', ['opacity'])).Styles).toContain('opacity')
    expect(view(rows(text, 'mobile', [], ['shadow'])).Styles).toContain('shadows')
  })

  it('shows Display only for a display the Visible row and the Type row do not manage', () => {
    const styles = (style: Record<string, string>) => view(rows({ type: 'Column', natural: 'flex', style })).Styles
    expect(styles({ 'display': 'hidden', 'md:display': 'flex' })).toContain('display+')
    expect(styles({ 'md:display': 'grid' })).toContain('display+')
    expect(styles({ display: 'block' })).toContain('display')
  })
})

describe('row writes', () => {
  it('adds a sensible default token for each optional row', () => {
    expect(rowAdd('border')).toEqual({ border: '1', borderColor: 'default' })
    expect(rowAdd('fill')).toEqual({ bg: 'neutral-100' })
    expect(rowAdd('shadows')).toEqual({ shadow: 'md' })
    expect(rowAdd('margin')).toEqual({ m: '4' })
    expect(rowAdd('padding')).toEqual({ p: '2' })
    expect(rowAdd('opacity')).toEqual({ opacity: '100' })
    expect(rowAdd('overflow')).toEqual({ overflow: 'hidden' })
    expect(rowAdd('minMax')).toEqual({ maxW: 'full' })
    expect(rowAdd('self')).toEqual({ self: 'center' })
    // Display only reveals its control.
    expect(rowAdd('display')).toEqual({})
  })

  it('resets the row keys set at the edited breakpoint only', () => {
    expect(rowReset({ 'm': '4', 'md:mt': '2', 'md:mx': '1', 'md:p': '3' }, 'margin', 'md')).toEqual({ 'md:mt': null, 'md:mx': null })
    expect(rowReset({ border: '2', borderT: '1', borderColor: 'primary', bg: 'muted' }, 'border', undefined)).toEqual({ border: null, borderT: null, borderColor: null })
  })

  it('tells whether a row is overridden on the device, by any of its keys', () => {
    expect(rowProvenance({ 'p': '4', 'md:pt': '2' }, 'padding', 'tablet')).toEqual({ state: 'set', key: 'md:pt', value: '2' })
    expect(rowProvenance({ p: '4' }, 'padding', 'tablet')).toEqual({ state: 'inherited', value: '4', from: undefined })
    expect(rowProvenance({}, 'margin', 'mobile')).toEqual({ state: 'unset' })
  })

  it('removes a whole section, at every breakpoint', () => {
    expect(sectionRemove({ 'border': '2', 'borderColor': 'primary', 'bg': 'muted', 'md:p': '4' }, 'Styles')).toEqual({ border: null, borderColor: null, bg: null })
    expect(sectionRemove({ bg: 'muted' }, 'Size')).toEqual({})
  })

  it('clears a token at every breakpoint', () => {
    expect(tokenRemove({ 'overflow': 'hidden', 'md:overflow': 'auto', 'opacity': '50' }, 'overflow')).toEqual({ 'overflow': null, 'md:overflow': null })
  })
})

describe('layout type', () => {
  it('reads Stack or Grid from the type and the display token at the device', () => {
    expect(layoutType('Column', {}, 'mobile')).toBe('stack')
    expect(layoutType('Row', { display: 'grid' }, 'tablet')).toBe('grid')
    expect(layoutType('Grid', {}, 'mobile')).toBe('grid')
    expect(layoutType('Grid', { 'lg:display': 'flex' }, 'desktop')).toBe('stack')
    // A hidden node keeps its type's layout.
    expect(layoutType('Grid', { display: 'hidden' }, 'mobile')).toBe('grid')
    // Cards lay out an inner stack and Lists follow their layout prop: no Type row.
    expect(layoutType('Card', {}, 'mobile')).toBeUndefined()
    expect(layoutType('List', {}, 'mobile')).toBeUndefined()
    expect(layoutType('Text', {}, 'mobile')).toBeUndefined()
  })

  it('writes Grid as the grid display with two columns, unless columns apply', () => {
    expect(layoutTypeWrite('Column', {}, 'mobile', 'grid')).toEqual({ display: 'grid', cols: '2' })
    expect(layoutTypeWrite('Column', { cols: '3' }, 'tablet', 'grid')).toEqual({ 'md:display': 'grid' })
    expect(layoutTypeWrite('Grid', { 'md:display': 'flex' }, 'tablet', 'grid')).toEqual({ 'md:display': null })
  })

  it('writes Stack by dropping the grid display, or as flex over an inherited grid', () => {
    expect(layoutTypeWrite('Column', { display: 'grid', cols: '2' }, 'mobile', 'stack')).toEqual({ display: null })
    expect(layoutTypeWrite('Column', { display: 'grid' }, 'tablet', 'stack')).toEqual({ 'md:display': 'flex' })
    expect(layoutTypeWrite('Grid', {}, 'mobile', 'stack')).toEqual({ display: 'flex' })
    expect(layoutTypeWrite('Column', {}, 'mobile', 'stack')).toEqual({})
  })
})

describe('radius and border split toggles', () => {
  it('edits per corner or per side once one of those tokens is set', () => {
    expect(splitMode({ rounded: 'lg' }, 'rounded')).toBe('all')
    expect(splitMode({ roundedBr: 'lg' }, 'rounded')).toBe('split')
    expect(splitMode({ border: '1' }, 'border')).toBe('all')
    expect(splitMode({ borderB: '2' }, 'border')).toBe('split')
  })

  it('joins back to one value: the first set corner or side, clearing the others', () => {
    expect(joinSplit({ rounded: 'md', roundedTr: 'lg', roundedBl: 'sm' }, 'rounded')).toEqual({ rounded: 'lg', roundedTr: null, roundedBl: null })
    expect(joinSplit({ borderL: '4' }, 'border')).toEqual({ border: '4', borderL: null })
    expect(joinSplit({ rounded: 'md' }, 'rounded')).toEqual({})
  })
})

describe('spacing provenance', () => {
  it('tells where a side value comes from, set at the breakpoint or inherited', () => {
    const style = { 'p': '2', 'md:px': '6' }
    expect(spacingProvenance(style, 'p', 'left', undefined)).toEqual({ state: 'set', key: 'p', value: '2' })
    expect(spacingProvenance(style, 'p', 'left', 'md')).toEqual({ state: 'set', key: 'md:px', value: '6' })
    expect(spacingProvenance(style, 'p', 'top', 'md')).toEqual({ state: 'inherited', value: '2', from: undefined })
    expect(spacingProvenance(style, 'p', 'left', 'lg')).toEqual({ state: 'inherited', value: '6', from: 'md' })
    expect(spacingProvenance({}, 'm', 'top', undefined)).toEqual({ state: 'unset' })
  })
})

describe('sharedStyle', () => {
  it('keeps the values every node shares and marks the differing tokens as mixed', () => {
    const shared = sharedStyle([
      { 'gap': '3', 'bg': 'primary', 'p': '4', 'md:gap': '6' },
      { 'gap': '3', 'bg': 'muted', 'md:gap': '6' },
      { 'gap': '3', 'bg': 'primary', 'p': '4', 'md:gap': '6' }
    ])
    expect(shared.style).toEqual({ 'gap': '3', 'md:gap': '6' })
    // Unset on one node and set on another counts as mixed too.
    expect(shared.mixed).toEqual(['bg', 'p'])
  })

  it('names the base token of a mixed breakpoint key', () => {
    expect(sharedStyle([{ 'md:cols': '3' }, { 'md:cols': '2' }])).toEqual({ style: {}, mixed: ['cols'] })
  })

  it('is the node style for one node', () => {
    expect(sharedStyle([{ mt: '4' }])).toEqual({ style: { mt: '4' }, mixed: [] })
  })
})
