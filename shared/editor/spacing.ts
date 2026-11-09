import { BREAKPOINTS, styleKey } from '../design/tokens'
import type { Breakpoint } from '../design/tokens'

/**
 * The spacing box: which key a side's value comes from, and which keys a drag
 * or an edit writes. bildr stores spacing the Tailwind way, as all-sides
 * (`m`), axis (`my`, `mx`) and side (`mt`) tokens; within one breakpoint the
 * narrowest wins, and a larger breakpoint wins over every key below it.
 */

export type SpacingBox = 'm' | 'p'
export type Side = 'top' | 'right' | 'bottom' | 'left'
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

/** What a drag writes: the side, its axis (Alt: the side and its opposite), or all four (Shift). */
export type SpacingScope = 'side' | 'axis' | 'all'

const SIDE_LETTER: Record<Side, string> = { top: 't', right: 'r', bottom: 'b', left: 'l' }
const AXIS_LETTER: Record<Side, string> = { top: 'y', bottom: 'y', left: 'x', right: 'x' }

export const sideKey = (box: SpacingBox, side: Side): string => `${box}${SIDE_LETTER[side]}`
export const axisKey = (box: SpacingBox, side: Side): string => `${box}${AXIS_LETTER[side]}`

const scopeKey = (box: SpacingBox, side: Side, scope: SpacingScope) =>
  scope === 'side' ? sideKey(box, side) : scope === 'axis' ? axisKey(box, side) : box

export interface SpacingSideValue {
  value: string
  /** The style key the value comes from, e.g. `md:my`. */
  key: string
  /** Its base key: the side's own (`mt`) or a shorthand (`my`, `m`). */
  via: string
  /** `set` at the edited breakpoint, or `inherited` from a smaller one. */
  state: 'set' | 'inherited'
}

/** The value a side has at a breakpoint, and where it comes from; undefined when nothing sets it. */
export function spacingSide(style: Record<string, string>, box: SpacingBox, side: Side, breakpoint: Breakpoint | undefined): SpacingSideValue | undefined {
  const ranks: (Breakpoint | undefined)[] = [undefined, ...BREAKPOINTS]
  for (let at = ranks.indexOf(breakpoint); at >= 0; at--) {
    for (const via of [sideKey(box, side), axisKey(box, side), box]) {
      const key = styleKey(via, ranks[at])
      const value = style[key]
      if (value !== undefined) return { value, key, via, state: ranks[at] === breakpoint ? 'set' : 'inherited' }
    }
  }
  return undefined
}

export function dragScope(modifiers: { shiftKey: boolean, altKey: boolean }): SpacingScope {
  return modifiers.shiftKey ? 'all' : modifiers.altKey ? 'axis' : 'side'
}

/**
 * The patch that sets a side's scope to `value` at a breakpoint. The narrower
 * keys the node sets at that breakpoint are cleared, or they would keep
 * overriding some of the sides the write is meant to move.
 */
export function spacingWrite(style: Record<string, string>, box: SpacingBox, side: Side, scope: SpacingScope, breakpoint: Breakpoint | undefined, value: string): Record<string, string | null> {
  const narrower = scope === 'all'
    ? [`${box}x`, `${box}y`, ...SIDES.map(s => sideKey(box, s))]
    : scope === 'axis'
      ? SIDES.filter(s => AXIS_LETTER[s] === AXIS_LETTER[side]).map(s => sideKey(box, s))
      : []
  const patch: Record<string, string | null> = { [styleKey(scopeKey(box, side, scope), breakpoint)]: value }
  for (const base of narrower) {
    const key = styleKey(base, breakpoint)
    if (style[key] !== undefined) patch[key] = null
  }
  return patch
}
