import { randomBytes } from 'node:crypto'
import { existsSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { addDevServerHandler, defineNuxtModule, useLogger } from '@nuxt/kit'
import { defineEventHandler, sendWebResponse, toWebRequest } from 'h3'
import { loadModel } from '@bildr/codegen/model'
import { detectStarterKit } from '@bildr/codegen/starter'
import { projectReader, readModelFiles } from './node/project.ts'
import { BASE, createBildrHandler } from './server/handler.ts'

/**
 * `@bildr/nuxt`: the bildr editor inside `nuxt dev` (decisions D8, D9).
 *
 * - Dev only: nothing is registered for `nuxt build`/`generate`, so the app
 *   never ships bildr and builds the same without this module.
 * - Starter-kit projects only: anything else gets the reasons and a pointer
 *   to `pnpm create bildr`, and the app keeps running without the editor.
 * - The editor API is local-only and needs the per-session token printed in
 *   the dev server log (also used by the DevTools tab).
 */

export interface ModuleOptions {
  /** Turn the editor off without removing the module. Default true. */
  enabled: boolean
}

interface DevtoolsTab {
  name: string
  title: string
  icon: string
  view: { type: 'iframe', src: string }
}

export default defineNuxtModule<ModuleOptions>({
  meta: { name: '@bildr/nuxt', configKey: 'bildr' },
  defaults: { enabled: true },
  setup(options, nuxt) {
    if (!nuxt.options.dev || !options.enabled) return
    const logger = useLogger('bildr')
    const root = nuxt.options.rootDir

    const check = detectStarterKit(projectReader(root))
    if (!check.ok) {
      logger.warn(['The bildr editor is off for this project:', ...check.reasons.map(reason => `  - ${reason}`), check.hint].join('\n'))
      return
    }

    const token = randomBytes(24).toString('hex')
    const handle = createBildrHandler({ root, token })
    addDevServerHandler({
      route: BASE,
      handler: {
        nitro2: defineEventHandler(async (event) => {
          const response = await handle(toWebRequest(event), { remoteAddress: event.node.req.socket.remoteAddress })
          return sendWebResponse(event, response)
        })
      }
    })

    const editorPath = `${BASE}?token=${token}`
    nuxt.hook('listen', (_server, listener: { url?: string }) => {
      const base = (listener.url ?? 'http://localhost:3000/').replace(/\/$/, '')
      logger.info(`bildr editor: ${base}${editorPath}`)
    })
    ;(nuxt.hooks as unknown as { hook: (name: string, fn: (tabs: DevtoolsTab[]) => void) => void })
      .hook('devtools:customTabs', tabs => tabs.push({ name: 'bildr', title: 'bildr', icon: 'carbon:paint-brush', view: { type: 'iframe', src: editorPath } }))

    // Report model problems as soon as a .bildr/ file changes (hand edits, git pulls).
    let watcher: FSWatcher | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const modelDir = join(root, '.bildr')
    if (existsSync(modelDir)) {
      watcher = watch(modelDir, { recursive: true }, (_event, file) => {
        if (!file || String(file).startsWith('.cache')) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          const result = loadModel(readModelFiles(root))
          if (result.ok) logger.success('bildr model is valid')
          else logger.warn(['bildr model has problems:', ...result.problems.map(problem => `  - ${problem.path}: ${problem.message}`)].join('\n'))
        }, 150)
      })
    }
    nuxt.hook('close', () => {
      clearTimeout(timer)
      watcher?.close()
    })
  }
})
