import { getStyleToken } from '@bildr/codegen/design'

/**
 * Framer's size modes over the size tokens: Fixed (a number on the scale),
 * Fit (`fit`), Fill (`full`) and Relative (a fraction, or `screen`). An unset
 * or `auto` size has no mode.
 */

export type SizeKey = 'w' | 'h'
export type SizeMode = 'fixed' | 'fit' | 'fill' | 'relative'

export const SIZE_MODE_LABELS: Record<SizeMode, string> = { fixed: 'Fixed', fit: 'Fit', fill: 'Fill', relative: 'Relative' }

const RELATIVE = ['1/2', '1/3', '2/3', '1/4', '3/4', 'screen']
const isNumber = (value: string) => value.trim() !== '' && !Number.isNaN(Number(value))
const values = (key: SizeKey) => getStyleToken(key)!.values

/** The scale values of a mode, in registry order. */
export function sizeModeValues(key: SizeKey, mode: SizeMode): string[] {
  const all = values(key)
  if (mode === 'fixed') return all.filter(isNumber)
  if (mode === 'fit') return all.filter(v => v === 'fit')
  if (mode === 'fill') return all.filter(v => v === 'full')
  return all.filter(v => RELATIVE.includes(v))
}

/** The modes a size token offers. */
export function sizeModes(key: SizeKey): SizeMode[] {
  return (['fixed', 'fit', 'fill', 'relative'] as const).filter(mode => sizeModeValues(key, mode).length > 0)
}

/** The mode of a token value; undefined for a value no mode has (`auto`), or an unset size. */
export function sizeMode(key: SizeKey, value: string | undefined): SizeMode | undefined {
  if (value === undefined) return undefined
  return sizeModes(key).find(mode => sizeModeValues(key, mode).includes(value))
}

// The value a mode starts at when the current one does not fit it.
const DEFAULTS: Record<SizeKey, Partial<Record<SizeMode, string>>> = {
  w: { fixed: '64', relative: '1/2' },
  h: { fixed: '64', relative: 'screen' }
}

/**
 * The greyed value of a W or H field whose size is not a number (unset,
 * `auto`, Fit or Fill): the measured box size in px, rounded, as Framer shows
 * it. Undefined for a Fixed or Relative size, without a measure, or when the
 * selected nodes measure differently.
 */
export function measuredSize(key: SizeKey, value: string | undefined, sizes: readonly number[]): string | undefined {
  const mode = sizeMode(key, value)
  if (mode === 'fixed' || mode === 'relative') return undefined
  const rounded = [...new Set(sizes.map(Math.round))]
  return rounded.length === 1 && Number.isFinite(rounded[0]) ? String(rounded[0]) : undefined
}

/** The token a mode (one of `sizeModes`) writes: `value` when it belongs to the mode, else the mode's default. */
export function sizeModeValue(key: SizeKey, mode: SizeMode, value: string | undefined): string {
  const fits = sizeModeValues(key, mode)
  if (value !== undefined && fits.includes(value)) return value
  return DEFAULTS[key][mode] ?? fits[0]!
}
