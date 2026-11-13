import { describe, expect, it } from 'vitest'
import * as render from '@bildr/codegen/render'
import { COMPONENTS, isFlexType, PAGE_ROOT_TYPE, structuralStyle } from '#shared/document/components'

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
})
