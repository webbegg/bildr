/**
 * The design-token registry. A node's `style` stores one token per key, e.g.
 * `{ mt: '10', bg: 'primary' }`, which renders as `class="mt-10 bg-primary"`.
 * This list drives validation, the style panel, the action (and MCP) schemas,
 * and the generated Tailwind safelist (`app/assets/css/tokens.css`).
 *
 * A key can carry a breakpoint prefix, as in Tailwind. Each project has a
 * breakpoint base (`Project.breakpointBase`): a mobile-first project stores
 * the Mobile value as the base and overrides wider sizes with `sm:`, `md:`
 * and `lg:` (`{ cols: '1', 'md:cols': '3' }` renders as
 * `grid-cols-1 md:grid-cols-3`); a desktop-first one stores the Desktop value
 * and overrides narrower sizes with `max-lg:` (below 1024 px), `max-md:`
 * (below 768) and `max-sm:` (below 640). Each project takes only its own
 * prefixes; `levels` is the cascade order of both.
 *
 * Colour keys (`kind: 'color'`) also take a raw hex (`#rgb`, `#rrggbb`,
 * `#rrggbbaa`) or a colour the project theme names (`theme.custom`, e.g.
 * `brand`). Neither has a generated class: they render as an inline style
 * (`styleInline`), the theme colour through its CSS variable
 * (`customColorVar`). Colour keys have no breakpoint variants, so an inline
 * value never needs a media query.
 */

export const BREAKPOINT_BASES = ['mobile', 'desktop'] as const

/** Which device a project's base (unprefixed) style is for; see `levels`. */
export type BreakpointBase = typeof BREAKPOINT_BASES[number]

const MOBILE_BREAKPOINTS = ['sm', 'md', 'lg'] as const
const DESKTOP_BREAKPOINTS = ['max-lg', 'max-md', 'max-sm'] as const

/** Every breakpoint prefix of both bases, mobile-first ones first. */
export const ALL_BREAKPOINTS = [...MOBILE_BREAKPOINTS, ...DESKTOP_BREAKPOINTS] as const

export type Breakpoint = typeof ALL_BREAKPOINTS[number]

/** The prefixes a project of `base` uses, in cascade order (each overrides the ones before it). */
export function breakpointsOf(base: BreakpointBase): readonly Breakpoint[] {
  return base === 'desktop' ? DESKTOP_BREAKPOINTS : MOBILE_BREAKPOINTS
}

/**
 * The cascade of a base, `undefined` being the base style: mobile is base,
 * sm, md, lg (min-width queries, wider wins); desktop is base, max-lg,
 * max-md, max-sm (max-width queries, narrower wins). Tailwind v4 emits the
 * variants in this order, so a later level overrides the earlier ones.
 */
export function levels(base: BreakpointBase): (Breakpoint | undefined)[] {
  return [undefined, ...breakpointsOf(base)]
}

/** The base whose prefixes include `breakpoint`. */
export function baseOfBreakpoint(breakpoint: Breakpoint): BreakpointBase {
  return (DESKTOP_BREAKPOINTS as readonly string[]).includes(breakpoint) ? 'desktop' : 'mobile'
}

/**
 * The levels a value at `breakpoint` cascades from, the base first and
 * `breakpoint` last: its own family only (`[undefined]` for the base).
 */
export function cascadeTo(breakpoint: Breakpoint | undefined): (Breakpoint | undefined)[] {
  if (!breakpoint) return [undefined]
  const all = levels(baseOfBreakpoint(breakpoint))
  return all.slice(0, all.indexOf(breakpoint) + 1)
}

/** `sm:, md: or lg:`: the prefixes a base takes, for messages. */
export function breakpointPrefixHint(base: BreakpointBase): string {
  const [a, b, c] = breakpointsOf(base)
  return `${a}:, ${b}: or ${c}:`
}

const baseName = (base: BreakpointBase) => (base === 'desktop' ? 'desktop-first' : 'mobile-first')

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
  /** A value rendered as another value's class: Fill (`fill`) where nothing resolves it renders as `full` (see `fillStyle`). */
  classes?: Record<string, string>
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

const OVERFLOW = ['visible', 'hidden', 'auto', 'scroll', 'clip']
// Grid auto-fit: `--col-min` (a colMin class) is the minimum column width, and a column is never wider than the grid.
const AUTO_FIT = '[repeat(auto-fit,minmax(min(var(--col-min,16rem),100%),1fr))]'
const COL_MINS = ['16', '24', '32', '40', '48', '56', '64', '72', '80', '96']

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
// Nuxt UI defines no bare `neutral` colour utility, only its shades.
const SEMANTIC = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']
const THEME_COLORS = SEMANTIC.flatMap(c => [...(c === 'neutral' ? [] : [c]), ...SHADES.map(s => `${c}-${s}`)])

const spacing = (key: string, label: string, values = SPACING): StyleToken => ({ key, label, group: 'Spacing', prefix: key, values })

const BORDER_WIDTHS = ['0', '1', '2', '4', '8']
const RADII = ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full']
// A 1px border is Tailwind's bare `border` / `border-t`, the class a developer writes.
const border = (key: string, label: string, prefix: string): StyleToken => ({ key, label, group: 'Border', prefix, values: BORDER_WIDTHS, classes: { 1: '' } })
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
  // The gap split into the column gap and the row gap (layout-containers L5): the panel splits it when a stack wraps, or in a grid.
  { ...spacing('gapX', 'Column gap'), prefix: 'gap-x' },
  { ...spacing('gapY', 'Row gap'), prefix: 'gap-y' },
  // `fill` is the Fill intent, resolved by the parent's axis (`fillStyle` in render/rules.ts); `full` is 100%.
  { key: 'w', label: 'Width', group: 'Size', prefix: 'w', values: ['auto', 'full', 'screen', 'fit', '1/2', '1/3', '2/3', '1/4', '3/4', ...FIXED_WIDTHS, 'fill'], classes: { fill: 'full' } },
  { key: 'h', label: 'Height', group: 'Size', prefix: 'h', values: ['auto', 'full', 'screen', 'fit', ...FIXED_WIDTHS, 'fill'], classes: { fill: 'full' } },
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
  // The stored width is `1` rather than empty (an empty value means "remove the token"); its class is the bare prefix.
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
  // The alignment of a wrapped stack's lines, or a grid's rows (layout-containers L5).
  { key: 'content', label: 'Align content', group: 'Layout', prefix: 'content', values: ['start', 'center', 'end', 'between', 'around', 'evenly', 'stretch'] },
  { key: 'self', label: 'Align self', group: 'Layout', prefix: 'self', values: ['auto', 'start', 'center', 'end', 'stretch'] },
  // A stack child's flex: its grow weight, whether it shrinks, its basis (layout-containers L3).
  { key: 'grow', label: 'Grow', group: 'Layout', prefix: 'grow', values: ['0', '1', '2', '3'] },
  { key: 'shrink', label: 'Shrink', group: 'Layout', prefix: 'shrink', values: ['0', '1'] },
  // A zero basis is 0%, as Tailwind's `flex-1`: in a parent of no set size it falls back to the content, so a Fill child never collapses.
  { key: 'basis', label: 'Basis', group: 'Layout', prefix: 'basis', values: ['0', 'auto'], classes: { 0: '[0%]' } },
  // A stack child's place out of document order; the panel warns it changes what a screen reader and the keyboard follow.
  { key: 'order', label: 'Order', group: 'Layout', prefix: 'order', values: ['first', 'last', 'none'] },
  // `auto-fit`: as many columns of at least `colMin` (16rem when unset, never wider than the grid) as fit.
  { key: 'cols', label: 'Grid columns', group: 'Layout', prefix: 'grid-cols', values: ['1', '2', '3', '4', '5', '6', '12', 'auto-fit'], classes: { 'auto-fit': AUTO_FIT } },
  { key: 'colMin', label: 'Min column width', group: 'Layout', prefix: '', values: COL_MINS, classes: Object.fromEntries(COL_MINS.map(value => [value, `[--col-min:calc(var(--spacing)*${value})]`])) },
  { key: 'rows', label: 'Grid rows', group: 'Layout', prefix: 'grid-rows', values: ['1', '2', '3', '4', '5', '6', 'none'] },
  { key: 'colSpan', label: 'Column span', group: 'Layout', prefix: 'col-span', values: ['1', '2', '3', '4', '5', '6', '12', 'full'] },
  { key: 'rowSpan', label: 'Row span', group: 'Layout', prefix: 'row-span', values: ['1', '2', '3', '4', '5', '6', 'full'] },
  // An Overlay: a grid whose children all take its one cell, so it sizes to the largest (layout-containers L5).
  { key: 'overlay', label: 'Overlay', group: 'Layout', prefix: '', values: ['stack', 'none'], classes: { stack: '*:[grid-area:1/1]', none: '*:[grid-area:auto]' } },
  // Hide/show per breakpoint: the classes are `hidden`, `md:flex`, ...
  { key: 'display', label: 'Display', group: 'Layout', prefix: '', values: ['hidden', 'block', 'flex', 'grid'] },
  { key: 'overflow', label: 'Overflow', group: 'Layout', prefix: 'overflow', values: OVERFLOW },
  { key: 'overflowX', label: 'Overflow X', group: 'Layout', prefix: 'overflow-x', values: OVERFLOW },
  { key: 'overflowY', label: 'Overflow Y', group: 'Layout', prefix: 'overflow-y', values: OVERFLOW },
  // Out of the flow (layout-containers L5): pinned by its insets to the nearest positioned ancestor, layered by z.
  { key: 'position', label: 'Position', group: 'Layout', prefix: '', values: ['static', 'relative', 'absolute', 'fixed', 'sticky'] },
  { key: 'inset', label: 'Inset', group: 'Layout', prefix: 'inset', values: ['0', 'auto'] },
  { key: 'insetX', label: 'Inset X', group: 'Layout', prefix: 'inset-x', values: ['0', 'auto'] },
  { key: 'insetY', label: 'Inset Y', group: 'Layout', prefix: 'inset-y', values: ['0', 'auto'] },
  { key: 'top', label: 'Top', group: 'Layout', prefix: 'top', values: MARGIN },
  { key: 'right', label: 'Right', group: 'Layout', prefix: 'right', values: MARGIN },
  { key: 'bottom', label: 'Bottom', group: 'Layout', prefix: 'bottom', values: MARGIN },
  { key: 'left', label: 'Left', group: 'Layout', prefix: 'left', values: MARGIN },
  { key: 'z', label: 'Layer', group: 'Layout', prefix: 'z', values: ['0', '10', '20', '30', '40', '50', 'auto'] }
]

/** The class of a token value: `mt-10`, or `hidden` for a token without a prefix. */
const tokenClass = (token: StyleToken, stored: string) => {
  const value = token.classes?.[stored] ?? stored
  if (!value) return token.prefix
  return token.prefix ? `${token.prefix}-${value}` : value
}

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

/** The style key of a token at a breakpoint: `cols` for the base, `md:cols` for `md`, `max-lg:cols` for `max-lg`. */
export function styleKey(base: string, breakpoint: Breakpoint | undefined): string {
  return breakpoint ? `${breakpoint}:${base}` : base
}

function splitKey(key: string): { breakpoint?: string, base: string } {
  const at = key.indexOf(':')
  return at < 0 ? { base: key } : { breakpoint: key.slice(0, at), base: key.slice(at + 1) }
}

const isBreakpoint = (value: string | undefined): value is Breakpoint => (ALL_BREAKPOINTS as readonly string[]).includes(value ?? '')

/**
 * The base token and breakpoint of a style key, or undefined when either is
 * unknown. Both bases' prefixes parse; `styleTokenProblem` checks that a
 * project uses its own.
 */
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
 * Returns a problem message for an unknown key or breakpoint, a breakpoint
 * of the other base (`base` is the project's), or a value outside the
 * token's scale. Colour keys also take a hex or one of `customColors`, the
 * names of the project theme's own colours.
 */
export function styleTokenProblem(key: string, value: string, customColors: readonly string[] = [], base: BreakpointBase = 'mobile'): string | undefined {
  const { breakpoint } = splitKey(key)
  if (breakpoint !== undefined && !isBreakpoint(breakpoint)) {
    return `Unknown breakpoint "${breakpoint}" in style token "${key}" (use ${breakpointPrefixHint(base)})`
  }
  if (breakpoint !== undefined && baseOfBreakpoint(breakpoint) !== base) {
    return `Breakpoint "${breakpoint}" in style token "${key}" is for ${baseName(baseOfBreakpoint(breakpoint))} projects; this project is ${baseName(base)} (use ${breakpointPrefixHint(base)})`
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

/**
 * The breakpoints a token can be set at in a project of `base` (cascade
 * order), `undefined` being the base value; without `base`, every prefix of
 * both bases (what the renderer and the safelist cover).
 */
export function variantsOf(token: StyleToken, base?: BreakpointBase): (Breakpoint | undefined)[] {
  if (!isResponsiveToken(token)) return [undefined]
  return base ? levels(base) : [undefined, ...ALL_BREAKPOINTS]
}

/** Whether `key` is a style key a project of `base` may hold: a known token at one of its own levels. */
export function isStyleKeyOf(key: string, base: BreakpointBase): boolean {
  const parsed = parseStyleKey(key)
  return !!parsed && (parsed.breakpoint === undefined || baseOfBreakpoint(parsed.breakpoint) === base)
}

const DEVICE_BANDS = 4

/**
 * The sides (or corners) each shorthand-or-side token sets. Two tokens that
 * share one overlap: Tailwind lets a later breakpoint of either win over the
 * other (`md:p-4` beats `pl-8`), so their order depends on the base.
 */
const TOKEN_SIDES: Record<string, string> = {
  m: 'trbl', mx: 'rl', my: 'tb', mt: 't', mr: 'r', mb: 'b', ml: 'l',
  p: 'TRBL', px: 'RL', py: 'TB', pt: 'T', pr: 'R', pb: 'B', pl: 'L',
  border: '1234', borderT: '1', borderR: '2', borderB: '3', borderL: '4',
  rounded: 'wxyz', roundedTl: 'w', roundedTr: 'x', roundedBr: 'y', roundedBl: 'z',
  gap: 'XY', gapX: 'X', gapY: 'Y',
  overflow: 'UV', overflowX: 'U', overflowY: 'V',
  inset: 'EFGH', insetY: 'EG', insetX: 'FH', top: 'E', right: 'F', bottom: 'G', left: 'H'
}

const overlap = (a: string, b: string) => [...(TOKEN_SIDES[a] ?? '')].some(side => TOKEN_SIDES[b]?.includes(side))

/**
 * A style rewritten from one base to the other, keeping the value of each
 * of the four width bands (below 640, 640–767, 768–1023, 1024 and up), which
 * both bases split the same way. Within one base it is returned unchanged.
 * A token the target cascade cannot express (set at the source's narrower
 * or wider levels only, unset where the target's base is) is refused with a
 * `problem`; so are keys of neither base, and two overlapping tokens
 * (`p` and `pl`) when either is set at a breakpoint, whose winner would flip.
 */
export function convertStyleBase(style: Record<string, string>, from: BreakpointBase, to: BreakpointBase): { style: Record<string, string> } | { problem: string } {
  if (from === to) return { style }
  const out: Record<string, string> = {}
  const byToken = new Map<string, { token: StyleToken, keys: [Breakpoint | undefined, string, string][] }>()
  for (const [key, value] of Object.entries(style)) {
    const parsed = parseStyleKey(key)
    if (!parsed || !isStyleKeyOf(key, from)) return { problem: styleTokenProblem(key, value, [], from) ?? `Unknown style token "${key}"` }
    const entry = byToken.get(parsed.token.key) ?? { token: parsed.token, keys: [] }
    entry.keys.push([parsed.breakpoint, key, value])
    byToken.set(parsed.token.key, entry)
  }
  const tokens = [...byToken.values()]
  for (const [i, a] of tokens.entries()) {
    for (const b of tokens.slice(i + 1)) {
      const responsive = [a, b].some(({ keys }) => keys.some(([breakpoint]) => breakpoint !== undefined))
      if (responsive && overlap(a.token.key, b.token.key)) {
        return { problem: `Style tokens "${a.token.key}" and "${b.token.key}" overlap and one of them changes per breakpoint, so they cannot be converted to a ${baseName(to)} project` }
      }
    }
  }
  // Band i is narrowest first: the mobile levels in order, the desktop ones reversed.
  const bandsOf = (base: BreakpointBase) => (base === 'mobile' ? levels(base) : [...levels(base)].reverse())
  const source = bandsOf(from)
  const target = bandsOf(to)
  for (const { token, keys } of byToken.values()) {
    const at = (b: Breakpoint | undefined) => keys.find(([k]) => k === b)?.[2]
    // The value per band from the source cascade (mobile: the nearest level at or below; desktop: at or above).
    const bands: (string | undefined)[] = []
    for (let i = 0; i < DEVICE_BANDS; i++) {
      const chain = from === 'mobile' ? source.slice(0, i + 1).reverse() : source.slice(i)
      bands.push(chain.map(at).find(v => v !== undefined))
    }
    // Write the target cascade from its base: a level whose value differs from the one it inherits.
    const order = to === 'mobile' ? [0, 1, 2, 3] : [3, 2, 1, 0]
    let inherited: string | undefined
    for (const band of order) {
      const value = bands[band]
      if (value === undefined && inherited !== undefined) {
        return { problem: `Style token "${keys[0]![1]}" has no base value, so it cannot be converted to a ${baseName(to)} project` }
      }
      if (value !== undefined && value !== inherited) out[styleKey(token.key, target[band])] = value
      inherited = value
    }
  }
  return { style: out }
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
 * sm, md, lg, max-lg, max-md, max-sm. Colour keys holding a hex or a theme colour name come with
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
  return STYLE_TOKENS.flatMap(t => variantsOf(t).flatMap(b => [...new Set(t.values.map(v => styleKey(tokenClass(t, v), b)))]))
}

/** The contents of `app/assets/css/tokens.css`: one Tailwind `@source inline` per token. */
export function tokenSafelistCss(): string {
  const variants = `{,${ALL_BREAKPOINTS.map(b => `${b}:`).join(',')}}`
  const lines = STYLE_TOKENS.map((t) => {
    // A value rendered as another's class (`classes`) adds none of its own.
    const own = t.values.map(v => t.classes?.[v] ?? v).filter((v, i, all) => all.indexOf(v) === i)
    // A value whose class is the bare prefix (`border`) puts the dash in each other value: `border{-0,,-2}`.
    const bare = own.includes('')
    const values = own.length === 1 ? own[0] : `{${own.map(v => bare && v ? `-${v}` : v).join(',')}}`
    return `@source inline("${isResponsiveToken(t) ? variants : ''}${t.prefix ? `${t.prefix}${bare ? '' : '-'}` : ''}${values}");`
  })
  return [
    '/* Generated from shared/design/tokens.ts by `pnpm tokens:css`. Do not edit. */',
    ...lines,
    ''
  ].join('\n')
}
