import { getStyleToken } from '../design/tokens'

/**
 * Framer's size modes over the size tokens: Fixed (a number on the scale),
 * Fit (`fit`), Fill (`full`) and Relative (a fraction, or `screen`). Height is
 * the `minH` token, as bildr has no height token: it has no `fit`, so Fit
 * clears it (an unset minimum height is the content's). Width has no numeric
 * scale, so it has no Fixed mode.
 */

export type SizeKey = 'w' | 'minH'
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
  return (['fixed', 'fit', 'fill', 'relative'] as const).filter(mode => (key === 'minH' && mode === 'fit') || sizeModeValues(key, mode).length > 0)
}

/** The mode of a token value; undefined for a value no mode has (`auto`), or an unset width. */
export function sizeMode(key: SizeKey, value: string | undefined): SizeMode | undefined {
  if (value === undefined) return key === 'minH' ? 'fit' : undefined
  return sizeModes(key).find(mode => sizeModeValues(key, mode).includes(value))
}

// The value a mode starts at when the current one does not fit it.
const DEFAULTS: Record<SizeKey, Partial<Record<SizeMode, string>>> = {
  w: { relative: '1/2' },
  minH: { fixed: '32', relative: 'screen' }
}

/** The token a mode writes: `value` when it belongs to the mode, else the mode's default; null clears the token. */
export function sizeModeValue(key: SizeKey, mode: SizeMode, value: string | undefined): string | null {
  const fits = sizeModeValues(key, mode)
  if (!fits.length) return null
  if (value !== undefined && fits.includes(value)) return value
  return DEFAULTS[key][mode] ?? fits[0]!
}
