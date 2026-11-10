import { describe, expect, it } from 'vitest'
import { STYLE_TOKENS } from '#shared/design/tokens'
import type { PanelNode, PanelSectionRows } from '#shared/editor/panel'
import { joinSplit, layoutReset, layoutType, layoutTypeWrite, PANEL_SECTIONS, panelRows, panelSection, rowAdd, rowProvenance, rowReset, sectionKeys, sharedStyle, spacingProvenance, splitMode } from '#shared/editor/panel'

/** The rows of each rendered section as `id`, `id+` for an "Add…" slot, or `id−` for a row with a remove button. */
const view = (sections: PanelSectionRows[]) => Object.fromEntries(sections.map(s => [s.section, s.rows.map(r => `${r.id}${r.slot ? '+' : r.removable ? '−' : ''}`)]))
/** The header "+" menu of each rendered section. */
const menus = (sections: PanelSectionRows[]) => Object.fromEntries(sections.map(s => [s.section, s.menu.map(m => m.id)]))
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
    expect(panelSection('md:h')).toBe('Size')
    expect(panelSection('md:minW')).toBe('Size')
    expect(panelSection('maxH')).toBe('Size')
    expect(panelSection('gap')).toBe('Layout')
    expect(panelSection('md:px')).toBe('Layout')
    expect(panelSection('mx')).toBe('Layout')
    expect(panelSection('cols')).toBe('Layout')
    expect(panelSection('md:flexWrap')).toBe('Layout')
    expect(panelSection('self')).toBe('Layout')
    expect(panelSection('overflow')).toBe('Layout')
    expect(panelSection('md:display')).toBe('Styles')
    expect(panelSection('bg')).toBe('Styles')
    expect(panelSection('borderB')).toBe('Styles')
    expect(panelSection('roundedTl')).toBe('Styles')
    expect(panelSection('shadow')).toBe('Styles')
    expect(panelSection('color')).toBe('Typography')
    expect(panelSection('tracking')).toBe('Typography')
    expect(panelSection('md:leading')).toBe('Typography')
    expect(panelSection('textTransform')).toBe('Typography')
    expect(panelSection('bogus')).toBeUndefined()
  })
})

describe('panel rows', () => {
  const column: PanelNode = { type: 'Column', parentType: 'Page', style: { gap: '3', items: 'start' } }

  it('shows every section\'s core rows, with "Add…" slots for Fill, Border and Shadows', () => {
    expect(view(rows(column))).toEqual({
      Size: ['width', 'height'],
      Layout: ['type', 'direction', 'distribute', 'align', 'wrap', 'gap', 'padding'],
      Styles: ['visible', 'opacity', 'fill+', 'border+', 'shadows+', 'radius'],
      Typography: ['fontSize', 'fontWeight', 'textAlign', 'textColor']
    })
  })

  it('offers each group\'s optional properties in its header "+" menu', () => {
    expect(menus(rows(column))).toEqual({
      Size: ['maxWidth', 'minWidth', 'maxHeight', 'minHeight'],
      Layout: ['margin', 'self', 'overflow'],
      Styles: ['corners', 'display'],
      Typography: ['letterSpacing', 'lineHeight', 'transform']
    })
  })

  it('shows an optional row with a value at any breakpoint, with a "−", and drops it from the menu', () => {
    const style = { 'lg:maxW': 'full', 'md:m': '2', 'lg:tracking': 'wide', 'roundedTl': 'lg', 'bg': 'muted' }
    const sections = rows({ ...column, style }, 'desktop')
    expect(view(sections)).toEqual({
      Size: ['width', 'height', 'maxWidth−'],
      Layout: ['type', 'direction', 'distribute', 'align', 'wrap', 'gap', 'padding', 'margin'],
      Styles: ['visible', 'opacity', 'fill−', 'border+', 'shadows+', 'radius', 'corners−'],
      Typography: ['fontSize', 'fontWeight', 'textAlign', 'textColor', 'letterSpacing−']
    })
    expect(menus(sections).Size).toEqual(['minWidth', 'maxHeight', 'minHeight'])
    expect(menus(sections).Layout).toEqual(['self', 'overflow'])
    expect(menus(sections).Typography).toEqual(['lineHeight', 'transform'])
  })

  it('offers "−" only where the edited breakpoint sets the row (or it was just added)', () => {
    const style = { 'md:m': '2', 'leading': 'loose' }
    const tablet = view(rows({ ...column, style }, 'tablet', ['transform']))
    expect(tablet.Layout).toContain('margin−')
    expect(tablet.Typography).toEqual(['fontSize', 'fontWeight', 'textAlign', 'textColor', 'lineHeight', 'transform−'])
    expect(view(rows({ ...column, style }, 'mobile')).Layout).toContain('margin')
  })

  it('shows a set minimum height as a Min Height row, not as the Height value', () => {
    const style = { minH: '32' }
    const sections = rows({ ...column, style })
    expect(view(sections).Size).toEqual(['width', 'height', 'minHeight−'])
    expect(menus(sections).Size).toEqual(['maxWidth', 'minWidth', 'maxHeight'])
    expect(rowProvenance(style, 'height', 'mobile')).toEqual({ state: 'unset' })
    expect(rowProvenance(style, 'minHeight', 'mobile')).toEqual({ state: 'set', key: 'minH', value: '32' })
  })

  it('shows a mixed optional row', () => {
    expect(view(rows(column, 'mobile', [], ['minW'])).Size).toEqual(['width', 'height', 'minWidth'])
  })

  it('gives a Grid columns instead of direction and alignment', () => {
    expect(view(rows({ type: 'Grid', style: {} })).Layout).toEqual(['type', 'columns', 'gap', 'padding'])
  })

  it('switches a stack to the Grid rows where its display is grid', () => {
    const grid = { type: 'Column', style: { 'md:display': 'grid', 'md:cols': '2' } }
    expect(view(rows(grid, 'tablet')).Layout).toEqual(['type', 'columns', 'gap', 'padding'])
    expect(view(rows(grid, 'mobile')).Layout).toEqual(['type', 'direction', 'distribute', 'align', 'wrap', 'gap', 'padding'])
  })

  it('shows Layout on a leaf as a title with a "+" offering padding, margin, self and overflow', () => {
    const text: PanelNode = { type: 'Text', parentType: 'Column', style: {} }
    expect(rows(text).map(s => s.section)).toEqual(['Size', 'Layout', 'Styles', 'Typography'])
    expect(view(rows(text)).Layout).toEqual([])
    expect(menus(rows(text)).Layout).toEqual(['padding', 'margin', 'self', 'overflow'])
    const margin = rows({ ...text, style: { 'lg:mt': '2' } }, 'tablet')
    expect(view(margin).Layout).toEqual(['margin'])
    expect(menus(margin).Layout).toEqual(['padding', 'self', 'overflow'])
    expect(view(rows({ type: 'Button', style: { p: '2' } })).Layout).toEqual(['padding−'])
    expect(view(rows({ type: 'Button', style: {} }, 'mobile', ['margin'])).Layout).toEqual(['margin−'])
  })

  it('offers Reset layout on containers only: a leaf removes its layout rows one by one', () => {
    const reset = (sections: PanelSectionRows[]) => sections.find(s => s.section === 'Layout')?.reset
    expect(reset(rows(column))).toBe(true)
    expect(reset(rows({ type: 'Card', style: {} }))).toBe(true)
    expect(reset(rows({ type: 'Button', style: { p: '2', m: '0' } }))).toBe(false)
    expect(rows(column).filter(s => s.section !== 'Layout').every(s => !s.reset)).toBe(true)
  })

  it('gives a Grid child its span, and the page root no margin, self or visibility', () => {
    expect(view(rows({ type: 'Card', parentType: 'Grid', style: {} })).Layout).toEqual(['direction', 'distribute', 'align', 'wrap', 'gap', 'padding', 'span'])
    const root = rows({ type: 'Page', root: true, style: {} })
    expect(view(root).Styles).toEqual(['opacity', 'fill+', 'border+', 'shadows+', 'radius'])
    expect(menus(root).Layout).toEqual(['overflow'])
    expect(menus(root).Styles).toEqual(['corners'])
  })

  it('shows Display only for a display the Visible row and the Type row do not manage', () => {
    const styles = (style: Record<string, string>) => view(rows({ type: 'Column', natural: 'flex', style })).Styles
    expect(styles({ 'display': 'hidden', 'md:display': 'flex' })).not.toContain('display')
    expect(styles({ 'md:display': 'grid' })).not.toContain('display')
    expect(styles({ display: 'block' })).toContain('display−')
    expect(view(rows({ type: 'Column', natural: 'flex', style: {} }, 'mobile', ['display'])).Styles).toContain('display−')
  })
})

describe('row writes', () => {
  it('adds a sensible default token for each optional row', () => {
    expect(rowAdd('border')).toEqual({ border: '1', borderColor: 'default' })
    expect(rowAdd('fill')).toEqual({ bg: 'neutral-100' })
    expect(rowAdd('shadows')).toEqual({ shadow: 'md' })
    expect(rowAdd('maxWidth')).toEqual({ maxW: 'full' })
    expect(rowAdd('minWidth')).toEqual({ minW: '0' })
    expect(rowAdd('maxHeight')).toEqual({ maxH: 'full' })
    expect(rowAdd('minHeight')).toEqual({ minH: '0' })
    expect(rowAdd('margin')).toEqual({ m: '0' })
    expect(rowAdd('padding')).toEqual({ p: '2' })
    expect(rowAdd('self')).toEqual({ self: 'center' })
    expect(rowAdd('overflow')).toEqual({ overflow: 'hidden' })
    expect(rowAdd('letterSpacing')).toEqual({ tracking: 'normal' })
    expect(rowAdd('lineHeight')).toEqual({ leading: 'normal' })
    expect(rowAdd('transform')).toEqual({ textTransform: 'uppercase' })
    // Display and the corners only reveal their controls.
    expect(rowAdd('display')).toEqual({})
    expect(rowAdd('corners')).toEqual({})
  })

  it('resets (or removes) the row keys set at the edited breakpoint only', () => {
    expect(rowReset({ 'm': '4', 'md:mt': '2', 'md:mx': '1', 'md:p': '3' }, 'margin', 'md')).toEqual({ 'md:mt': null, 'md:mx': null })
    expect(rowReset({ border: '2', borderT: '1', borderColor: 'primary', bg: 'muted' }, 'border', undefined)).toEqual({ border: null, borderT: null, borderColor: null })
    expect(rowReset({ 'maxW': 'full', 'md:maxW': 'lg' }, 'maxWidth', 'md')).toEqual({ 'md:maxW': null })
    expect(rowReset({ rounded: 'lg', roundedTl: 'sm', roundedBr: 'md' }, 'corners', undefined)).toEqual({ roundedTl: null, roundedBr: null })
  })

  it('tells whether a row is overridden on the device, by any of its keys', () => {
    expect(rowProvenance({ 'p': '4', 'md:pt': '2' }, 'padding', 'tablet')).toEqual({ state: 'set', key: 'md:pt', value: '2' })
    expect(rowProvenance({ p: '4' }, 'padding', 'tablet')).toEqual({ state: 'inherited', value: '4', from: undefined })
    expect(rowProvenance({}, 'margin', 'mobile')).toEqual({ state: 'unset' })
  })

  it('resets the layout: the Layout tokens and the Type display set at the edited breakpoint', () => {
    const style = { 'gap': '4', 'md:gap': '6', 'md:direction': 'row', 'md:px': '2', 'md:display': 'grid', 'md:cols': '3', 'md:bg': 'x', 'w': 'full' }
    expect(layoutReset(style, 'tablet')).toEqual({ 'md:gap': null, 'md:direction': null, 'md:px': null, 'md:display': null, 'md:cols': null })
    // Hiding is the Visible row's, not the layout's.
    expect(layoutReset({ 'display': 'hidden', 'items': 'center', 'md:items': 'end' }, 'mobile')).toEqual({ items: null })
    expect(layoutReset({ w: 'full' }, 'mobile')).toEqual({})
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

describe('border split toggle', () => {
  it('edits per side once one of those tokens is set', () => {
    expect(splitMode({ border: '1' }, 'border')).toBe('all')
    expect(splitMode({ borderB: '2' }, 'border')).toBe('split')
  })

  it('joins back to one value: the first set side, clearing the others', () => {
    expect(joinSplit({ border: '1', borderR: '2', borderL: '4' }, 'border')).toEqual({ border: '2', borderR: null, borderL: null })
    expect(joinSplit({ borderL: '4' }, 'border')).toEqual({ border: '4', borderL: null })
    expect(joinSplit({ border: '1' }, 'border')).toEqual({})
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
