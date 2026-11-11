/**
 * The design-token registry. A node's `style` stores one token per key, e.g.
 * `{ mt: '10', bg: 'primary' }`, which renders as `class="mt-10 bg-primary"`.
 * This list drives validation, the style panel, the action (and MCP) schemas,
 * and the generated Tailwind safelist (`app/assets/css/tokens.css`).
 *
 * A key can carry a breakpoint prefix (mobile-first, as in Tailwind):
 * `{ cols: '1', 'md:cols': '3' }` renders as `grid-cols-1 md:grid-cols-3`.
 *
 * Colour keys (`kind: 'color'`) also take a raw hex (`#rgb`, `#rrggbb`,
 * `#rrggbbaa`) or a colour the project theme names (`theme.custom`, e.g.
 * `brand`). Neither has a generated class: they render as an inline style
 * (`styleInline`), the theme colour through its CSS variable
 * (`customColorVar`). Colour keys have no breakpoint variants, so an inline
 * value never needs a media query.
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
  /** Tailwind utility prefix; the class is `${prefix}-${value}`, or just the value when empty (`display`, `textTransform`). */
  prefix: string
  values: string[]
  kind?: 'color'
  /** For colour tokens: the CSS property an inline (hex or theme) colour sets. */
  css?: string
}

/** A raw hex colour for a colour key. No `i` flag: JSON Schema patterns (the MCP tool schemas) drop regex flags. */
export const STYLE_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** The shape of a theme's own colour name (`theme.custom`), e.g. `brand` or `ink-2`. */
export const CUSTOM_COLOR_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** The CSS variable `themeCss` declares for theme colour `name`. */
export function customColorVar(name: string): string {
  return `--bildr-color-${name}`
}

const COLOR_HINT = ' (use a colour token, a #rgb, #rrggbb or #rrggbbaa hex, or a theme colour)'

const SPACING = ['0', '0.5', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '32']
const MARGIN = [...SPACING, 'auto']
// Framer's Fixed width and height: `w-64` is 64 × `--spacing`, like the spacing scale.
const FIXED_WIDTHS = ['0', '4', '8', '12', '16', '20', '24', '32', '40', '48', '56', '64', '72', '80', '96']

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
// Nuxt UI defines no bare `neutral` colour utility, only its shades.
const SEMANTIC = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']
const THEME_COLORS = SEMANTIC.flatMap(c => [...(c === 'neutral' ? [] : [c]), ...SHADES.map(s => `${c}-${s}`)])

const spacing = (key: string, label: string, values = SPACING): StyleToken => ({ key, label, group: 'Spacing', prefix: key, values })

const BORDER_WIDTHS = ['0', '1', '2', '4', '8']
const RADII = ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full']
const border = (key: string, label: string, prefix: string): StyleToken => ({ key, label, group: 'Border', prefix, values: BORDER_WIDTHS })
const radius = (key: string, label: string, prefix: string): StyleToken => ({ key, label, group: 'Border', prefix, values: RADII })

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
  { key: 'w', label: 'Width', group: 'Size', prefix: 'w', values: ['auto', 'full', 'screen', 'fit', '1/2', '1/3', '2/3', '1/4', '3/4', ...FIXED_WIDTHS] },
  { key: 'h', label: 'Height', group: 'Size', prefix: 'h', values: ['auto', 'full', 'screen', 'fit', ...FIXED_WIDTHS] },
  { key: 'minW', label: 'Min width', group: 'Size', prefix: 'min-w', values: ['0', 'full', 'fit', ...FIXED_WIDTHS.slice(1)] },
  { key: 'maxW', label: 'Max width', group: 'Size', prefix: 'max-w', values: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full', 'prose'] },
  { key: 'minH', label: 'Min height', group: 'Size', prefix: 'min-h', values: ['0', 'full', 'screen', '32', '48', '64', '96'] },
  { key: 'maxH', label: 'Max height', group: 'Size', prefix: 'max-h', values: ['full', 'screen', ...FIXED_WIDTHS] },
  { key: 'bg', label: 'Background', group: 'Color', prefix: 'bg', kind: 'color', css: 'background-color', values: [...THEME_COLORS, 'default', 'muted', 'elevated', 'accented', 'inverted'] },
  { key: 'color', label: 'Text color', group: 'Color', prefix: 'text', kind: 'color', css: 'color', values: [...THEME_COLORS, 'default', 'highlighted', 'toned', 'muted', 'dimmed', 'inverted'] },
  { key: 'borderColor', label: 'Border color', group: 'Color', prefix: 'border', kind: 'color', css: 'border-color', values: [...THEME_COLORS, 'default', 'muted', 'accented', 'inverted'] },
  { key: 'text', label: 'Font size', group: 'Typography', prefix: 'text', values: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'] },
  { key: 'font', label: 'Font weight', group: 'Typography', prefix: 'font', values: ['light', 'normal', 'medium', 'semibold', 'bold', 'extrabold'] },
  { key: 'align', label: 'Text align', group: 'Typography', prefix: 'text', values: ['left', 'center', 'right', 'justify'] },
  { key: 'tracking', label: 'Letter spacing', group: 'Typography', prefix: 'tracking', values: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'] },
  { key: 'leading', label: 'Line height', group: 'Typography', prefix: 'leading', values: ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose'] },
  // Prefix-less like `display`: the classes are `uppercase`, `md:normal-case`, ...
  { key: 'textTransform', label: 'Text transform', group: 'Typography', prefix: '', values: ['uppercase', 'lowercase', 'capitalize', 'normal-case'] },
  // `border-1` rather than a bare `border`: an empty value means "remove the token".
  border('border', 'Border width', 'border'),
  border('borderT', 'Border top width', 'border-t'),
  border('borderR', 'Border right width', 'border-r'),
  border('borderB', 'Border bottom width', 'border-b'),
  border('borderL', 'Border left width', 'border-l'),
  radius('rounded', 'Radius', 'rounded'),
  radius('roundedTl', 'Radius top left', 'rounded-tl'),
  radius('roundedTr', 'Radius top right', 'rounded-tr'),
  radius('roundedBr', 'Radius bottom right', 'rounded-br'),
  radius('roundedBl', 'Radius bottom left', 'rounded-bl'),
  { key: 'shadow', label: 'Shadow', group: 'Effects', prefix: 'shadow', values: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] },
  { key: 'opacity', label: 'Opacity', group: 'Effects', prefix: 'opacity', values: ['0', '5', '10', '20', '25', '30', '40', '50', '60', '70', '75', '80', '90', '95', '100'] },
  { key: 'direction', label: 'Direction', group: 'Layout', prefix: 'flex', values: ['row', 'col', 'row-reverse', 'col-reverse'] },
  { key: 'flexWrap', label: 'Wrap', group: 'Layout', prefix: 'flex', values: ['wrap', 'nowrap'] },
  { key: 'items', label: 'Align items', group: 'Layout', prefix: 'items', values: ['start', 'center', 'end', 'stretch', 'baseline'] },
  { key: 'justify', label: 'Justify content', group: 'Layout', prefix: 'justify', values: ['start', 'center', 'end', 'between', 'around', 'evenly'] },
  { key: 'self', label: 'Align self', group: 'Layout', prefix: 'self', values: ['auto', 'start', 'center', 'end', 'stretch'] },
  { key: 'cols', label: 'Grid columns', group: 'Layout', prefix: 'grid-cols', values: ['1', '2', '3', '4', '5', '6', '12'] },
  { key: 'colSpan', label: 'Column span', group: 'Layout', prefix: 'col-span', values: ['1', '2', '3', '4', '5', '6', '12', 'full'] },
  // Hide/show per breakpoint: the classes are `hidden`, `md:flex`, ...
  { key: 'display', label: 'Display', group: 'Layout', prefix: '', values: ['hidden', 'block', 'flex', 'grid'] },
  { key: 'overflow', label: 'Overflow', group: 'Layout', prefix: 'overflow', values: ['visible', 'hidden', 'auto', 'scroll', 'clip'] }
]

/** The class of a token value: `mt-10`, or `hidden` for a token without a prefix. */
const tokenClass = (token: StyleToken, value: string) => (token.prefix ? `${token.prefix}-${value}` : value)

/**
 * The display class a template gives a node (`flex` for a stack, `grid` for a
 * Grid), or none when the style sets a base `display` token, which replaces it.
 * Breakpoint variants override it through their media queries.
 */
export function displayFallback(display: string, style: Record<string, string>): string {
  return style.display !== undefined && getStyleToken('display')!.values.includes(style.display) ? '' : display
}

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

/** Whether `name` is a value of any colour token, which a theme colour name cannot take. */
export function isColorTokenValue(name: string): boolean {
  return STYLE_TOKENS.some(t => t.kind === 'color' && t.values.includes(name))
}

/**
 * The inline CSS value of a colour token's value outside its scale: the hex
 * itself, or the theme colour's variable; undefined for scale values (they
 * are classes), other tokens and values of no colour shape.
 */
function inlineColor(token: StyleToken, value: string): string | undefined {
  if (token.kind !== 'color' || token.values.includes(value)) return undefined
  if (STYLE_HEX.test(value)) return value
  return CUSTOM_COLOR_NAME.test(value) ? `var(${customColorVar(value)})` : undefined
}

/**
 * Returns a problem message for an unknown key or breakpoint, or a value
 * outside the token's scale. Colour keys also take a hex or one of
 * `customColors`, the names of the project theme's own colours.
 */
export function styleTokenProblem(key: string, value: string, customColors: readonly string[] = []): string | undefined {
  const { breakpoint } = splitKey(key)
  if (breakpoint !== undefined && !isBreakpoint(breakpoint)) {
    return `Unknown breakpoint "${breakpoint}" in style token "${key}" (use sm:, md: or lg:)`
  }
  const token = parseStyleKey(key)?.token
  if (!token) {
    const base = BY_KEY.get(splitKey(key).base)
    return base ? `Style token "${base.key}" has no breakpoint variants (only ${RESPONSIVE_GROUPS.join(', ')} tokens do)` : `Unknown style token "${key}"`
  }
  if (token.values.includes(value)) return undefined
  if (token.kind !== 'color') return `"${value}" is not a value of style token "${key}"`
  return STYLE_HEX.test(value) || customColors.includes(value) ? undefined : `"${value}" is not a value of style token "${key}"${COLOR_HINT}`
}

/** The breakpoints a token can be set at, `undefined` being the base (mobile-first) value. */
export function variantsOf(token: StyleToken): (Breakpoint | undefined)[] {
  return isResponsiveToken(token) ? [undefined, ...BREAKPOINTS] : [undefined]
}

export interface OrderedStyleToken {
  key: string
  token: StyleToken
  breakpoint: Breakpoint | undefined
  value: string
  /** The class it renders; empty for an inline colour. */
  className: string
  /** A hex or theme colour, rendered as this inline declaration instead of a class. */
  inline?: { property: string, value: string }
}

/**
 * A style's valid tokens ordered by base key in registry order, then base,
 * sm, md, lg. Colour keys holding a hex or a theme colour name come with
 * their `inline` declaration and no class.
 */
export function orderedStyleTokens(style: Record<string, string>): OrderedStyleToken[] {
  return STYLE_TOKENS.flatMap(token => variantsOf(token).flatMap((breakpoint): OrderedStyleToken[] => {
    const key = styleKey(token.key, breakpoint)
    const value = style[key]
    if (value === undefined) return []
    if (token.values.includes(value)) return [{ key, token, breakpoint, value, className: styleKey(tokenClass(token, value), breakpoint) }]
    const inline = inlineColor(token, value)
    return inline && token.css ? [{ key, token, breakpoint, value, className: '', inline: { property: token.css, value: inline } }] : []
  }))
}

/** The class list for a style map, in registry order. Invalid tokens and inline colours are skipped. */
export function styleClasses(style: Record<string, string>): string {
  return orderedStyleTokens(style).flatMap(t => (t.className ? [t.className] : [])).join(' ')
}

/** The inline declarations of a style map: its hex and theme colours, e.g. `{ 'background-color': '#ff0000' }`. */
export function styleInline(style: Record<string, string>): Record<string, string> {
  return Object.fromEntries(orderedStyleTokens(style).flatMap(t => (t.inline ? [[t.inline.property, t.inline.value]] : [])))
}

/** Every class the registry can produce, breakpoint variants included. */
export function allTokenClasses(): string[] {
  return STYLE_TOKENS.flatMap(t => variantsOf(t).flatMap(b => t.values.map(v => styleKey(tokenClass(t, v), b))))
}

/** The contents of `app/assets/css/tokens.css`: one Tailwind `@source inline` per token. */
export function tokenSafelistCss(): string {
  const variants = `{,${BREAKPOINTS.map(b => `${b}:`).join(',')}}`
  const lines = STYLE_TOKENS.map((t) => {
    const values = t.values.length === 1 ? t.values[0] : `{${t.values.join(',')}}`
    return `@source inline("${isResponsiveToken(t) ? variants : ''}${t.prefix ? `${t.prefix}-` : ''}${values}");`
  })
  return [
    '/* Generated from shared/design/tokens.ts by `pnpm tokens:css`. Do not edit. */',
    ...lines,
    ''
  ].join('\n')
}
