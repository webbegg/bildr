import { describe, expect, it } from 'vitest'
import { PROPERTY_KINDS } from '#shared/document/schema'
import { propertyLabel, targetLabel } from '#shared/editor/propertyLabels'

const prop = (kind: (typeof PROPERTY_KINDS)[number], bindings: { nodeId: string, prop: string, target?: 'style' }[] = []) => ({ kind, bindings })

describe('propertyLabel', () => {
  it('names a property row by what it sets, not by its kind', () => {
    expect(propertyLabel(prop('text'))).toBe('Text')
    expect(propertyLabel(prop('textarea'))).toBe('Text')
    expect(propertyLabel(prop('number'))).toBe('Number')
    expect(propertyLabel(prop('boolean'))).toBe('Toggle')
    expect(propertyLabel(prop('select'))).toBe('Option')
    expect(propertyLabel(prop('slot', [{ nodeId: 'n1', prop: 'children' }]))).toBe('Slot')
  })

  it('names a style property after the style key it drives', () => {
    expect(propertyLabel(prop('select', [{ nodeId: 'n1', prop: 'bg', target: 'style' }]))).toBe('Style · bg')
    expect(propertyLabel(prop('text', [{ nodeId: 'n1', prop: 'md:p', target: 'style' }]))).toBe('Style · md:p')
  })

  it('never shows a raw kind name', () => {
    for (const kind of PROPERTY_KINDS) {
      const label = propertyLabel(prop(kind))
      expect(label).not.toBe(kind)
      expect(label[0]).toBe(label[0]!.toUpperCase())
    }
  })
})

describe('targetLabel', () => {
  it('is the type of an unnamed node, and the layer name with its type otherwise', () => {
    expect(targetLabel({ type: 'Container' })).toBe('Container')
    expect(targetLabel({ type: 'Container', name: 'Footer' })).toBe('Footer (Container)')
  })
})
