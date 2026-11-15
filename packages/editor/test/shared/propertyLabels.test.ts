import { describe, expect, it } from 'vitest'
import type { PropertyDef } from '@bildr/codegen/model'
import { PROPERTY_KINDS } from '../../../codegen/src/model/schemas.ts'
import { detailPatch, propertiesTitle, propertyLabel, takesPlaceholder, targetLabel } from '../../src/shared/propertyLabels.ts'

/** Ported from the hosted `propertyLabels.test.ts` and the "properties modal labels" of `instanceMenus.test.ts`, over the model's property kinds. */

const prop = (kind: (typeof PROPERTY_KINDS)[number], bindings: { nodeId: string, prop: string, target?: 'style' }[] = [], many?: boolean) => ({ kind, bindings, ...(many ? { many } : {}) })

describe('propertyLabel', () => {
  it('names a property row by what it sets, not by its kind', () => {
    expect(propertyLabel(prop('text'))).toBe('Text')
    expect(propertyLabel(prop('textarea'))).toBe('Text')
    expect(propertyLabel(prop('number'))).toBe('Number')
    expect(propertyLabel(prop('boolean'))).toBe('Toggle')
    expect(propertyLabel(prop('select'))).toBe('Option')
    expect(propertyLabel(prop('slot', [{ nodeId: 'n1', prop: 'children' }]))).toBe('Slot')
  })

  it('names the module\'s entity kinds: a record, a list of them, a field', () => {
    expect(propertyLabel(prop('entity'))).toBe('Record')
    expect(propertyLabel(prop('entity', [], true))).toBe('List')
    expect(propertyLabel(prop('field'))).toBe('Field')
  })

  it('names a style property after the style key it drives', () => {
    expect(propertyLabel(prop('select', [{ nodeId: 'n1', prop: 'bg', target: 'style' }]))).toBe('Style · bg')
    expect(propertyLabel(prop('text', [{ nodeId: 'n1', prop: 'md:p', target: 'style' }]))).toBe('Style · md:p')
  })

  it('names a property that has no bindings at all', () => {
    expect(propertyLabel({ kind: 'text' })).toBe('Text')
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

describe('properties modal labels', () => {
  it('titles the modal "<Component> properties" or "<Layout> variables"', () => {
    expect(propertiesTitle('component', 'Card')).toBe('Card properties')
    expect(propertiesTitle('layout', 'Site layout')).toBe('Site layout variables')
  })

  it('turns a field edit into an update patch: an empty text removes it', () => {
    expect(detailPatch('description', '  The title ')).toEqual({ description: 'The title' })
    expect(detailPatch('description', '   ')).toEqual({ description: null })
    expect(detailPatch('placeholder', '')).toEqual({ placeholder: null })
    expect(detailPatch('optional', true)).toEqual({ optional: true })
    expect(detailPatch('optional', false)).toEqual({ optional: null })
  })

  it('offers a placeholder for text kinds only', () => {
    expect(PROPERTY_KINDS.filter(kind => takesPlaceholder(kind as PropertyDef['kind']))).toEqual(['text', 'textarea', 'image', 'link'])
  })
})
