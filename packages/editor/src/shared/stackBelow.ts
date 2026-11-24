import { breakpointsOf, styleKey } from '@bildr/codegen/design'
import type { Breakpoint, BreakpointBase } from '@bildr/codegen/design'

/**
 * A row's "Stack below" (layout-containers L5, the Columns preset): a column
 * on narrow screens and a row from a width up. It is no token of its own but
 * the responsive direction pair: mobile-first `direction: col` with
 * `md:direction: row`, desktop-first `direction: row` with `max-md:direction: col`.
 */

export type StackWidth = 'sm' | 'md' | 'lg'

export const STACK_WIDTHS: readonly StackWidth[] = ['sm', 'md', 'lg']

const breakpointOf = (width: StackWidth, base: BreakpointBase): Breakpoint => (base === 'mobile' ? width : `max-${width}`) as Breakpoint

const directionKeys = (style: Record<string, string>, base: BreakpointBase) =>
  breakpointsOf(base).map(b => styleKey('direction', b)).filter(key => style[key] !== undefined)

/** The width below which the row stacks, when its directions are exactly that pair; else undefined. */
export function stackBelowOf(style: Record<string, string>, base: BreakpointBase): StackWidth | undefined {
  const [narrow, wide] = base === 'mobile' ? ['col', 'row'] : ['row', 'col']
  const keys = directionKeys(style, base)
  if (style.direction !== narrow || keys.length !== 1) return undefined
  const width = STACK_WIDTHS.find(w => keys[0] === styleKey('direction', breakpointOf(w, base)))
  return width && style[keys[0]!] === wide ? width : undefined
}

/** The patch that stacks the row below `width` (null: a row everywhere), clearing the other breakpoints' directions. */
export function stackBelowWrite(style: Record<string, string>, width: StackWidth | null, base: BreakpointBase): Record<string, string | null> {
  const cleared = Object.fromEntries(directionKeys(style, base).map(key => [key, null]))
  if (!width) return { ...cleared, direction: 'row' }
  const key = styleKey('direction', breakpointOf(width, base))
  return base === 'mobile' ? { ...cleared, direction: 'col', [key]: 'row' } : { ...cleared, direction: 'row', [key]: 'col' }
}
