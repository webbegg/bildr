import { describe, expect, it } from 'vitest'
import { structuralStyle } from '#shared/document/components'
import { styleClasses } from '#shared/design/tokens'

const classes = (type: string, style: Record<string, string>) => styleClasses({ ...structuralStyle(type), ...style }).split(' ')

describe('flex direction', () => {
  it('stacks Page, Container, Column, Form and Card, and lays a Row out in a row', () => {
    for (const type of ['Page', 'Container', 'Column', 'Form', 'Card']) expect(structuralStyle(type)).toEqual({ direction: 'col' })
    expect(structuralStyle('Row')).toEqual({ direction: 'row' })
    expect(structuralStyle('Grid')).toEqual({})
    expect(structuralStyle('Text')).toEqual({})
  })

  it('lets a direction token replace the structural direction', () => {
    expect(classes('Column', {})).toContain('flex-col')
    expect(classes('Column', { direction: 'row' })).toEqual(['flex-row'])
    expect(classes('Row', { direction: 'col-reverse' })).toEqual(['flex-col-reverse'])
  })

  it('keeps the structural direction below a breakpoint direction', () => {
    expect(classes('Container', { 'md:direction': 'row' })).toEqual(['flex-col', 'md:flex-row'])
  })
})
