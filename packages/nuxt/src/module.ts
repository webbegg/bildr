import { randomBytes } from 'node:crypto'
import { existsSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { addDevServerHandler, defineNuxtModule, useLogger } from '@nuxt/kit'
import { defineEventHandler, sendWebResponse, toWebRequest } from 'h3'
import { detectStarterKit } from '@bildr/codegen/starter'
import { projectReader } from './node/project.ts'
import { createRegenerator, isModelChange } from './node/regenerate.ts'
import type { MigrationOutcome } from './node/regenerate.ts'
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
    // The app's database, as its runtimeConfig resolves it in dev (NUXT_DB_URL overrides the generated default).
    const databaseUrl = process.env.NUXT_DB_URL ?? (nuxt.options.runtimeConfig as { db?: { url?: string } }).db?.url
    const regenerator = createRegenerator(root, databaseUrl ? { databaseUrl } : {})
    const confirmMigration = async (hash: string): Promise<MigrationOutcome> => {
      const result = await regenerator.run({ confirm: hash })
      if (!result.ok) return { kind: 'error', message: 'error' in result ? result.error : 'The model has problems' }
      logMigration(result.migration)
      return result.migration
    }
    const handle = createBildrHandler({ root, token, confirmMigration })
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
    const logMigration = (migration: MigrationOutcome) => {
      if (migration.kind === 'written' && migration.applied === false) logger.warn(`bildr wrote migration ${migration.tag} but could not apply it: ${migration.error ?? 'unknown error'}`)
      else if (migration.kind === 'written') logger.success(`bildr wrote migration ${migration.tag}${migration.applied ? ' and applied it' : ' (applied when the server starts)'}`)
      else if (migration.kind === 'error') logger.warn(`bildr could not plan the database migration, the database keeps its schema: ${migration.message}`)
      else if (migration.kind === 'pending') {
        logger.warn([
          'bildr holds a migration that would lose data until you confirm it:',
          ...migration.destructive.map(statement => `  ${statement.split('\n')[0]}`),
          `Confirm it in the bildr editor (or POST ${BASE}/api/migrations/confirm with {"hash":"${migration.hash}"}).`
        ].join('\n'))
      }
    }
    const sync = async () => {
      try {
        const result = await regenerator.run()
        if (!result.ok && 'problems' in result) {
          logger.warn(['bildr model has problems, the app was not regenerated:', ...result.problems.map(problem => `  - ${problem.path}: ${problem.message}`)].join('\n'))
        } else if (!result.ok) {
          logger.warn(`bildr can't generate this model yet, the app was not regenerated: ${result.error}`)
        } else {
          const { written, deleted, detached } = result.report
          if (written.length || deleted.length) logger.success(`bildr regenerated ${written.length} file(s)${deleted.length ? `, removed ${deleted.length}` : ''}`)
          if (detached.length) logger.info(['bildr kept your edits to these generated files (detached):', ...detached.map(path => `  - ${path}`)].join('\n'))
          logMigration(result.migration)
        }
      } catch (error) {
        // A file can vanish or be unreadable mid-change; never take nuxt dev down for it.
        logger.warn(`bildr could not regenerate the app: ${(error as Error).message}`)
      }
    }
    void sync()

    let watcher: FSWatcher | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const modelDir = join(root, '.bildr')
    if (existsSync(modelDir)) {
      watcher = watch(modelDir, { recursive: true }, (_event, file) => {
        // Never the manifest or temp files a sync writes: that would loop.
        if (!isModelChange(file === null ? undefined : String(file))) return
        clearTimeout(timer)
        timer = setTimeout(() => void sync(), 150)
      })
    }
    nuxt.hook('close', () => {
      clearTimeout(timer)
      watcher?.close()
    })
  }
})
