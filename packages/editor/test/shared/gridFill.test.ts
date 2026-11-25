import { describe, expect, it } from 'vitest'
import type { ModelNode } from '@bildr/codegen/model'
import { emptyCells } from '../../src/shared/gridFill.ts'

const grid = (style: Record<string, string>, children: Record<string, string>[], type = 'Container'): ModelNode =>
  ({ id: 'g', type, style, children: children.map((childStyle, i) => ({ id: `c${i}`, type: 'Text', style: childStyle })) }) as ModelNode

describe('Fill cells (layout-containers L6)', () => {
  it('counts the cells left in a grid\'s last row at the device', () => {
    const style = { 'display': 'grid', 'cols': '1', 'md:cols': '3' }
    expect(emptyCells(grid(style, [{}, {}]), 'tablet', 'mobile')).toBe(1)
    expect(emptyCells(grid(style, [{}, {}]), 'mobile', 'mobile')).toBe(0)
    expect(emptyCells(grid(style, [{}, { 'md:colSpan': '2' }]), 'tablet', 'mobile')).toBe(0)
    expect(emptyCells(grid({ display: 'grid', cols: '2', rows: '2' }, []), 'mobile', 'mobile')).toBe(4)
  })

  it('leaves out positioned children, and has none for no grid, auto-fit columns or an Overlay', () => {
    expect(emptyCells(grid({ display: 'grid', cols: '3' }, [{ position: 'absolute' }, {}]), 'mobile', 'mobile')).toBe(2)
    expect(emptyCells(grid({ direction: 'row' }, [{}]), 'mobile', 'mobile')).toBe(0)
    expect(emptyCells(grid({ display: 'grid', cols: 'auto-fit' }, [{}]), 'mobile', 'mobile')).toBe(0)
    expect(emptyCells(grid({ display: 'grid', cols: '3', overlay: 'stack' }, [{}]), 'mobile', 'mobile')).toBe(0)
    // A legacy Grid is a grid without a display token.
    expect(emptyCells(grid({ cols: '2' }, [{}], 'Grid'), 'mobile', 'mobile')).toBe(1)
  })
})
