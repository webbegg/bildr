import { BREAKPOINTS, orderedStyleTokens, parseStyleKey, STYLE_TOKEN_GROUPS, STYLE_TOKENS } from '../design/tokens'
import type { Breakpoint, StyleToken, StyleTokenGroup } from '../design/tokens'
import { SHADES, spacingBasePx, THEME_COLORS, themeColorValue, themeNeutralColor } from '../design/theme'
import type { NeutralColorKind, Theme, ThemeColorName } from '../design/theme'

/** How the style panel presents the design tokens: token pickers, grouped. */

export interface StyleFieldGroup {
  group: StyleTokenGroup
  fields: StyleToken[]
  /** How many of the group's tokens the node sets. */
  setCount: number
}

export function styleFieldGroups(style: Record<string, string> = {}): StyleFieldGroup[] {
  return STYLE_TOKEN_GROUPS.map((group) => {
    const fields = STYLE_TOKENS.filter(t => t.group === group)
    return { group, fields, setCount: fields.filter(f => style[f.key] !== undefined).length }
  })
}

export type StyleFieldControl = 'color' | 'spacing' | 'segmented' | 'select'

// Segments fit the panel for up to four values, or five one- or two-character ones
// (border widths); `items` and `self` would overflow.
const fitsSegments = (values: string[]) => values.length <= 4 || (values.length <= 5 && values.every(v => v.length <= 2))

export function styleFieldControl(token: StyleToken): StyleFieldControl {
  if (token.kind === 'color') return 'color'
  if (token.group === 'Spacing') return 'spacing'
  return fitsSegments(token.values) ? 'segmented' : 'select'
}

export interface SetStyleToken {
  key: string
  label: string
  value: string
  className: string
}

/** The node's valid tokens in class order (breakpoint variants after their base), with the class each renders. */
export function setStyleTokens(style: Record<string, string>): SetStyleToken[] {
  return orderedStyleTokens(style).map(({ key, token, breakpoint, value, className }) => ({
    key,
    label: breakpoint ? `${token.label} (${breakpoint})` : token.label,
    value,
    className
  }))
}

export type DeviceId = 'mobile' | 'tablet' | 'desktop'

export interface Device {
  id: DeviceId
  label: string
  /** The canvas width in CSS px; media queries in the canvas follow it. */
  width: number
  /** The breakpoint the style panel edits on this device; undefined is the base (mobile-first). */
  breakpoint: Breakpoint | undefined
  icon: string
}

export const DEVICES: Device[] = [
  { id: 'mobile', label: 'Mobile', width: 390, breakpoint: undefined, icon: 'i-lucide-smartphone' },
  { id: 'tablet', label: 'Tablet', width: 768, breakpoint: 'md', icon: 'i-lucide-tablet' },
  { id: 'desktop', label: 'Desktop', width: 1280, breakpoint: 'lg', icon: 'i-lucide-monitor' }
]

export interface InheritedToken {
  value: string
  /** The smaller breakpoint the value comes from; undefined is the base. */
  from: Breakpoint | undefined
}

/**
 * A style seen from one breakpoint, keyed by base token: the tokens set at that
 * breakpoint, and for the others the value that applies there from the nearest
 * smaller breakpoint (mobile-first).
 */
export function breakpointStyles(style: Record<string, string>, breakpoint: Breakpoint | undefined): { own: Record<string, string>, inherited: Record<string, InheritedToken> } {
  const rank = (b: Breakpoint | undefined) => (b ? BREAKPOINTS.indexOf(b) + 1 : 0)
  const own: Record<string, string> = {}
  const inherited: Record<string, InheritedToken> = {}
  const best: Record<string, number> = {}
  for (const [key, value] of Object.entries(style)) {
    const parsed = parseStyleKey(key)
    if (!parsed) continue
    const base = parsed.token.key
    const at = rank(parsed.breakpoint)
    if (at === rank(breakpoint)) own[base] = value
    else if (at < rank(breakpoint) && at >= (best[base] ?? -1)) {
      best[base] = at
      inherited[base] = { value, from: parsed.breakpoint }
    }
  }
  for (const base of Object.keys(own)) Reflect.deleteProperty(inherited, base)
  return { own, inherited }
}

const px = (n: number) => `${Number(n.toFixed(2))}px`

/** Spacing scale items labelled with their size for the density, e.g. `10 · 40px`. */
export function spacingItems(token: StyleToken, spacing: Theme['spacing']): { value: string, label: string }[] {
  const base = spacingBasePx(spacing)
  return token.values.map((value) => {
    const n = Number(value)
    return { value, label: Number.isNaN(n) ? value : `${value} · ${px(n * base)}` }
  })
}

export interface ColorSwatch {
  /** The token value, e.g. `primary-600`. */
  value: string
  label: string
  /** The CSS colour under the project theme. */
  color: string
}

export interface ColorSwatchRow {
  /** A semantic colour, or `design` for the neutral design colours (`default`, `muted`, ...). */
  name: ThemeColorName | 'design'
  swatches: ColorSwatch[]
}

const NEUTRAL_KIND: Record<string, NeutralColorKind> = { bg: 'bg', text: 'text', border: 'border' }

/** The swatches a colour token offers, painted with the project theme's colours. */
export function colorSwatchRows(token: StyleToken, theme: Theme): ColorSwatchRow[] {
  const allowed = new Set(token.values)
  const rows: ColorSwatchRow[] = THEME_COLORS.map((name) => {
    const base = allowed.has(name) ? [{ value: name, label: name, color: themeColorValue(theme, name, '500') }] : []
    const shades = SHADES.filter(s => allowed.has(`${name}-${s}`))
      .map(s => ({ value: `${name}-${s}`, label: `${name}-${s}`, color: themeColorValue(theme, name, s) }))
    return { name, swatches: [...base, ...shades] }
  })
  const kind = NEUTRAL_KIND[token.prefix]
  const design = kind
    ? token.values.flatMap((value) => {
        const color = themeNeutralColor(theme, kind, value)
        return color ? [{ value, label: value, color }] : []
      })
    : []
  return [...rows.filter(r => r.swatches.length), ...(design.length ? [{ name: 'design' as const, swatches: design }] : [])]
}

/** The swatch colour of a colour token value, if the token offers it. */
export function colorSwatch(token: StyleToken, theme: Theme, value: string | undefined): ColorSwatch | undefined {
  if (!value) return undefined
  return colorSwatchRows(token, theme).flatMap(r => r.swatches).find(s => s.value === value)
}
