import { BREAKPOINTS, styleKey } from '../design/tokens'
import type { Breakpoint } from '../design/tokens'

/**
 * The spacing box: which key a side's value comes from, and which keys an
 * edit writes. bildr stores spacing the Tailwind way, as all-sides
 * (`m`), axis (`my`, `mx`) and side (`mt`) tokens; within one breakpoint the
 * narrowest wins, and a larger breakpoint wins over every key below it.
 */

export type SpacingBox = 'm' | 'p'
export type Side = 'top' | 'right' | 'bottom' | 'left'
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

/** What a write covers: the side, its axis (the side and its opposite), or all four. */
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

/** The value of each side at a breakpoint, set there or inherited. */
export function boxSides(style: Record<string, string>, box: SpacingBox, breakpoint: Breakpoint | undefined): Record<Side, string | undefined> {
  return Object.fromEntries(SIDES.map(side => [side, spacingSide(style, box, side, breakpoint)?.value])) as Record<Side, string | undefined>
}

/** Whether one value shows for the box (Framer's "all sides"): every side the same, or none set. */
export function boxUniform(style: Record<string, string>, box: SpacingBox, breakpoint: Breakpoint | undefined): boolean {
  return new Set(Object.values(boxSides(style, box, breakpoint))).size === 1
}

/**
 * The patch of a padding or margin field: `all` writes `p`; a side writes its
 * own key, and once the four sides are set at the breakpoint they fold into
 * the fewest keys (`p`, else `px`/`py` when opposite sides match).
 */
export function boxWrite(style: Record<string, string>, box: SpacingBox, breakpoint: Breakpoint | undefined, target: Side | 'all', value: string): Record<string, string | null> {
  if (target === 'all') return spacingWrite(style, box, 'top', 'all', breakpoint, value)
  const own = Object.fromEntries(SIDES.map((side) => {
    const resolved = spacingSide(style, box, side, breakpoint)
    return [side, side === target ? value : resolved?.state === 'set' ? resolved.value : undefined]
  })) as Record<Side, string | undefined>
  if (SIDES.some(side => own[side] === undefined)) return spacingWrite(style, box, target, 'side', breakpoint, value)

  const keys = [box, `${box}x`, `${box}y`, ...SIDES.map(side => sideKey(box, side))].map(base => styleKey(base, breakpoint))
  const patch: Record<string, string | null> = Object.fromEntries(keys.filter(key => style[key] !== undefined).map(key => [key, null]))
  const at = (base: string) => styleKey(base, breakpoint)
  if (new Set(Object.values(own)).size === 1) patch[at(box)] = value
  else if (own.top === own.bottom && own.left === own.right) Object.assign(patch, { [at(`${box}x`)]: own.left, [at(`${box}y`)]: own.top })
  else for (const side of SIDES) patch[at(sideKey(box, side))] = own[side]!
  return patch
}
