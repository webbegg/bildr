import { parseStyleKey } from '../design/tokens'
import { spacingBasePx } from '../design/theme'
import type { Theme } from '../design/theme'

/**
 * Stepping through a token's scale, for the scrubbers and arrow keys of the
 * style panel. Tokens store scale values, not lengths, so a step moves to the
 * next value of the registry rather than adding a number.
 */

/** Stops a Shift step or Shift scrub moves per plain one. */
export const SHIFT_STOPS = 4

const isNumber = (value: string) => value.trim() !== '' && !Number.isNaN(Number(value))

/** The values of a token key (breakpoint-prefixed or not) in registry order; empty for unknown keys. */
export function scaleValues(key: string): string[] {
  return parseStyleKey(key)?.token.values ?? []
}

/**
 * The stops a scrub, an arrow key or a slider moves through: a scale with
 * numbers steps through them only (`auto` and `full` are picked, not stepped
 * to); a scale of words steps through all of it.
 */
export function scaleStops(key: string): string[] {
  const values = scaleValues(key)
  const numbers = values.filter(isNumber).sort((a, b) => Number(a) - Number(b))
  return numbers.length ? numbers : values
}

// What an unset token renders as, when that is not the scale's first stop.
const UNSET_DEFAULTS: Record<string, string> = { opacity: '100' }

/** The value an unset token (breakpoint-prefixed or not) renders as, if the scale has one, e.g. `100` for `opacity`. */
export function unsetValue(key: string): string | undefined {
  const base = parseStyleKey(key)?.token.key
  return base ? UNSET_DEFAULTS[base] : undefined
}

/**
 * The value `delta` stops from `value`, clamped at both ends of the scale.
 * An unset value counts as its `unsetValue`; else an unset spacing value as
 * `0`, any other unset (or unsteppable) value as the first stop.
 */
export function stepScale(key: string, value: string | undefined, delta: number): string | undefined {
  const values = scaleStops(key)
  if (!values.length) return undefined
  return values[Math.min(values.length - 1, Math.max(0, stopIndex(key, value) + delta))]
}

/** The stop a value sits at, for a slider: an unset value at its `unsetValue`, else at `0` or the first stop. */
export function stopIndex(key: string, value: string | undefined): number {
  const values = scaleStops(key)
  value ??= unsetValue(key)
  const at = value === undefined ? -1 : values.indexOf(value)
  return at >= 0 ? at : Math.max(0, parseStyleKey(key)?.token.group === 'Spacing' ? values.indexOf('0') : 0)
}

// Tokens whose numbers multiply the theme's `--spacing` (`min-h-32` too).
const SPACING_SIZES = ['w', 'minW', 'minH', 'maxH']
const usesSpacing = (key: string) => {
  const token = parseStyleKey(key)?.token
  return token?.group === 'Spacing' || SPACING_SIZES.includes(token?.key ?? '')
}

const px = (n: number) => `${Number(n.toFixed(2))}px`

/** The size of a spacing-scale value at the project density, e.g. `40px` for `mt` = `10`. */
export function scalePx(key: string, value: string, spacing: Theme['spacing']): string | undefined {
  if (!usesSpacing(key) || !isNumber(value)) return undefined
  return px(Number(value) * spacingBasePx(spacing))
}

/** A typed value as a scale value: the value itself (any case), or a px size that is on the scale. */
export function parseScaleInput(key: string, raw: string, spacing: Theme['spacing']): string | undefined {
  const text = raw.trim().toLowerCase()
  if (!text) return undefined
  const values = scaleValues(key)
  return values.find(v => v.toLowerCase() === text)
    ?? (text.endsWith('px') ? values.find(v => scalePx(key, v, spacing) === px(Number.parseFloat(text))) : undefined)
}
