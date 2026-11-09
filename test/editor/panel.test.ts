import { describe, expect, it } from 'vitest'
import { STYLE_TOKENS } from '#shared/design/tokens'
import { PANEL_SECTIONS, paddingMode, panelFields, panelSection, panelSectionMark, sectionAdd, sectionKeys, sectionPresent, sectionRemove, sharedStyle, spacingProvenance } from '#shared/editor/panel'

describe('panel sections', () => {
  it('follows Figma UI3, with the margins box after Layout and every design token in exactly one section', () => {
    expect(PANEL_SECTIONS).toEqual(['Auto layout', 'Layout', 'Spacing', 'Appearance', 'Typography', 'Fill', 'Stroke', 'Effects'])
    const keys = PANEL_SECTIONS.flatMap(sectionKeys)
    expect(keys.sort()).toEqual(STYLE_TOKENS.map(t => t.key).sort())
  })

  it('puts padding and the grid rows in Auto layout, sizes in Layout, margins in Spacing', () => {
    expect(panelSection('gap')).toBe('Auto layout')
    expect(panelSection('md:px')).toBe('Auto layout')
    expect(panelSection('pt')).toBe('Auto layout')
    expect(panelSection('cols')).toBe('Auto layout')
    expect(panelSection('colSpan')).toBe('Auto layout')
    expect(panelSection('w')).toBe('Layout')
    expect(panelSection('lg:maxW')).toBe('Layout')
    expect(panelSection('self')).toBe('Layout')
    expect(panelSection('mx')).toBe('Spacing')
    expect(panelSection('rounded')).toBe('Appearance')
    expect(panelSection('color')).toBe('Typography')
    expect(panelSection('bg')).toBe('Fill')
    expect(panelSection('border')).toBe('Stroke')
    expect(panelSection('borderColor')).toBe('Stroke')
    expect(panelSection('shadow')).toBe('Effects')
    expect(panelSection('bogus')).toBeUndefined()
  })

  it('marks a section blue when the device sets one of its keys, orange when it only inherits', () => {
    const style = { 'px': '4', 'md:w': 'full', 'bg': 'primary' }
    expect(panelSectionMark(style, 'Auto layout', 'mobile')).toBe('set')
    expect(panelSectionMark(style, 'Auto layout', 'tablet')).toBe('inherited')
    expect(panelSectionMark(style, 'Layout', 'tablet')).toBe('set')
    expect(panelSectionMark(style, 'Layout', 'mobile')).toBeUndefined()
    expect(panelSectionMark(style, 'Fill', 'desktop')).toBe('set')
    expect(panelSectionMark(style, 'Stroke', 'mobile')).toBeUndefined()
  })
})

describe('panel fields', () => {
  it('shows auto layout with direction and alignment for a flex container', () => {
    expect(panelFields({ type: 'Column', parentType: 'Page', style: {} })).toEqual({
      sections: ['Auto layout', 'Layout', 'Spacing', 'Appearance', 'Typography', 'Fill', 'Stroke', 'Effects'],
      direction: true,
      align: true,
      gap: true,
      cols: false,
      colSpan: false,
      self: true
    })
  })

  it('shows columns but no direction for a Grid, and no align-self on the page root', () => {
    const grid = panelFields({ type: 'Grid', style: {} })
    expect(grid).toMatchObject({ direction: false, align: false, gap: true, cols: true })
    expect(panelFields({ type: 'Page', root: true, style: {} }).self).toBe(false)
  })

  it('hides Auto layout for a leaf, unless the leaf sets one of its tokens', () => {
    const text = panelFields({ type: 'Text', parentType: 'Column', style: {} })
    expect(text.sections).not.toContain('Auto layout')
    expect(text.sections[0]).toBe('Layout')
    const padded = panelFields({ type: 'Button', parentType: 'Column', style: { 'md:px': '4' } })
    expect(padded.sections).toContain('Auto layout')
    expect(padded.gap).toBe(false)
  })

  it('offers a column span to the children of a Grid or List', () => {
    const child = panelFields({ type: 'Card', parentType: 'Grid', style: {} })
    expect(child.colSpan).toBe(true)
    expect(panelFields({ type: 'Text', parentType: 'Grid', style: {} }).sections).toContain('Auto layout')
  })
})

describe('fill, stroke and effects', () => {
  it('adds a sensible default token for each', () => {
    expect(sectionAdd('Fill')).toEqual({ bg: 'neutral-100' })
    expect(sectionAdd('Stroke')).toEqual({ border: '1', borderColor: 'default' })
    expect(sectionAdd('Effects')).toEqual({ shadow: 'md' })
    expect(sectionAdd('Layout')).toBeUndefined()
  })

  it('is present while one of its tokens applies', () => {
    expect(sectionPresent({}, 'Fill', 'mobile')).toBe(false)
    expect(sectionPresent({ bg: 'muted' }, 'Fill', 'tablet')).toBe(true)
    expect(sectionPresent({ borderColor: 'primary' }, 'Stroke', 'mobile')).toBe(true)
    expect(sectionPresent({ shadow: 'none' }, 'Effects', 'mobile')).toBe(true)
  })

  it('removes every key of the section, and nothing else', () => {
    expect(sectionRemove({ border: '2', borderColor: 'primary', bg: 'muted' }, 'Stroke')).toEqual({ border: null, borderColor: null })
    expect(sectionRemove({ bg: 'muted' }, 'Effects')).toEqual({})
  })
})

describe('padding fields', () => {
  it('edits per side once a side token applies at the breakpoint, else horizontal and vertical', () => {
    expect(paddingMode({}, undefined)).toBe('axes')
    expect(paddingMode({ px: '4', py: '2', p: '1' }, undefined)).toBe('axes')
    expect(paddingMode({ pt: '4' }, undefined)).toBe('sides')
    expect(paddingMode({ pt: '4' }, 'md')).toBe('sides')
    expect(paddingMode({ 'md:pl': '4' }, undefined)).toBe('axes')
    expect(paddingMode({ 'md:pl': '4' }, 'lg')).toBe('sides')
  })

  it('tells where a side value comes from, set at the breakpoint or inherited', () => {
    const style = { 'p': '2', 'md:px': '6' }
    expect(spacingProvenance(style, 'p', 'left', undefined)).toEqual({ state: 'set', key: 'p', value: '2' })
    expect(spacingProvenance(style, 'p', 'left', 'md')).toEqual({ state: 'set', key: 'md:px', value: '6' })
    expect(spacingProvenance(style, 'p', 'top', 'md')).toEqual({ state: 'inherited', value: '2', from: undefined })
    expect(spacingProvenance(style, 'p', 'top', 'lg')).toEqual({ state: 'inherited', value: '2', from: undefined })
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
