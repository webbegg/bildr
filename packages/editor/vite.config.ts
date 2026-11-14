import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { tokenSafelistCss } from '../codegen/src/design/tokens.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * Every lucide icon name. The canvas renders the icons a model names (`i-lucide-send`), which no editor
 * source spells out, and the strict CSP leaves no remote icon API: the editor bundle carries the whole set.
 */
const lucide = createRequire(import.meta.url)('@iconify-json/lucide/icons.json') as { icons: Record<string, unknown>, aliases?: Record<string, unknown> }
const LUCIDE_ICONS = [...Object.keys(lucide.icons), ...Object.keys(lucide.aliases ?? {})].map(name => `i-lucide-${name}`)

const SAFELIST_MARKER = '/* bildr:token-safelist */'

/**
 * The canvas renders style-token classes no source spells out: its stylesheet
 * gets the token registry's Tailwind safelist (every token class with its
 * breakpoint variants) where it has the marker, before Tailwind reads it.
 */
const tokenSafelist = (): Plugin => ({
  name: 'bildr:token-safelist',
  enforce: 'pre',
  transform(code, id) {
    if (!id.split('?')[0]!.endsWith('/src/canvas/canvas.css') || !code.includes(SAFELIST_MARKER)) return undefined
    return { code: code.replace(SAFELIST_MARKER, tokenSafelistCss()), map: null }
  }
})

/**
 * The editor SPA that `@bildr/nuxt` serves at `/__bildr/` (D12). The served
 * page has a strict CSP (`script-src 'self'`, `connect-src 'self'`), so the
 * build has no inline scripts and the icons are bundled: the whole lucide set
 * (`LUCIDE_ICONS`, which the canvas needs for the icons a model names; the
 * scan of the sources, `.ts` too, stays for any other collection), so nothing
 * is fetched from the Iconify API at runtime.
 * Two pages: the editor (`index.html`) and the canvas it frames
 * (`canvas.html`, P4a), served at `/__bildr/canvas` under the same CSP.
 */
export default defineConfig({
  root,
  base: '/__bildr/',
  plugins: [
    tokenSafelist(),
    vue(),
    ui({
      root,
      ui: { colors: { primary: 'emerald', neutral: 'zinc' } },
      icon: { clientBundle: { icons: LUCIDE_ICONS, scan: { globInclude: ['src/**/*.{vue,ts}'], globExclude: ['node_modules', 'dist'] }, sizeLimitKb: 0 } }
    })
  ],
  build: {
    outDir: 'dist',
    assetsDir: '_assets',
    emptyOutDir: true,
    rolldownOptions: {
      input: { index: fileURLToPath(new URL('index.html', import.meta.url)), canvas: fileURLToPath(new URL('canvas.html', import.meta.url)) }
    },
    // No inline modulepreload polyfill script (CSP `script-src 'self'`).
    modulePreload: { polyfill: false }
  }
})
