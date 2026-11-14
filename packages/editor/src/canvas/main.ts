import { createApp } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import CanvasApp from './CanvasApp.vue'
import { createCanvasRouter } from './router.ts'
import './canvas.css'

/** The canvas entry (`canvas.html`), which `@bildr/nuxt` serves at `/__bildr/canvas` for the editor to frame. */
createApp(CanvasApp)
  .use(createCanvasRouter())
  .use(ui)
  .mount('#canvas')
