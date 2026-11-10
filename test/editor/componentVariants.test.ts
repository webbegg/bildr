import { describe, expect, it } from 'vitest'
import type { ComponentDefinition, DocNode, Variant } from '#shared/document/schema'
import {
  activeVariant,
  applyVariant,
  instanceVariantValue,
  isOverridden,
  newVariantName,
  overrideEntries,
  PRIMARY_VARIANT,
  resetOverrides,
  variantItems
} from '../../app/composables/componentVariants'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })

const dark: Variant = { id: 'dark', name: 'Dark', overrides: { 'c-title': { props: { text: 'Night' }, style: { color: 'primary' } }, 'c-root': { style: { p: '8' } } } }

function card(): ComponentDefinition {
  return {
    id: 'card',
    name: 'Card',
    root: n('c-root', 'Card', {}, [n('c-title', 'Heading', { text: 'Day', level: '2' }, [], { color: 'muted' }), n('c-body', 'Container')], { p: '4' }),
    properties: [],
    variants: [dark, { id: 'big', name: 'Big', overrides: {} }]
  }
}

describe('applyVariant', () => {
  it('renders the definition with the variant overrides, keeping the definition ids', () => {
    const def = card()
    const root = applyVariant(def.root, dark)
    expect(root.id).toBe('c-root')
    expect(root.style).toEqual({ p: '8' })
    expect(root.children[0]).toEqual(n('c-title', 'Heading', { text: 'Night', level: '2' }, [], { color: 'primary' }))
    expect(root.children[1]).toEqual(def.root.children[1])
    // The definition itself is untouched.
    expect(def).toEqual(card())
  })

  it('is the definition itself for the primary', () => {
    const def = card()
    expect(applyVariant(def.root, null)).toBe(def.root)
  })

  it('resolves bound props in the runtime order: variant override, else stored default, else the node\'s own value', () => {
    const def = card()
    def.root.children.push(n('c-sub', 'Text', { text: 'Own sub' }))
    def.properties = [
      { id: 'title', name: 'Title', kind: 'text', default: 'Stored', bindings: [{ nodeId: 'c-title', prop: 'text' }] },
      { id: 'level', name: 'Level', kind: 'select', default: '4', bindings: [{ nodeId: 'c-title', prop: 'level' }] },
      { id: 'sub', name: 'Sub', kind: 'text', bindings: [{ nodeId: 'c-sub', prop: 'text' }] }
    ]
    const variant = applyVariant(def.root, dark, def.properties)
    expect(variant.children[0]!.props).toEqual({ text: 'Night', level: '4' })
    expect(variant.children[2]!.props.text).toBe('Own sub')
    const primary = applyVariant(def.root, null, def.properties)
    expect(primary.children[0]!.props).toEqual({ text: 'Stored', level: '4' })
    expect(primary.children[2]!.props.text).toBe('Own sub')
    expect(def.root.children[0]!.props).toEqual({ text: 'Day', level: '2' })
  })
})

describe('overrides of a node', () => {
  it('lists what a variant overrides on a node, props then style', () => {
    expect(overrideEntries(dark, 'c-title')).toEqual([
      { kind: 'props', key: 'text', value: 'Night' },
      { kind: 'style', key: 'color', value: 'primary' }
    ])
    expect(overrideEntries(dark, 'c-body')).toEqual([])
    expect(overrideEntries(null, 'c-title')).toEqual([])
  })

  it('tells whether one field is overridden', () => {
    expect(isOverridden(dark, 'c-title', 'props', 'text')).toBe(true)
    expect(isOverridden(dark, 'c-title', 'props', 'level')).toBe(false)
    expect(isOverridden(dark, 'c-root', 'style', 'p')).toBe(true)
    expect(isOverridden(null, 'c-root', 'style', 'p')).toBe(false)
  })

  it('resets overrides with nulls, which remove them (variants stay sparse)', () => {
    expect(resetOverrides(overrideEntries(dark, 'c-title'))).toEqual({ props: { text: null }, style: { color: null } })
    expect(resetOverrides([{ kind: 'style', key: 'p', value: '8' }])).toEqual({ style: { p: null } })
  })
})

describe('variant choices', () => {
  it('finds the active variant, falling back to the primary for a missing one', () => {
    expect(activeVariant(card(), 'dark')?.name).toBe('Dark')
    expect(activeVariant(card(), 'gone')).toBeNull()
    expect(activeVariant(card(), null)).toBeNull()
    expect(activeVariant(null, 'dark')).toBeNull()
  })

  it('offers Primary and each variant to instances, Primary as an empty variant', () => {
    expect(variantItems(card())).toEqual([
      { label: 'Primary', value: PRIMARY_VARIANT },
      { label: 'Dark', value: 'dark' },
      { label: 'Big', value: 'big' }
    ])
    expect(instanceVariantValue(PRIMARY_VARIANT)).toBe('')
    expect(instanceVariantValue('dark')).toBe('dark')
  })

  it('names a new variant after the ones there are', () => {
    expect(newVariantName({ ...card(), variants: [] })).toBe('Variant 1')
    expect(newVariantName(card())).toBe('Variant 3')
    expect(newVariantName({ ...card(), variants: [{ id: 'a', name: 'Variant 3', overrides: {} }] })).toBe('Variant 2')
  })
})
