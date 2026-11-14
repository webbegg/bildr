import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelProblem } from '@bildr/codegen/model'
import { sha256 } from './sync.ts'

/**
 * The module's event bus (P3b): what open editors follow to stay in sync.
 *
 * `version` is a counter kept in memory for the dev process: it starts at 0
 * and moves up by one with every model change, whoever made it (an action,
 * an undo or redo, a file changed on disk). Other events carry the version
 * they happened at and don't move it.
 */

export type ModelChangeSource = 'action' | 'undo' | 'redo' | 'disk'

export type BildrEvent
  = | { type: 'model', version: number, files: string[], source: ModelChangeSource }
    | { type: 'regenerated', version: number, ok: boolean, problems?: ModelProblem[], error?: string }
    | { type: 'navigate', target: unknown }
    | { type: 'context', context: unknown }

export type Listener = (event: BildrEvent) => void

/** A model file and the sha256 of what is now on disk (null: no file). */
export interface FileState {
  path: string
  sha: string | null
}

/** Open subscriptions at most (each SSE stream is one): a runaway client can't grow the list without bound. */
export const MAX_LISTENERS = 64

export interface ModelEvents {
  readonly version: number
  /** Number of listeners subscribed. */
  readonly listeners: number
  /** A model change the module made (or saw): bumps the version and tells every listener. */
  modelChanged: (files: readonly FileState[], source: ModelChangeSource) => void
  /**
   * Files the `.bildr/` watcher saw change (paths from the project root). Those whose
   * content is what the module last wrote or saw are left out (the watcher also sees
   * the module's own writes); any left are one `disk` change. Returns them.
   */
  diskChanged: (root: string, paths: readonly string[]) => string[]
  /** The result of a regeneration, at the current version. */
  regenerated: (result: { ok: boolean, problems?: ModelProblem[], error?: string }) => void
  /** An event that changes no file (navigate, context). */
  publish: (event: Extract<BildrEvent, { type: 'navigate' | 'context' }>) => void
  /** Adds a listener; returns its unsubscribe, or undefined when `MAX_LISTENERS` are already subscribed. */
  subscribe: (listener: Listener) => (() => void) | undefined
}

const diskSha = (root: string, path: string): string | null => {
  const target = join(root, path)
  try {
    return lstatSync(target).isFile() ? sha256(readFileSync(target)) : null
  } catch {
    return null
  }
}

export const createModelEvents = (): ModelEvents => {
  let version = 0
  const listeners = new Set<Listener>()
  /** The content sha of each model file as the bus last knew it (written, undone, seen on disk). Bounded by the model's files. */
  const known = new Map<string, string | null>()
  const emit = (event: BildrEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // One broken listener never stops the others.
      }
    }
  }
  const modelChanged = (files: readonly FileState[], source: ModelChangeSource) => {
    for (const file of files) known.set(file.path, file.sha)
    version += 1
    emit({ type: 'model', version, files: files.map(file => file.path), source })
  }
  return {
    get version() {
      return version
    },
    get listeners() {
      return listeners.size
    },
    modelChanged,
    diskChanged: (root, paths) => {
      const changed = [...new Set(paths)].sort().map(path => ({ path, sha: diskSha(root, path) }))
        .filter(file => !known.has(file.path) || known.get(file.path) !== file.sha)
      if (changed.length) modelChanged(changed, 'disk')
      return changed.map(file => file.path)
    },
    regenerated: ({ ok, problems, error }) => emit({ type: 'regenerated', version, ok, ...(problems ? { problems } : {}), ...(error ? { error } : {}) }),
    publish: emit,
    subscribe: (listener) => {
      if (listeners.size >= MAX_LISTENERS) return undefined
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

const BUSES = Symbol.for('bildr.modelEvents')

/**
 * The bus of the project at `root` for this process: the same one across Nuxt
 * restarts within one `nuxt dev`, so the version never goes back and open
 * streams keep receiving.
 */
export const projectEvents = (root: string): ModelEvents => {
  const registry = ((globalThis as Record<symbol, unknown>)[BUSES] ??= new Map<string, ModelEvents>()) as Map<string, ModelEvents>
  let bus = registry.get(root)
  if (!bus) {
    bus = createModelEvents()
    registry.set(root, bus)
  }
  return bus
}
