import { STYLE_TOKEN_GROUPS, STYLE_TOKENS } from '../design/tokens'
import type { StyleToken, StyleTokenGroup } from '../design/tokens'
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

const SEGMENTED_MAX = 5

export function styleFieldControl(token: StyleToken): StyleFieldControl {
  if (token.kind === 'color') return 'color'
  if (token.group === 'Spacing') return 'spacing'
  return token.values.length <= SEGMENTED_MAX ? 'segmented' : 'select'
}

export interface SetStyleToken {
  key: string
  label: string
  value: string
  className: string
}

/** The node's valid tokens in registry order, with the class each renders. */
export function setStyleTokens(style: Record<string, string>): SetStyleToken[] {
  return STYLE_TOKENS
    .filter(t => style[t.key] !== undefined && t.values.includes(style[t.key]!))
    .map(t => ({ key: t.key, label: t.label, value: style[t.key]!, className: `${t.prefix}-${style[t.key]}` }))
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
