import { writeFileSync } from 'node:fs'
import { tokenSafelistCss } from '../shared/design/tokens.ts'

/** Writes the Tailwind safelist for the style-token registry. */
const target = new URL('../app/assets/css/tokens.css', import.meta.url)
writeFileSync(target, tokenSafelistCss())
console.log(`Wrote ${target.pathname}`)
