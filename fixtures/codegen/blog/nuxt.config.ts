// Scaffolded by bildr once. This file is yours: bildr never rewrites it.
// Feature modules live in ~~/layers and are registered automatically.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  // Apps, not websites: a client-rendered SPA. Nitro still serves the API.
  ssr: false,
  modules: ['@nuxt/eslint'],
  devtools: { enabled: true },
  experimental: { typedPages: true }
})
