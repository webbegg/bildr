/**
 * When the `.bildr/` watcher's changes become a regeneration, and an announcement to the open editors.
 *
 * Every regeneration that writes a file rebuilds Nitro (the dev server's bundle), and while it rebuilds the app's API waits;
 * a request that reaches the dev server then can be lost for good (seen: one request that never answered, 300 s, in the
 * Data workspace's e2e). Editing sample data is the one change that comes in long streams, a write per cell, each
 * of which rewrites only the generated seed. So a stream of sample-row writes regenerates once, when it pauses, and not
 * once per cell; every other change regenerates 150 ms after it, as it always did.
 */

/** How long after a change the app regenerates, and the editors hear of it. */
export const SETTLE_MS = 150
/** How long sample-row writes must have stopped before the app regenerates for them. */
export const SAMPLE_SETTLE_MS = 1500
/** The most a stream of sample-row writes can hold the regeneration back (a user who never pauses still gets one). */
export const SAMPLE_MAX_WAIT_MS = 10_000

/** A path relative to `.bildr/` that is the sample rows of an entity: `modules/<module>/fixtures/<entity>.json`. */
export const isSampleData = (file: string): boolean => /^modules\/[^/]+\/fixtures\/[^/]+\.json$/.test(file)

export interface Coalescer {
  /** A changed model file, as a path relative to `.bildr/`. */
  add: (file: string) => void
  /** Drops whatever is waiting. */
  cancel: () => void
}

/**
 * `sync` gets the files changed since the last one, once the changes are done: 150 ms after the last, or, when all of
 * them are sample rows, once those pause for `SAMPLE_SETTLE_MS` (at most `SAMPLE_MAX_WAIT_MS` after the first). `notify`
 * gets the same files 150 ms after the last change whatever they are: editors need not wait for the app.
 */
export const createCoalescer = (handlers: { sync: (files: string[]) => void, notify: (files: string[]) => void }): Coalescer => {
  let toSync = new Set<string>()
  let toNotify = new Set<string>()
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let notifyTimer: ReturnType<typeof setTimeout> | undefined
  let firstAt = 0
  return {
    add: (file) => {
      const now = Date.now()
      if (toSync.size === 0) firstAt = now
      toSync.add(file)
      toNotify.add(file)

      clearTimeout(notifyTimer)
      notifyTimer = setTimeout(() => {
        const files = [...toNotify]
        toNotify = new Set()
        handlers.notify(files)
      }, SETTLE_MS)

      const samplesOnly = [...toSync].every(isSampleData)
      const delay = samplesOnly ? Math.max(0, Math.min(SAMPLE_SETTLE_MS, firstAt + SAMPLE_MAX_WAIT_MS - now)) : SETTLE_MS
      clearTimeout(syncTimer)
      syncTimer = setTimeout(() => {
        const files = [...toSync]
        toSync = new Set()
        handlers.sync(files)
      }, delay)
    },
    cancel: () => {
      clearTimeout(syncTimer)
      clearTimeout(notifyTimer)
      toSync = new Set()
      toNotify = new Set()
    }
  }
}
