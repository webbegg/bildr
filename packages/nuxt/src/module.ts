import { randomBytes } from 'node:crypto'
import { existsSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { addDevServerHandler, defineNuxtModule, useLogger } from '@nuxt/kit'
import { defineEventHandler, sendWebResponse, toWebRequest } from 'h3'
import { detectStarterKit } from '@bildr/codegen/starter'
import { projectReader } from './node/project.ts'
import { isModelChange, regenerate } from './node/regenerate.ts'
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

    // Regenerate the app from .bildr/: once now (edits made while nuxt dev was off), then on
    // every model change (editor saves, hand edits, git pulls). Hand-edited files are kept.
    const sync = () => {
      try {
        const result = regenerate(root)
        if (!result.ok && 'problems' in result) {
          logger.warn(['bildr model has problems, the app was not regenerated:', ...result.problems.map(problem => `  - ${problem.path}: ${problem.message}`)].join('\n'))
        } else if (!result.ok) {
          logger.warn(`bildr can't generate this model yet, the app was not regenerated: ${result.error}`)
        } else {
          const { written, deleted, detached } = result.report
          if (written.length || deleted.length) logger.success(`bildr regenerated ${written.length} file(s)${deleted.length ? `, removed ${deleted.length}` : ''}`)
          if (detached.length) logger.info(['bildr kept your edits to these generated files (detached):', ...detached.map(path => `  - ${path}`)].join('\n'))
        }
      } catch (error) {
        // A file can vanish or be unreadable mid-change; never take nuxt dev down for it.
        logger.warn(`bildr could not regenerate the app: ${(error as Error).message}`)
      }
    }
    sync()

    let watcher: FSWatcher | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const modelDir = join(root, '.bildr')
    if (existsSync(modelDir)) {
      watcher = watch(modelDir, { recursive: true }, (_event, file) => {
        // Never the manifest or temp files a sync writes: that would loop.
        if (!isModelChange(file === null ? undefined : String(file))) return
        clearTimeout(timer)
        timer = setTimeout(sync, 150)
      })
    }
    nuxt.hook('close', () => {
      clearTimeout(timer)
      watcher?.close()
    })
  }
})
