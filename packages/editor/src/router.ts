import type { RouteRecordRaw } from 'vue-router'
import { ADVANCED_PATH, SIMPLE_PATH, needsAdvanced } from './editor/dataRoutes.ts'

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
 *
 * Data is two screens (simple data, SD-1): the simple section at `/data` (the menu's Data entry) and today's workspace at `/data/advanced`,
 * which keeps every query it had. A `/data` link that names something only the workspace has (a collection, a connection, a query, an
 * action, All model files, the migration, a tab, a file) goes there with its query, as `/model` and `/migrations` do, so every old link
 * keeps landing where it did.
 */
export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/design' },
  { path: '/design', name: 'design', component: () => import('./views/DesignView.vue') },
  {
    path: SIMPLE_PATH,
    name: 'data',
    component: () => import('./views/SimpleDataView.vue'),
    beforeEnter: to => needsAdvanced(to.query) ? { path: ADVANCED_PATH, query: to.query, hash: to.hash } : true
  },
  { path: ADVANCED_PATH, name: 'data-advanced', component: () => import('./views/DataView.vue') },
  // The Model screen is retired (S3): its files are All model files in the Data workspace, and a deep link's `?path=` is its `file=`.
  { path: '/model', redirect: to => ({ path: ADVANCED_PATH, query: { item: 'files', ...(typeof to.query.path === 'string' && to.query.path ? { file: to.query.path } : {}) } }) },
  { path: '/code', name: 'code', component: () => import('./views/CodeView.vue'), meta: { bar: true } },
  { path: '/health', name: 'health', component: () => import('./views/HealthView.vue'), meta: { bar: true } },
  // The pending migration is shown in the Data workspace (S6): its tree's Migrations entry, which the banners link to.
  { path: '/migrations', redirect: { path: ADVANCED_PATH, query: { item: 'migrations' } } },
  { path: '/:rest(.*)*', redirect: '/design' }
]
