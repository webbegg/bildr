import { readFileSync, writeFileSync } from 'node:fs'
import { palettesModule, parseTailwindPalettes } from '../shared/design/paletteSource.ts'

/** Writes the Tailwind default palette table the project themes pick from. */
const source = new URL('../node_modules/tailwindcss/theme.css', import.meta.url)
const target = new URL('../shared/design/palettes.ts', import.meta.url)
writeFileSync(target, palettesModule(parseTailwindPalettes(readFileSync(source, 'utf8'))))
console.log(`Wrote ${target.pathname}`)
