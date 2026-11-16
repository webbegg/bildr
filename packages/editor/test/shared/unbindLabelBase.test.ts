import { describe, expect, it } from 'vitest'
import type { PropertyDef } from '@bildr/codegen/model'
import { unbindLabel } from '../../src/shared/bindingDot.ts'

const property: PropertyDef = { id: 'pad', name: 'pad', kind: 'text' }

describe('unbindLabel per breakpoint base', () => {
  it('reads "down" for a desktop-first breakpoint and "up" for a mobile-first one', () => {
    expect(unbindLabel({ kind: 'unbind', key: 'max-lg:p', property, scope: 'cascade' }, 'property')).toBe('Unbind property from max-lg down')
    expect(unbindLabel({ kind: 'unbind', key: 'md:p', property, scope: 'cascade' }, 'property')).toBe('Unbind property from md up')
  })
})
