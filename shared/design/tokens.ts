/**
 * The design-token registry. A node's `style` stores one token per key, e.g.
 * `{ mt: '10', bg: 'primary' }`, which renders as `class="mt-10 bg-primary"`.
 * This list drives validation, the style panel, the action (and MCP) schemas,
 * and the generated Tailwind safelist (`app/assets/css/tokens.css`).
 *
 * A key can carry a breakpoint prefix (mobile-first, as in Tailwind):
 * `{ cols: '1', 'md:cols': '3' }` renders as `grid-cols-1 md:grid-cols-3`.
 */

export const BREAKPOINTS = ['sm', 'md', 'lg'] as const

export type Breakpoint = typeof BREAKPOINTS[number]

export const STYLE_TOKEN_GROUPS = ['Spacing', 'Size', 'Color', 'Typography', 'Border', 'Effects', 'Layout'] as const

export type StyleTokenGroup = typeof STYLE_TOKEN_GROUPS[number]

/**
 * The groups whose tokens take breakpoint prefixes: those that change layout.
 * Colours, borders and shadows stay base-only, which keeps the dev CSS ~95 KB
 * smaller than generating every variant.
 */
export const RESPONSIVE_GROUPS: readonly StyleTokenGroup[] = ['Spacing', 'Size', 'Typography', 'Layout']

export function isResponsiveToken(token: StyleToken): boolean {
  return RESPONSIVE_GROUPS.includes(token.group)
}

export interface StyleToken {
  /** The key stored in `node.style`. */
  key: string
  label: string
  group: StyleTokenGroup
  /** Tailwind utility prefix; the class is `${prefix}-${value}`. */
  prefix: string
  values: string[]
  kind?: 'color'
}

const SPACING = ['0', '0.5', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '32']
const MARGIN = [...SPACING, 'auto']

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
// Nuxt UI defines no bare `neutral` colour utility, only its shades.
const SEMANTIC = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']
const THEME_COLORS = SEMANTIC.flatMap(c => [...(c === 'neutral' ? [] : [c]), ...SHADES.map(s => `${c}-${s}`)])

const spacing = (key: string, label: string, values = SPACING): StyleToken => ({ key, label, group: 'Spacing', prefix: key, values })

export const STYLE_TOKENS: StyleToken[] = [
  spacing('m', 'Margin', MARGIN),
  spacing('mx', 'Margin X', MARGIN),
  spacing('my', 'Margin Y', MARGIN),
  spacing('mt', 'Margin top', MARGIN),
  spacing('mr', 'Margin right', MARGIN),
  spacing('mb', 'Margin bottom', MARGIN),
  spacing('ml', 'Margin left', MARGIN),
  spacing('p', 'Padding'),
  spacing('px', 'Padding X'),
  spacing('py', 'Padding Y'),
  spacing('pt', 'Padding top'),
  spacing('pr', 'Padding right'),
  spacing('pb', 'Padding bottom'),
  spacing('pl', 'Padding left'),
  spacing('gap', 'Gap'),
  { key: 'w', label: 'Width', group: 'Size', prefix: 'w', values: ['auto', 'full', 'screen', 'fit', '1/2', '1/3', '2/3', '1/4', '3/4'] },
  { key: 'maxW', label: 'Max width', group: 'Size', prefix: 'max-w', values: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full', 'prose'] },
  { key: 'minH', label: 'Min height', group: 'Size', prefix: 'min-h', values: ['0', 'full', 'screen', '32', '48', '64', '96'] },
  { key: 'bg', label: 'Background', group: 'Color', prefix: 'bg', kind: 'color', values: [...THEME_COLORS, 'default', 'muted', 'elevated', 'accented', 'inverted'] },
  { key: 'color', label: 'Text color', group: 'Color', prefix: 'text', kind: 'color', values: [...THEME_COLORS, 'default', 'highlighted', 'toned', 'muted', 'dimmed', 'inverted'] },
  { key: 'borderColor', label: 'Border color', group: 'Color', prefix: 'border', kind: 'color', values: [...THEME_COLORS, 'default', 'muted', 'accented', 'inverted'] },
  { key: 'text', label: 'Font size', group: 'Typography', prefix: 'text', values: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'] },
  { key: 'font', label: 'Font weight', group: 'Typography', prefix: 'font', values: ['light', 'normal', 'medium', 'semibold', 'bold', 'extrabold'] },
  { key: 'align', label: 'Text align', group: 'Typography', prefix: 'text', values: ['left', 'center', 'right', 'justify'] },
  // `border-1` rather than a bare `border`: an empty value means "remove the token".
  { key: 'border', label: 'Border width', group: 'Border', prefix: 'border', values: ['0', '1', '2', '4', '8'] },
  { key: 'rounded', label: 'Radius', group: 'Border', prefix: 'rounded', values: ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'] },
  { key: 'shadow', label: 'Shadow', group: 'Effects', prefix: 'shadow', values: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] },
  { key: 'items', label: 'Align items', group: 'Layout', prefix: 'items', values: ['start', 'center', 'end', 'stretch', 'baseline'] },
  { key: 'justify', label: 'Justify content', group: 'Layout', prefix: 'justify', values: ['start', 'center', 'end', 'between', 'around', 'evenly'] },
  { key: 'self', label: 'Align self', group: 'Layout', prefix: 'self', values: ['auto', 'start', 'center', 'end', 'stretch'] },
  { key: 'cols', label: 'Grid columns', group: 'Layout', prefix: 'grid-cols', values: ['1', '2', '3', '4', '5', '6', '12'] },
  { key: 'colSpan', label: 'Column span', group: 'Layout', prefix: 'col-span', values: ['1', '2', '3', '4', '5', '6', '12', 'full'] }
]

const BY_KEY = new Map(STYLE_TOKENS.map(t => [t.key, t]))

/** Looks up a base token, e.g. `cols`; see `parseStyleKey` for prefixed keys. */
export function getStyleToken(key: string): StyleToken | undefined {
  return BY_KEY.get(key)
}

/** The style key of a token at a breakpoint: `cols` for the base, `md:cols` for `md`. */
export function styleKey(base: string, breakpoint: Breakpoint | undefined): string {
  return breakpoint ? `${breakpoint}:${base}` : base
}

function splitKey(key: string): { breakpoint?: string, base: string } {
  const at = key.indexOf(':')
  return at < 0 ? { base: key } : { breakpoint: key.slice(0, at), base: key.slice(at + 1) }
}

const isBreakpoint = (value: string | undefined): value is Breakpoint => (BREAKPOINTS as readonly string[]).includes(value ?? '')

/** The base token and breakpoint of a style key, or undefined when either is unknown. */
export function parseStyleKey(key: string): { token: StyleToken, breakpoint: Breakpoint | undefined } | undefined {
  const { breakpoint, base } = splitKey(key)
  const token = BY_KEY.get(base)
  if (!token || (breakpoint !== undefined && !(isBreakpoint(breakpoint) && isResponsiveToken(token)))) return undefined
  return { token, breakpoint }
}

export function isStyleTokenKey(key: string): boolean {
  return parseStyleKey(key) !== undefined
}

/** Returns a problem message for an unknown key or breakpoint, or a value outside the token's scale. */
export function styleTokenProblem(key: string, value: string): string | undefined {
  const { breakpoint } = splitKey(key)
  if (breakpoint !== undefined && !isBreakpoint(breakpoint)) {
    return `Unknown breakpoint "${breakpoint}" in style token "${key}" (use sm:, md: or lg:)`
  }
  const token = parseStyleKey(key)?.token
  if (!token) {
    const base = BY_KEY.get(splitKey(key).base)
    return base ? `Style token "${base.key}" has no breakpoint variants (only ${RESPONSIVE_GROUPS.join(', ')} tokens do)` : `Unknown style token "${key}"`
  }
  return token.values.includes(value) ? undefined : `"${value}" is not a value of style token "${key}"`
}

/** The breakpoints a token can be set at, `undefined` being the base (mobile-first) value. */
export function variantsOf(token: StyleToken): (Breakpoint | undefined)[] {
  return isResponsiveToken(token) ? [undefined, ...BREAKPOINTS] : [undefined]
}

/** A style's valid tokens ordered by base key in registry order, then base, sm, md, lg. */
export function orderedStyleTokens(style: Record<string, string>): { key: string, token: StyleToken, breakpoint: Breakpoint | undefined, value: string, className: string }[] {
  return STYLE_TOKENS.flatMap(token => variantsOf(token).flatMap((breakpoint) => {
    const key = styleKey(token.key, breakpoint)
    const value = style[key]
    if (value === undefined || !token.values.includes(value)) return []
    return [{ key, token, breakpoint, value, className: styleKey(`${token.prefix}-${value}`, breakpoint) }]
  }))
}

/** The class list for a style map, in registry order. Invalid tokens are skipped. */
export function styleClasses(style: Record<string, string>): string {
  return orderedStyleTokens(style).map(t => t.className).join(' ')
}

/** Every class the registry can produce, breakpoint variants included. */
export function allTokenClasses(): string[] {
  return STYLE_TOKENS.flatMap(t => variantsOf(t).flatMap(b => t.values.map(v => styleKey(`${t.prefix}-${v}`, b))))
}

/** The contents of `app/assets/css/tokens.css`: one Tailwind `@source inline` per token. */
export function tokenSafelistCss(): string {
  const variants = `{,${BREAKPOINTS.map(b => `${b}:`).join(',')}}`
  const lines = STYLE_TOKENS.map((t) => {
    const values = t.values.length === 1 ? t.values[0] : `{${t.values.join(',')}}`
    return `@source inline("${isResponsiveToken(t) ? variants : ''}${t.prefix}-${values}");`
  })
  return [
    '/* Generated from shared/design/tokens.ts by `pnpm tokens:css`. Do not edit. */',
    ...lines,
    ''
  ].join('\n')
}
