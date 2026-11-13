import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * The editor SPA that `@bildr/nuxt` serves at `/__bildr/` (D12). The served
 * page has a strict CSP (`script-src 'self'`, `connect-src 'self'`), so the
 * build has no inline scripts and the icons are bundled: `clientBundle.scan`
 * collects every `i-lucide-*` name in the sources (`.ts` too: the nav icons
 * live in `router.ts`; the scanner's default only reads templates) at build
 * time, so nothing is fetched from the Iconify API at runtime.
 */
export default defineConfig({
  root,
  base: '/__bildr/',
  plugins: [
    vue(),
    ui({
      root,
      ui: { colors: { primary: 'emerald', neutral: 'zinc' } },
      icon: { clientBundle: { scan: { globInclude: ['src/**/*.{vue,ts}'], globExclude: ['node_modules', 'dist'] } } }
    })
  ],
  build: {
    outDir: 'dist',
    assetsDir: '_assets',
    emptyOutDir: true,
    // No inline modulepreload polyfill script (CSP `script-src 'self'`).
    modulePreload: { polyfill: false }
  }
})
