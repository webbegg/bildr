// Scaffolded by bildr once. This file is yours: bildr never rewrites it.
// Feature modules live in ~~/layers and are registered automatically.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  // Apps, not websites: a client-rendered SPA. Nitro still serves the API.
  ssr: false,
  // @bildr/nuxt is dev only: `nuxt dev` serves the editor at /__bildr; builds never include it.
  modules: ['@nuxt/eslint', '@bildr/nuxt'],
  devtools: { enabled: true },
  // Icons ship with the app (the installed @iconify-json collections), so it never calls the Iconify API at runtime.
  icon: { clientBundle: { scan: true } },
  experimental: { typedPages: true }
})
