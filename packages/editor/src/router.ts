import type { RouteRecordRaw } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** The screen has no editor toolbar of its own, so it gets the ScreenBar. */
    bar?: boolean
    /** What the view menu shows for a screen it has no entry for. */
    title?: string
  }
}

/**
 * The editor's screens. `main.ts` uses hash history, so the module only serves one page.
 * Navigation is the top bar's view menu (`editor/menu.ts`), not this list: `bar` marks the screens that
 * have no editor toolbar of their own and get the ScreenBar, and `title` names the screens the menu has no entry for.
 */
export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/design' },
  { path: '/design', name: 'design', component: () => import('./views/DesignView.vue') },
  { path: '/data', name: 'data', component: () => import('./views/DataView.vue') },
  // The Model screen is retired (S3): its files are All model files in the Data workspace, and a deep link's `?path=` is its `file=`.
  { path: '/model', redirect: to => ({ path: '/data', query: { item: 'files', ...(typeof to.query.path === 'string' && to.query.path ? { file: to.query.path } : {}) } }) },
  { path: '/code', name: 'code', component: () => import('./views/CodeView.vue'), meta: { bar: true } },
  { path: '/health', name: 'health', component: () => import('./views/HealthView.vue'), meta: { bar: true } },
  // The pending migration is shown in the Data workspace (S6): its tree's Migrations entry, which the banners link to.
  { path: '/migrations', redirect: { path: '/data', query: { item: 'migrations' } } },
  { path: '/:rest(.*)*', redirect: '/design' }
]
