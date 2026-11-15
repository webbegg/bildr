import { describe, expect, it } from 'vitest'
import type { ComponentFile } from '@bildr/codegen/model'
import { isOverridden, overrideEntries, resetOverrides } from '../../src/shared/componentVariants.ts'

/** The hosted `componentVariants` helpers the inspector reads (override entries, which edits are overrides and the reset patch), over the model's variants. */

type Variant = ComponentFile['variants'][number]

const variant: Variant = {
  id: 'var_compact',
  name: 'Compact',
  overrides: {
    n_card: { style: { gap: '1' }, unset: ['p'] },
    n_excerpt: { props: { hidden: true } }
  }
} as Variant

describe('overrideEntries', () => {
  it('lists what a variant overrides on a node: props, then tokens, then removed tokens', () => {
    expect(overrideEntries(variant, 'n_card')).toEqual([
      { kind: 'style', key: 'gap', value: '1' },
      { kind: 'style', key: 'p', value: '', removed: true }
    ])
    expect(overrideEntries(variant, 'n_excerpt')).toEqual([{ kind: 'props', key: 'hidden', value: true }])
  })

  it('is empty on the primary variant, and for a node the variant leaves alone', () => {
    expect(overrideEntries(null, 'n_card')).toEqual([])
    expect(overrideEntries(variant, 'n_other')).toEqual([])
  })
})

describe('isOverridden', () => {
  it('is true where the variant sets a prop or a token, or removes a token', () => {
    expect(isOverridden(variant, 'n_card', 'style', 'gap')).toBe(true)
    expect(isOverridden(variant, 'n_card', 'style', 'p')).toBe(true)
    expect(isOverridden(variant, 'n_card', 'style', 'bg')).toBe(false)
    expect(isOverridden(variant, 'n_excerpt', 'props', 'hidden')).toBe(true)
    expect(isOverridden(variant, 'n_excerpt', 'props', 'text')).toBe(false)
    expect(isOverridden(variant, 'n_other', 'props', 'text')).toBe(false)
    expect(isOverridden(null, 'n_card', 'style', 'gap')).toBe(false)
  })
})

describe('resetOverrides', () => {
  it('makes the component_variant_set_override patch that removes the entries (null each)', () => {
    expect(resetOverrides(overrideEntries(variant, 'n_card'))).toEqual({ style: { gap: null, p: null } })
    expect(resetOverrides([{ kind: 'props', key: 'hidden', value: true }, { kind: 'style', key: 'gap', value: '1' }])).toEqual({ props: { hidden: null }, style: { gap: null } })
    expect(resetOverrides([])).toEqual({})
  })
})
