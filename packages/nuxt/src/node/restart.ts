import type { SyncReport } from '@bildr/codegen/sync'

/**
 * Nuxt restarts after a regenerate (log L9). Nuxt reads the project's and each
 * layer's `nuxt.config` (and `.nuxtrc`, `.nuxtignore`) once, when it starts, and
 * finds its layers then too. Everything else a regenerate writes (pages,
 * components, `app.config`, server routes) Nuxt picks up while it runs.
 *
 * The first regenerate runs in the module setup, after Nuxt merged the configs,
 * so a data source added while `nuxt dev` was off left `runtimeConfig` without it
 * until a manual restart. A restart re-runs the setup, whose regenerate then
 * writes nothing (the sync only writes what differs), so it never loops.
 */

export interface RestartRequest {
  /** A new process (the layers changed) instead of a reload in place. */
  hard: boolean
  /** What made it necessary, for the log. */
  files: string[]
}

/** Read by Nuxt (or nuxi) only at startup: the project's config files and each layer's `nuxt.config`. */
const STARTUP_FILE = /^(?:(?:layers\/[^/]+\/)?nuxt\.config\.[cm]?[jt]s|\.nuxtrc|\.nuxtignore)$/
const LAYER = /^layers\/([^/]+)\//

/**
 * Whether the files a regenerate wrote or removed (project-relative) need a Nuxt
 * restart. `loadedLayers`: the names of the `layers/<name>` Nuxt loaded; a file
 * in another layer, or a layer config that goes, changes the set of layers.
 */
export const needsRestart = (changes: Pick<SyncReport, 'written' | 'removed'>, loadedLayers: readonly string[]): RestartRequest | undefined => {
  const loaded = new Set(loadedLayers)
  const files = [...changes.written, ...changes.removed].filter(path => STARTUP_FILE.test(path))
  const newLayers = new Map<string, string>()
  for (const path of changes.written) {
    const layer = LAYER.exec(path)?.[1]
    if (layer && !loaded.has(layer) && !newLayers.has(layer)) newLayers.set(layer, path)
  }
  for (const [layer, path] of newLayers) {
    if (!files.some(file => file.startsWith(`layers/${layer}/`))) files.push(path)
  }
  if (!files.length) return undefined
  const layerGoes = changes.removed.some(path => STARTUP_FILE.test(path) && LAYER.test(path))
  return { hard: newLayers.size > 0 || layerGoes, files }
}

export interface Restarter {
  /**
   * The first build is done. nuxi hooks `restart` only once Nuxt is ready, and a
   * restart while the first build still runs races it (two builds write `.nuxt/`).
   */
  built: () => void
  /** One regenerate's request (or none). */
  request: (request: RestartRequest | undefined) => void
}

/**
 * Restarts one Nuxt instance at most once: requests made before its first build is done are
 * merged into one, and a restart replaces this instance (its module setup runs
 * again in the next one).
 */
export const createRestarter = ({ restart, log }: { restart: (options: { hard: boolean }) => unknown, log: (message: string) => void }): Restarter => {
  let built = false
  let restarted = false
  let pending: RestartRequest | undefined
  const flush = () => {
    if (!built || !pending || restarted) return
    restarted = true
    const { hard, files } = pending
    pending = undefined
    log(['bildr: config changed, restarting Nuxt', ...files.map(file => `  - ${file}`)].join('\n'))
    restart({ hard })
  }
  return {
    built: () => {
      built = true
      flush()
    },
    request: (request) => {
      if (!request || restarted) return
      pending = pending
        ? { hard: pending.hard || request.hard, files: [...new Set([...pending.files, ...request.files])] }
        : request
      flush()
    }
  }
}
