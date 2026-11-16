import type { RouteRecordRaw } from 'vue-router'

/**
 * The editor's screens. `main.ts` uses hash history, so the module only serves one page.
 * Navigation is the top bar's view menu (`editor/menu.ts`), not this list: `bar` marks the screens that
 * have no editor toolbar of their own and get the ScreenBar, and `title` names the screens the menu has no entry for.
 */
export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/design' },
  { path: '/design', name: 'design', component: () => import('./views/DesignView.vue') },
  { path: '/data', name: 'data', component: () => import('./views/DataView.vue') },
  { path: '/model', name: 'model', component: () => import('./views/ModelView.vue'), meta: { bar: true, title: 'Model' } },
  { path: '/code', name: 'code', component: () => import('./views/CodeView.vue'), meta: { bar: true } },
  { path: '/health', name: 'health', component: () => import('./views/HealthView.vue'), meta: { bar: true } },
  { path: '/migrations', name: 'migrations', component: () => import('./views/MigrationsView.vue'), meta: { bar: true, title: 'Migrations' } },
  { path: '/:rest(.*)*', redirect: '/design' }
]
