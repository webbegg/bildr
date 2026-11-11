import { CUSTOM_COLOR_NAME, isColorTokenValue, STYLE_HEX } from '../design/tokens'

/**
 * Colour conversions for the editor's colour picker: hex ↔ RGBA ↔ HSVA, the
 * OKLCH swatches of the theme as hex (to detach a token to a raw value), and
 * the names of the theme's own colours (`theme.custom`).
 */

/** Channels 0–255, alpha 0–1. */
export interface Rgba { r: number, g: number, b: number, a: number }
/** Hue 0–360, saturation, value and alpha 0–1. */
export interface Hsva { h: number, s: number, v: number, a: number }

/** A `#rgb`, `#rrggbb` or `#rrggbbaa` hex (the shapes colour style keys take) as RGBA; undefined for anything else. */
export function parseHex(hex: string): Rgba | undefined {
  if (!STYLE_HEX.test(hex)) return undefined
  let digits = hex.slice(1)
  if (digits.length === 3) digits = [...digits].map(d => d + d).join('')
  const byte = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16)
  return { r: byte(0), g: byte(2), b: byte(4), a: digits.length === 8 ? byte(6) / 255 : 1 }
}

const clampByte = (n: number) => Math.min(255, Math.max(0, Math.round(n)))
const hexByte = (n: number) => clampByte(n).toString(16).padStart(2, '0')

/** Lowercase `#rrggbb`, or `#rrggbbaa` when alpha is below 1. */
export function rgbaToHex({ r, g, b, a }: Rgba): string {
  const alpha = clampByte(a * 255)
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${alpha < 255 ? hexByte(alpha) : ''}`
}

/** A typed hex, with or without `#`, as a lowercase style hex; undefined when it is not one. */
export function normalizeHex(input: string): string | undefined {
  const trimmed = input.trim()
  const hex = (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toLowerCase()
  return STYLE_HEX.test(hex) ? hex : undefined
}

export function rgbaToHsva({ r, g, b, a }: Rgba): Hsva {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const delta = max - Math.min(rn, gn, bn)
  let h = 0
  if (delta) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
    else h = 60 * ((rn - gn) / delta + 4)
  }
  return { h: h < 0 ? h + 360 : h, s: max ? delta / max : 0, v: max, a }
}

export function hsvaToRgba({ h, s, v, a }: Hsva): Rgba {
  const hue = ((h % 360) + 360) % 360
  const f = (n: number) => {
    const k = (n + hue / 60) % 6
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return { r: f(5), g: f(3), b: f(1), a }
}

export function hexToHsva(hex: string): Hsva | undefined {
  const rgba = parseHex(hex)
  return rgba && rgbaToHsva(rgba)
}

export function hsvaToHex(hsva: Hsva): string {
  return rgbaToHex(hsvaToRgba(hsva))
}

const toSrgb = (linear: number) => 255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055)

/** An OKLCH colour (lightness 0–1, chroma, hue in degrees) as an sRGB hex, out-of-gamut channels clipped. */
export function oklchToHex(l: number, c: number, h: number, alpha = 1): string {
  const rad = (h * Math.PI) / 180
  const A = c * Math.cos(rad)
  const B = c * Math.sin(rad)
  const lms = [
    l + 0.3963377774 * A + 0.2158037573 * B,
    l - 0.1055613458 * A - 0.0638541728 * B,
    l - 0.0894841775 * A - 1.2914855480 * B
  ].map(x => x ** 3) as [number, number, number]
  const [L, M, S] = lms
  return rgbaToHex({
    r: toSrgb(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    g: toSrgb(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    b: toSrgb(-0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S),
    a: alpha
  })
}

const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/
const VAR_FALLBACK = /^var\(\s*--[\w-]+\s*,\s*(.+)\)$/

/**
 * The hex of a CSS colour the theme paints a swatch with (see
 * `colorSwatchRows`): a hex, an `oklch(…)`, or a `var(--x, fallback)` of
 * either. Undefined for what cannot be computed here (a bare `var(…)`).
 */
export function cssColorToHex(css: string): string | undefined {
  const value = css.trim()
  const fallback = VAR_FALLBACK.exec(value)
  if (fallback) return cssColorToHex(fallback[1]!)
  const hex = normalizeHex(value)
  if (hex && value.startsWith('#')) return rgbaToHex(parseHex(hex)!)
  const oklch = OKLCH.exec(value)
  if (!oklch) return undefined
  const l = Number(oklch[1]) / (oklch[2] ? 100 : 1)
  const alpha = oklch[5] === undefined ? 1 : Number(oklch[5]) / (oklch[6] ? 100 : 1)
  return oklchToHex(l, Number(oklch[3]), Number(oklch[4]), alpha)
}

/** A typed name as a theme colour name: lowercase words joined by dashes, starting with a letter (`Brand Orange` → `brand-orange`). */
export function customColorName(input: string): string {
  const slug = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug && !/^[a-z]/.test(slug) ? `c-${slug}` : slug
}

/** Why `name` cannot be a new theme colour, given the `taken` ones; undefined when it can. */
export function customColorNameProblem(name: string, taken: readonly string[]): string | undefined {
  if (!name) return 'Give the colour a name'
  if (!CUSTOM_COLOR_NAME.test(name)) return 'Colour names use lowercase letters, digits and single dashes, starting with a letter (e.g. brand, ink-2)'
  if (isColorTokenValue(name)) return `"${name}" is already a colour token; pick another name`
  return taken.includes(name) ? `The theme already has a colour "${name}"` : undefined
}
