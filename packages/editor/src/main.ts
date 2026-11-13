import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import { routes } from './router.ts'
import { STATUS_KEY, createStatus } from './status.ts'
import './main.css'

const router = createRouter({ history: createWebHashHistory(), routes })

createApp(App)
  .use(router)
  .use(ui)
  .provide(STATUS_KEY, createStatus())
  .mount('#app')
