import { describe, expect, it } from 'vitest'
import {
  CARD_DEFAULT_STYLE,
  CARD_STACK_KEYS,
  CONTAINER_TAGS,
  DEFAULT_HEADING_LEVEL,
  displayOf,
  HEADING_TOKENS,
  headingTag,
  IMAGE_FALLBACK_STYLE,
  INPUT_CONTROL_CLASS,
  isFlexType,
  KNOWN_DIVERGENCES,
  NODE_ELEMENTS,
  structuralStyle,
  TEXT_CLASS
} from '../../src/render/index.ts'

// The render rules (spec V4, S10): what the generator and the canvas both need per node type.
describe('render rules', () => {
  it('lays flex containers out in their direction', () => {
    expect(structuralStyle('Row')).toEqual({ direction: 'row' })
    for (const type of ['Page', 'Container', 'Column', 'Form', 'Card']) expect(structuralStyle(type)).toEqual({ direction: 'col' })
    expect(structuralStyle('Grid')).toEqual({})
    expect(structuralStyle('Text')).toEqual({})
    expect(['Row', 'Page', 'Card'].every(isFlexType)).toBe(true)
    expect(isFlexType('Grid')).toBe(false)
  })

  it('gives each layout type its display fallback', () => {
    expect(displayOf('Row')).toBe('flex')
    expect(displayOf('Container')).toBe('flex')
    expect(displayOf('Grid')).toBe('grid')
    expect(displayOf('Image')).toBe('block')
    expect(displayOf('Text')).toBe('')
  })

  it('names the element of each type', () => {
    expect(headingTag(DEFAULT_HEADING_LEVEL)).toBe('h2')
    expect(headingTag(5)).toBe('h5')
    expect(NODE_ELEMENTS).toMatchObject({ Text: 'p', Button: 'UButton', Checkbox: 'UCheckbox', Form: 'form', Link: 'NuxtLink', Input: 'UFormField', InputControl: 'UInput', InputMultiline: 'UTextarea' })
    expect(CONTAINER_TAGS[0]).toBe('div')
    expect(INPUT_CONTROL_CLASS).toBe('w-full')
  })

  it('holds the token fallbacks of headings, text, cards and images', () => {
    expect(HEADING_TOKENS[1]).toEqual({ text: '4xl', font: 'bold', tracking: 'tight' })
    expect(HEADING_TOKENS[4]).toEqual({ text: 'xl', font: 'semibold' })
    expect(TEXT_CLASS).toBe('whitespace-pre-line')
    expect(CARD_DEFAULT_STYLE).toEqual({ p: '6' })
    expect(CARD_STACK_KEYS).toEqual(['direction', 'flexWrap', 'gap', 'items', 'justify'])
    expect(IMAGE_FALLBACK_STYLE).toEqual({ maxW: 'full' })
  })

  it('records every known generator/canvas disagreement once, with both sides', () => {
    const ids = KNOWN_DIVERGENCES.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of KNOWN_DIVERGENCES) {
      expect(entry.types.length).toBeGreaterThan(0)
      expect(entry.generator).not.toBe('')
      expect(entry.canvas).not.toBe('')
    }
    expect(ids).toContain('container-direction')
  })
})
