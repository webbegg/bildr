import { BREAKPOINTS, getStyleToken, isResponsiveToken, orderedStyleTokens, parseStyleKey, STYLE_HEX, styleKey } from '../design/tokens'
import type { Breakpoint, StyleToken } from '../design/tokens'
import { SHADES, spacingBasePx, THEME_COLORS, themeColorValue, themeNeutralColor } from '../design/theme'
import type { NeutralColorKind, Theme, ThemeColorName } from '../design/theme'

/** How the style panel presents the design tokens: token pickers, in Stacki's sections. */

export const STYLE_SECTIONS = ['Layout', 'Spacing', 'Size', 'Typography', 'Backgrounds', 'Borders', 'Effects'] as const

export type StyleSection = typeof STYLE_SECTIONS[number]

// Each section's tokens in panel order. Gap sits in Layout, as in Stacki; the
// colours go to the section of what they paint.
const SECTION_KEYS: Record<StyleSection, string[]> = {
  Layout: ['direction', 'flexWrap', 'items', 'justify', 'self', 'gap', 'cols', 'colSpan', 'display', 'overflow'],
  Spacing: ['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl'],
  Size: ['w', 'h', 'minW', 'maxW', 'minH', 'maxH'],
  Typography: ['text', 'font', 'align', 'tracking', 'leading', 'textTransform', 'color'],
  Backgrounds: ['bg'],
  Borders: ['border', 'borderT', 'borderR', 'borderB', 'borderL', 'borderColor', 'rounded', 'roundedTl', 'roundedTr', 'roundedBr', 'roundedBl'],
  Effects: ['shadow', 'opacity']
}

/** Short row labels for the panel's label column; the others use the token label. */
const SHORT_LABELS: Record<string, string> = {
  items: 'Align', justify: 'Justify', self: 'Self', cols: 'Columns', colSpan: 'Span',
  m: 'Margin', mx: 'Margin X', my: 'Margin Y', p: 'Padding', px: 'Padding X', py: 'Padding Y',
  mt: 'Margin T', mr: 'Margin R', mb: 'Margin B', ml: 'Margin L', pt: 'Padding T', pr: 'Padding R', pb: 'Padding B', pl: 'Padding L',
  maxW: 'Max W', minH: 'Min H', text: 'Size', font: 'Weight', align: 'Align', color: 'Color',
  bg: 'Color', border: 'Width', borderColor: 'Color', rounded: 'Radius'
}

export function fieldLabel(token: StyleToken): string {
  return SHORT_LABELS[token.key] ?? token.label
}

/** The section of a token key, breakpoint-prefixed or not; undefined for unknown keys. */
export function styleSection(key: string): StyleSection | undefined {
  const base = parseStyleKey(key)?.token.key
  return base ? STYLE_SECTIONS.find(s => SECTION_KEYS[s].includes(base)) : undefined
}

export function styleSections(): { section: StyleSection, fields: StyleToken[] }[] {
  return STYLE_SECTIONS.map(section => ({ section, fields: SECTION_KEYS[section].map(key => getStyleToken(key)!) }))
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

export type DeviceId = 'mobile' | 'large-phone' | 'tablet' | 'desktop'

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
  // Hidden by default (shared/editor/frames.ts); the frame bar's "+" shows it.
  { id: 'large-phone', label: 'Large phone', width: 640, breakpoint: 'sm', icon: 'i-lucide-tablet-smartphone' },
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

const deviceBreakpoint = (device: DeviceId) => DEVICES.find(d => d.id === device)!.breakpoint

/** The device a breakpoint edits, e.g. `Tablet` for `md`, `Large phone` for `sm`. */
export function breakpointLabel(breakpoint: Breakpoint | undefined): string {
  return DEVICES.find(d => d.breakpoint === breakpoint)?.label ?? breakpoint!
}

/** Where the value of a base token at a device comes from; `key` is what a reset clears. */
export type Provenance
  = | { state: 'set', key: string, value: string }
    | { state: 'inherited', value: string, from: Breakpoint | undefined }
    | { state: 'unset' }

export function styleProvenance(style: Record<string, string>, base: string, device: DeviceId): Provenance {
  const token = getStyleToken(base)
  if (!token) return { state: 'unset' }
  // Tokens without breakpoint variants apply to every device from the base key.
  const breakpoint = isResponsiveToken(token) ? deviceBreakpoint(device) : undefined
  const { own, inherited } = breakpointStyles(style, breakpoint)
  if (own[base] !== undefined) return { state: 'set', key: styleKey(base, breakpoint), value: own[base] }
  const from = inherited[base]
  return from ? { state: 'inherited', ...from } : { state: 'unset' }
}

/**
 * How a field shows its provenance, the Framer way: only an override (a value
 * set at the edited breakpoint) is highlighted; inherited values look unset.
 */
export function provenanceHighlight(provenance: Provenance): 'override' | undefined {
  return provenance.state === 'set' ? 'override' : undefined
}

/** Where an inherited value comes from, for a tooltip, e.g. `From Mobile: 10`. */
export function provenanceHint(provenance: Provenance): string | undefined {
  return provenance.state === 'inherited' ? `From ${breakpointLabel(provenance.from)}: ${provenance.value}` : undefined
}

/** A collapsed section's dot: `set` if the device sets one of its tokens; inheriting gets no dot. */
export function sectionMark(style: Record<string, string>, section: StyleSection, device: DeviceId): 'set' | undefined {
  return SECTION_KEYS[section].some(key => styleProvenance(style, key, device).state === 'set') ? 'set' : undefined
}

/** Whether the node writes any token at exactly the device's breakpoint (the base for Mobile). */
export function hasStyleAt(style: Record<string, string>, device: DeviceId): boolean {
  const breakpoint = deviceBreakpoint(device)
  return Object.keys(style).some((key) => {
    const parsed = parseStyleKey(key)
    return !!parsed && parsed.breakpoint === breakpoint
  })
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

/** The theme's own colours (`theme.custom`), which every colour key takes by name. */
export function customColorSwatches(theme: Pick<Theme, 'custom'>): ColorSwatch[] {
  return Object.entries(theme.custom ?? {}).map(([name, color]) => ({ value: name, label: name, color }))
}

/** The swatch of a colour key's value: a token the key offers, a theme colour, or a raw hex. */
export function colorSwatch(token: StyleToken, theme: Theme, value: string | undefined): ColorSwatch | undefined {
  if (!value) return undefined
  if (STYLE_HEX.test(value)) return { value, label: value, color: value }
  return colorSwatchRows(token, theme).flatMap(r => r.swatches).find(s => s.value === value)
    ?? customColorSwatches(theme).find(s => s.value === value)
}
