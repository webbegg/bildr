/**
 * Build-time helpers that turn Tailwind's `theme.css` into
 * `shared/design/palettes.ts`. Used by `scripts/generate-palettes.ts` and by
 * the drift test; the app imports the generated table instead.
 */

export type PaletteTable = Record<string, Record<string, string>>

const SHADE_ORDER = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']

/** Every `--color-<name>-<shade>` palette in `css`, in source order. */
export function parseTailwindPalettes(css: string): PaletteTable {
  const palettes: PaletteTable = {}
  for (const [, name, shade, value] of css.matchAll(/--color-([a-z]+)-(\d+):\s*([^;]+);/g)) {
    palettes[name!] ??= {}
    palettes[name!]![shade!] = value!.trim()
  }
  return Object.fromEntries(Object.entries(palettes)
    .filter(([, shades]) => SHADE_ORDER.every(s => s in shades))
    .map(([name, shades]) => [name, Object.fromEntries(SHADE_ORDER.map(s => [s, shades[s]!]))]))
}

/** The source of `shared/design/palettes.ts` for `palettes`. */
export function palettesModule(palettes: PaletteTable): string {
  const body = Object.entries(palettes).map(([name, shades]) => {
    const entries = Object.entries(shades).map(([shade, value]) => `    ${shade}: '${value}'`).join(',\n')
    return `  ${name}: {\n${entries}\n  }`
  }).join(',\n')
  return [
    '/* Generated from tailwindcss/theme.css by scripts/generate-palettes.ts. Do not edit. */',
    '',
    '/** Tailwind\'s default palettes: name → shade → oklch colour. */',
    `export const PALETTES = {\n${body}\n} as const`,
    '',
    'export type PaletteName = keyof typeof PALETTES',
    ''
  ].join('\n')
}
