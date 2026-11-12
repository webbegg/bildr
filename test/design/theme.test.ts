import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PALETTES } from '#shared/design/palettes'
import { palettesModule, parseTailwindPalettes } from '#shared/design/paletteSource'
import { DEFAULT_THEME, hexShades, hexToOklch, spacingBasePx, THEME_FONTS, THEME_RADII, THEME_SPACINGS, themeColorValue, themeCss, themeFontHref, themeNeutralColor, ThemePatchSchema, ThemeSchema } from '#shared/design/theme'
import type { Theme } from '#shared/design/theme'

const TAILWIND_THEME = new URL('../../node_modules/tailwindcss/theme.css', import.meta.url)
const PALETTES_TS = new URL('../../packages/codegen/src/design/palettes.ts', import.meta.url)

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']

function lightness(oklch: string): number {
  return Number(/^oklch\(([\d.]+)% /.exec(oklch)![1]) / 100
}

describe('theme validation', () => {
  it('accepts the default theme, which mirrors app.config (primary green, neutral slate)', () => {
    expect(ThemeSchema.parse(DEFAULT_THEME)).toEqual(DEFAULT_THEME)
    expect(DEFAULT_THEME).toEqual({
      colors: { primary: 'green', secondary: 'blue', success: 'green', info: 'blue', warning: 'yellow', error: 'red', neutral: 'slate' },
      font: 'Public Sans',
      radius: '0.25rem',
      spacing: 'default'
    })
  })

  it('accepts palette names and #rrggbb hex colours', () => {
    const theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: 'indigo', secondary: '#E11D48' } }
    expect(ThemeSchema.safeParse(theme).success).toBe(true)
  })

  it('rejects an unknown palette, a bad hex, and values outside the option lists', () => {
    const bad = (patch: object) => ThemeSchema.safeParse({ ...DEFAULT_THEME, ...patch }).success
    expect(bad({ colors: { ...DEFAULT_THEME.colors, primary: 'grass' } })).toBe(false)
    expect(bad({ colors: { ...DEFAULT_THEME.colors, primary: '#e11d4' } })).toBe(false)
    expect(bad({ colors: { ...DEFAULT_THEME.colors, primary: 'e11d48' } })).toBe(false)
    expect(bad({ font: 'Comic Sans' })).toBe(false)
    expect(bad({ radius: '3px' })).toBe(false)
    expect(bad({ spacing: 'huge' })).toBe(false)
    expect(bad({ colors: { primary: 'green' } })).toBe(false)
  })

  it('validates a partial patch', () => {
    expect(ThemePatchSchema.safeParse({ colors: { primary: '#e11d48' }, radius: '1rem' }).success).toBe(true)
    expect(ThemePatchSchema.safeParse({}).success).toBe(true)
    expect(ThemePatchSchema.safeParse({ colors: { accent: 'red' } }).success).toBe(false)
    expect(ThemePatchSchema.safeParse({ spacing: 'huge' }).success).toBe(false)
  })

  it('lists the curated options', () => {
    expect(THEME_FONTS).toEqual(expect.arrayContaining(['system', 'Public Sans', 'Inter']))
    expect(THEME_RADII).toEqual(['0', '0.125rem', '0.25rem', '0.375rem', '0.5rem', '0.75rem', '1rem'])
    expect(THEME_SPACINGS).toEqual(['compact', 'default', 'comfortable'])
  })
})

describe('hex shades', () => {
  it('converts sRGB hex to oklch', () => {
    // Tailwind's rose-600 is #e11d48 ≈ oklch(58.6% 0.253 17.585).
    const { l, c, h } = hexToOklch('#e11d48')
    expect(l).toBeCloseTo(0.586, 2)
    expect(c).toBeCloseTo(0.222, 1)
    expect(h).toBeCloseTo(17.6, 0)
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3)
    expect(hexToOklch('#000000').l).toBeCloseTo(0, 3)
  })

  it('keeps the given colour as 500 and gets darker shade by shade', () => {
    const shades = hexShades('#e11d48')
    expect(Object.keys(shades)).toEqual(SHADES)
    expect(shades['500']).toBe('#e11d48')
    const l500 = hexToOklch('#e11d48').l
    const ls = SHADES.map(s => s === '500' ? l500 : lightness(shades[s as keyof typeof shades]))
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThan(ls[i - 1]!)
  })

  it('damps chroma at the extremes', () => {
    const shades = hexShades('#e11d48')
    const chroma = (s: string) => Number(/ ([\d.]+) [\d.]+\)$/.exec(s)![1])
    const c500 = hexToOklch('#e11d48').c
    expect(chroma(shades['50'])).toBeLessThan(c500 / 5)
    expect(chroma(shades['950'])).toBeLessThan(c500)
  })
})

describe('themeCss', () => {
  it('maps a palette colour to its Tailwind shades, with light and dark semantic colours', () => {
    const css = themeCss({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: 'indigo' } })
    expect(css).toContain('--ui-color-primary-500: var(--color-indigo-500, oklch(58.5% 0.233 277.117));')
    expect(css).toContain('--ui-color-primary-950: var(--color-indigo-950, oklch(25.7% 0.09 281.288));')
    expect(css).toMatch(/:root, :host, \.light \{[^}]*--ui-primary: var\(--ui-color-primary-500\);/)
    expect(css).toMatch(/\.dark \{[^}]*--ui-primary: var\(--ui-color-primary-400\);/)
    // Nuxt UI keeps its own neutral palette under `old-neutral`.
    expect(themeCss({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, neutral: 'neutral' } }))
      .toContain('--ui-color-neutral-500: var(--color-old-neutral-500, oklch(55.6% 0 none));')
  })

  it('generates shades for a hex colour', () => {
    const css = themeCss({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#e11d48' } })
    expect(css).toContain('--ui-color-primary-500: #e11d48;')
    expect(css).toMatch(/--ui-color-primary-50: oklch\([\d.]+% [\d.]+ [\d.]+\);/)
  })

  it('redeclares the neutral-derived text, background and border colours for light and dark', () => {
    const css = themeCss(DEFAULT_THEME)
    expect(css).toMatch(/:root, :host, \.light \{[^}]*--ui-text: var\(--ui-color-neutral-700\);[^}]*--ui-bg-elevated: var\(--ui-color-neutral-100\);[^}]*--ui-border: var\(--ui-color-neutral-200\);/)
    expect(css).toMatch(/\.dark \{[^}]*--ui-text: var\(--ui-color-neutral-200\);[^}]*--ui-bg: var\(--ui-color-neutral-900\);/)
    expect(css).not.toContain('--ui-neutral:')
  })

  it('sets the font, radius and spacing', () => {
    const theme: Theme = { ...DEFAULT_THEME, font: 'Inter', radius: '1rem', spacing: 'comfortable' }
    const css = themeCss(theme)
    expect(css).toContain('--font-sans: \'Inter\', ui-sans-serif, system-ui, sans-serif;')
    expect(css).toContain('--ui-radius: 1rem;')
    expect(css).toContain('--spacing: 0.3rem;')
    expect(themeCss({ ...theme, spacing: 'compact' })).toContain('--spacing: 0.2rem;')
    expect(themeCss({ ...theme, font: 'system' })).toContain('--font-sans: ui-sans-serif, system-ui, sans-serif')
  })

  it('is unlayered, so it wins over the Nuxt UI and Tailwind defaults in @layer theme', () => {
    expect(themeCss(DEFAULT_THEME)).not.toContain('@layer')
  })
})

describe('theme colour values (for editor swatches, outside the themed document)', () => {
  it('resolves a palette shade like the generated CSS does', () => {
    expect(themeColorValue(DEFAULT_THEME, 'primary', '500')).toBe('var(--color-green-500, oklch(72.3% 0.219 149.579))')
    expect(themeColorValue(DEFAULT_THEME, 'neutral', '700')).toBe('var(--color-slate-700, oklch(37.2% 0.044 257.287))')
    expect(themeColorValue({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, info: 'neutral' } }, 'info', '50'))
      .toBe('var(--color-old-neutral-50, oklch(98.5% 0 none))')
  })

  it('resolves a hex colour to itself at 500 and to generated shades elsewhere', () => {
    const theme: Theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#E11D48' } }
    expect(themeColorValue(theme, 'primary', '500')).toBe('#e11d48')
    expect(themeColorValue(theme, 'primary', '50')).toBe(hexShades('#e11d48')['50'])
  })

  it('resolves the neutral design colours (light mode) per utility kind', () => {
    expect(themeNeutralColor(DEFAULT_THEME, 'bg', 'default')).toBe('#fff')
    expect(themeNeutralColor(DEFAULT_THEME, 'bg', 'muted')).toBe('var(--color-slate-50, oklch(98.4% 0.003 247.858))')
    expect(themeNeutralColor(DEFAULT_THEME, 'text', 'default')).toBe('var(--color-slate-700, oklch(37.2% 0.044 257.287))')
    expect(themeNeutralColor(DEFAULT_THEME, 'text', 'inverted')).toBe('#fff')
    expect(themeNeutralColor(DEFAULT_THEME, 'border', 'accented')).toBe('var(--color-slate-300, oklch(86.9% 0.022 252.894))')
    expect(themeNeutralColor(DEFAULT_THEME, 'bg', 'highlighted')).toBeUndefined()
  })

  it('gives the spacing base in px for each density', () => {
    expect(spacingBasePx('compact')).toBe(3.2)
    expect(spacingBasePx('default')).toBe(4)
    expect(spacingBasePx('comfortable')).toBe(4.8)
  })
})

describe('themeFontHref', () => {
  it('returns the Google Fonts stylesheet, or null for the system font', () => {
    expect(themeFontHref({ ...DEFAULT_THEME, font: 'Inter' })).toBe('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap')
    expect(themeFontHref({ ...DEFAULT_THEME, font: 'Playfair Display' })).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400..900&display=swap')
    expect(themeFontHref({ ...DEFAULT_THEME, font: 'system' })).toBeNull()
  })
})

describe('palettes', () => {
  it('has every Tailwind default palette with 11 shades', () => {
    expect(Object.keys(PALETTES)).toEqual(expect.arrayContaining(['red', 'green', 'indigo', 'rose', 'slate', 'neutral', 'zinc']))
    expect(PALETTES.indigo['500']).toBe('oklch(58.5% 0.233 277.117)')
    for (const shades of Object.values(PALETTES)) expect(Object.keys(shades)).toEqual(SHADES)
  })

  it('matches the generated packages/codegen/src/design/palettes.ts (run `node --experimental-strip-types scripts/generate-palettes.ts` after a Tailwind update)', () => {
    const source = parseTailwindPalettes(readFileSync(TAILWIND_THEME, 'utf8'))
    expect(readFileSync(PALETTES_TS, 'utf8')).toBe(palettesModule(source))
  })
})
