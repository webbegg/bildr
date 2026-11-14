import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'

/**
 * Nuxt UI's `ULink` (the vue-router flavour the editor build uses) needs a
 * router. The canvas never navigates: an in-memory router with one route
 * that renders nothing, so links render as the app's `<a>` and stay inert.
 */
export const createCanvasRouter = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:path(.*)*', component: { render: () => null } }]
})
