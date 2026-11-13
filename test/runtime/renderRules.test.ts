import { describe, expect, it } from 'vitest'
import * as render from '@bildr/codegen/render'
import { COMPONENTS, getComponent, isFlexType, PAGE_ROOT_TYPE, structuralStyle } from '#shared/document/components'

// The hosted registry still carries its own copy of the layout rules (shared/document is
// adapted in P3); until it re-exports @bildr/codegen/render, the two must agree.
describe('render rules: hosted registry parity', () => {
  const types = [PAGE_ROOT_TYPE, ...COMPONENTS.map(component => component.type), 'Instance', 'SlotFill']

  it('lays out every type the same way', () => {
    for (const type of types) {
      expect(render.structuralStyle(type), type).toEqual(structuralStyle(type))
      expect(render.isFlexType(type), type).toBe(isFlexType(type))
    }
  })

  // P2a (E3): the canvas renders with the generator's rules, so every value the hosted inspector
  // offers is one the generator accepts and renders the same way.
  const options = (type: string, prop: string) => getComponent(type)?.props.find(entry => entry.name === prop)?.options ?? []
  it('offers only prop values the generator renders', () => {
    for (const level of options('Heading', 'level')) expect(render.headingLevel(level), level).toBe(Number(level))
    expect(options('List', 'layout')).toEqual([...render.LIST_LAYOUTS])
    for (const [prop, values] of [['color', render.BUTTON_COLORS], ['variant', render.BUTTON_VARIANTS], ['size', render.BUTTON_SIZES]] as const) {
      expect(options('Button', prop).length, prop).toBeGreaterThan(0)
      for (const value of options('Button', prop)) expect(values, `${prop} ${value}`).toContain(value)
    }
    for (const value of options('Input', 'inputType')) expect(render.INPUT_TYPES, value).toContain(value)
  })

  it('reads the canvas\'s string props the way the generator reads the model\'s', () => {
    expect(render.headingLevel('9')).toBeUndefined()
    expect(render.fallbackStyle('Row', { wrap: true })).toEqual({ direction: 'row', flexWrap: 'wrap' })
    expect(render.displayOf('List', { layout: 'grid' })).toBe('grid')
    expect(render.childrenInStack('List', { layout: 'stack' })).toBe(true)
    expect(render.containerTag('')).toBe('div')
  })
})
