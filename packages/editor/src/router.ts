import type { RouteRecordRaw } from 'vue-router'

/** The editor's screens. `main.ts` uses hash history, so the module only serves one page. */
export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/design' },
  { path: '/design', name: 'design', component: () => import('./views/DesignView.vue'), meta: { label: 'Design', icon: 'i-lucide-pen-tool' } },
  { path: '/model', name: 'model', component: () => import('./views/ModelView.vue'), meta: { label: 'Model', icon: 'i-lucide-boxes' } },
  { path: '/code', name: 'code', component: () => import('./views/CodeView.vue'), meta: { label: 'View code', icon: 'i-lucide-file-code' } },
  { path: '/health', name: 'health', component: () => import('./views/HealthView.vue'), meta: { label: 'Health', icon: 'i-lucide-heart-pulse' } },
  { path: '/migrations', name: 'migrations', component: () => import('./views/MigrationsView.vue'), meta: { label: 'Migrations', icon: 'i-lucide-database-zap' } },
  { path: '/:rest(.*)*', redirect: '/design' }
]
