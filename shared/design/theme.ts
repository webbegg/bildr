import { z } from 'zod'
import { PALETTES } from './palettes'
import type { PaletteName } from './palettes'

/**
 * A project's design system, on top of the Tailwind / Nuxt UI theme. It is
 * applied as CSS variables (`themeCss`), so the same token classes
 * (`bg-primary`, `mt-10`, `rounded-lg`) follow each project's theme without
 * rebuilding CSS.
 */

export const THEME_COLORS = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'] as const
export type ThemeColorName = typeof THEME_COLORS[number]

export const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const
export type Shade = typeof SHADES[number]

export const PALETTE_NAMES = Object.keys(PALETTES) as [PaletteName, ...PaletteName[]]

interface FontDef {
  /** The Google Fonts `wght` axis: a variable range or the static weights. */
  weights: string
  fallback: string
}

const SANS = 'ui-sans-serif, system-ui, sans-serif'
const SYSTEM_STACK = `${SANS}, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'`

const FONTS: Record<string, FontDef> = {
  'Public Sans': { weights: '100..900', fallback: SANS },
  'Inter': { weights: '100..900', fallback: SANS },
  'Roboto': { weights: '100..900', fallback: SANS },
  'Open Sans': { weights: '300..800', fallback: SANS },
  'Montserrat': { weights: '100..900', fallback: SANS },
  'Poppins': { weights: '300;400;500;600;700;800', fallback: SANS },
  'DM Sans': { weights: '100..1000', fallback: SANS },
  'Playfair Display': { weights: '400..900', fallback: 'ui-serif, Georgia, serif' }
}

export const THEME_FONTS = ['system', ...Object.keys(FONTS)] as [string, ...string[]]
/** Base radius (`--ui-radius`); Tailwind's `rounded-*` scale is derived from it. */
export const THEME_RADII = ['0', '0.125rem', '0.25rem', '0.375rem', '0.5rem', '0.75rem', '1rem'] as const
const SPACING_BASE = { compact: '0.2rem', default: '0.25rem', comfortable: '0.3rem' } as const
/** Spacing density: the Tailwind `--spacing` base every `p-*`, `m-*` and `gap-*` multiplies. */
export const THEME_SPACINGS = Object.keys(SPACING_BASE) as [keyof typeof SPACING_BASE, ...(keyof typeof SPACING_BASE)[]]

// No `i` flag: JSON Schema patterns (the MCP tool schemas) drop regex flags.
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const ThemeColorSchema = z.union([
  z.enum(PALETTE_NAMES),
  z.string().regex(HEX_COLOR, 'Use a Tailwind palette name or a #rrggbb hex colour')
]).describe('A Tailwind palette name (e.g. "indigo") or a #rrggbb hex colour (shades are generated)')

const colorShape = Object.fromEntries(THEME_COLORS.map(c => [c, ThemeColorSchema])) as Record<ThemeColorName, typeof ThemeColorSchema>

const ThemeFontSchema = z.enum(THEME_FONTS).describe('Font family ("system" uses the platform UI font)')
const ThemeRadiusSchema = z.enum(THEME_RADII).describe('Base corner radius; rounded-sm equals it, rounded-lg is twice it')
const ThemeSpacingSchema = z.enum(THEME_SPACINGS).describe('Spacing density: the --spacing base is 0.2rem, 0.25rem or 0.3rem')

export const ThemeSchema = z.strictObject({
  colors: z.strictObject(colorShape),
  font: ThemeFontSchema,
  radius: ThemeRadiusSchema,
  spacing: ThemeSpacingSchema
})

export type Theme = z.infer<typeof ThemeSchema>

/** A deep patch: any subset of the colours and of the scalar fields. */
export const ThemePatchSchema = z.strictObject({
  colors: z.strictObject(colorShape).partial().optional(),
  font: ThemeFontSchema.optional(),
  radius: ThemeRadiusSchema.optional(),
  spacing: ThemeSpacingSchema.optional()
})

export type ThemePatch = z.infer<typeof ThemePatchSchema>

/** Today's `app.config.ts` colours (primary green, neutral slate), Nuxt UI's for the rest. */
export const DEFAULT_THEME: Theme = {
  colors: { primary: 'green', secondary: 'blue', success: 'green', info: 'blue', warning: 'yellow', error: 'red', neutral: 'slate' },
  font: 'Public Sans',
  radius: '0.25rem',
  spacing: 'default'
}

export function defaultTheme(): Theme {
  return structuredClone(DEFAULT_THEME)
}

/** The theme options agents and the design editor can pick from. */
export function themeOptions() {
  return {
    colors: [...THEME_COLORS],
    palettes: [...PALETTE_NAMES],
    fonts: [...THEME_FONTS],
    radii: [...THEME_RADII],
    spacings: THEME_SPACINGS.map(name => ({ name, base: SPACING_BASE[name] }))
  }
}

/** sRGB `#rrggbb` → OKLCH (`l` 0–1, `c`, `h` in degrees). */
export function hexToOklch(hex: string): { l: number, c: number, h: number } {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}

// How far each shade moves from 500 towards white (lighter) or near-black
// (darker), and how much of the 500 chroma it keeps; tuned on Tailwind's palettes.
const LIGHTER: Partial<Record<Shade, number>> = { 50: 0.97, 100: 0.9, 200: 0.76, 300: 0.56, 400: 0.28 }
const DARKER: Partial<Record<Shade, number>> = { 600: 0.16, 700: 0.33, 800: 0.49, 900: 0.6, 950: 0.86 }
const CHROMA: Partial<Record<Shade, number>> = { 50: 0.06, 100: 0.14, 200: 0.27, 300: 0.5, 400: 0.8, 600: 1, 700: 0.9, 800: 0.75, 900: 0.6, 950: 0.4 }

const round = (n: number, digits: number) => String(Number(n.toFixed(digits)))

/**
 * The 11 shades for a custom colour: the colour itself is 500; the others
 * vary its OKLCH lightness at the same hue, damping chroma at the extremes.
 * Very light or dark inputs are clamped for the scale (not for 500 itself).
 */
export function hexShades(hex: string): Record<Shade, string> {
  const base = hexToOklch(hex)
  const l0 = Math.min(Math.max(base.l, 0.3), 0.9)
  return Object.fromEntries(SHADES.map((shade) => {
    if (shade === '500') return [shade, hex]
    const l = shade in LIGHTER ? l0 + (0.985 - l0) * LIGHTER[shade]! : l0 - (l0 - 0.2) * DARKER[shade]!
    const c = base.c * CHROMA[shade]!
    return [shade, `oklch(${round(l * 100, 1)}% ${round(c, 3)} ${round(base.h, 3)})`]
  })) as Record<Shade, string>
}

function shadeValues(name: ThemeColorName, value: string): string[] {
  if (HEX_COLOR.test(value)) {
    const shades = hexShades(value.toLowerCase())
    return SHADES.map(s => `--ui-color-${name}-${s}: ${shades[s]};`)
  }
  const palette = PALETTES[value as PaletteName]
  // Like Nuxt UI, prefer the app's own `--color-*` (e.g. the custom green) and fall back to Tailwind's.
  const variable = value === 'neutral' ? 'old-neutral' : value
  return SHADES.map(s => `--ui-color-${name}-${s}: var(--color-${variable}-${s}, ${palette[s]});`)
}

// Nuxt UI's neutral-derived colours (runtime/index.css), redeclared next to the
// shades they read so a theme never mixes them with the defaults.
const LIGHT_NEUTRALS = [
  '--ui-text-dimmed: var(--ui-color-neutral-400);',
  '--ui-text-muted: var(--ui-color-neutral-500);',
  '--ui-text-toned: var(--ui-color-neutral-600);',
  '--ui-text: var(--ui-color-neutral-700);',
  '--ui-text-highlighted: var(--ui-color-neutral-900);',
  '--ui-text-inverted: #fff;',
  '--ui-bg: #fff;',
  '--ui-bg-muted: var(--ui-color-neutral-50);',
  '--ui-bg-elevated: var(--ui-color-neutral-100);',
  '--ui-bg-accented: var(--ui-color-neutral-200);',
  '--ui-bg-inverted: var(--ui-color-neutral-900);',
  '--ui-border: var(--ui-color-neutral-200);',
  '--ui-border-muted: var(--ui-color-neutral-200);',
  '--ui-border-accented: var(--ui-color-neutral-300);',
  '--ui-border-inverted: var(--ui-color-neutral-900);'
]

const DARK_NEUTRALS = [
  '--ui-text-dimmed: var(--ui-color-neutral-500);',
  '--ui-text-muted: var(--ui-color-neutral-400);',
  '--ui-text-toned: var(--ui-color-neutral-300);',
  '--ui-text: var(--ui-color-neutral-200);',
  '--ui-text-highlighted: #fff;',
  '--ui-text-inverted: var(--ui-color-neutral-900);',
  '--ui-bg: var(--ui-color-neutral-900);',
  '--ui-bg-muted: var(--ui-color-neutral-800);',
  '--ui-bg-elevated: var(--ui-color-neutral-800);',
  '--ui-bg-accented: var(--ui-color-neutral-700);',
  '--ui-bg-inverted: #fff;',
  '--ui-border: var(--ui-color-neutral-800);',
  '--ui-border-muted: var(--ui-color-neutral-700);',
  '--ui-border-accented: var(--ui-color-neutral-700);',
  '--ui-border-inverted: #fff;'
]

function fontStack(font: string): string {
  const def = FONTS[font]
  return def ? `'${font}', ${def.fallback}` : SYSTEM_STACK
}

const block = (selector: string, lines: string[]) => `${selector} {\n${lines.map(l => `  ${l}`).join('\n')}\n}`

/**
 * The stylesheet that applies `theme`. It is unlayered, so it wins over the
 * Nuxt UI and Tailwind defaults, which live in `@layer theme`.
 */
export function themeCss(theme: Theme): string {
  const semantic = THEME_COLORS.filter(c => c !== 'neutral')
  return [
    block(':root, :host', [
      ...THEME_COLORS.flatMap(name => shadeValues(name, theme.colors[name])),
      `--font-sans: ${fontStack(theme.font)};`,
      `--ui-radius: ${theme.radius};`,
      `--spacing: ${SPACING_BASE[theme.spacing]};`
    ]),
    block(':root, :host, .light', [...semantic.map(c => `--ui-${c}: var(--ui-color-${c}-500);`), ...LIGHT_NEUTRALS]),
    block('.dark', [...semantic.map(c => `--ui-${c}: var(--ui-color-${c}-400);`), ...DARK_NEUTRALS]),
    ''
  ].join('\n')
}

/** The Google Fonts stylesheet for the theme font, or null for the system font. */
export function themeFontHref(theme: Theme): string | null {
  const def = FONTS[theme.font]
  if (!def) return null
  return `https://fonts.googleapis.com/css2?family=${theme.font.replaceAll(' ', '+')}:wght@${def.weights}&display=swap`
}
