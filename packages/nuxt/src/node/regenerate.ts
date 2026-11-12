import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { generate } from '@bildr/codegen/generate'
import { schemaIds } from '@bildr/codegen/migrate'
import { loadModel } from '@bildr/codegen/model'
import type { Model, ModelProblem } from '@bildr/codegen/model'
import type { SyncReport } from '@bildr/codegen/sync'
import { migrateProject, MIGRATIONS_DIR, schemaSources } from './migrations.ts'
import type { MigrationResult } from './migrations.ts'
import { readModelFiles } from './project.ts'
import { syncProject } from './sync.ts'

export type MigrationOutcome = MigrationResult | { kind: 'error', message: string }

export type RegenerateResult
  = | { ok: true, report: SyncReport, migration: MigrationOutcome }
    | { ok: false, problems: ModelProblem[] }
    | { ok: false, error: string }

export interface RegenerateOptions {
  /** The hash of a pending destructive migration the user confirmed. */
  confirm?: string
  /** The app database (libSQL URL). When set, a migration is applied as soon as it is written. */
  databaseUrl?: string
}

/** No stored entities and no migrations yet: nothing to migrate, and drizzle-kit isn't needed. */
const needsMigrations = (root: string, model: Model) =>
  Object.keys(schemaIds(model).tables).length > 0 || existsSync(join(root, MIGRATIONS_DIR, 'meta/_journal.json'))

/**
 * One regeneration (T7d, T8): load `.bildr/`, generate the whole app, write
 * the database migration for it, then sync the files (decision D1: untouched
 * managed files are rewritten, hand-edited ones detached and kept). The
 * migration is written and applied first, so the app code never runs ahead
 * of its database (a confirmation changes no file, so no reload would apply it). An invalid model or one the generator can't handle yet writes
 * nothing. A migration that can't be planned doesn't hold the app back: the
 * database keeps its schema and the outcome says why.
 */
export const regenerate = async (root: string, options: RegenerateOptions = {}): Promise<RegenerateResult> => {
  const loaded = loadModel(readModelFiles(root))
  if (!loaded.ok) return { ok: false, problems: loaded.problems }
  let files
  try {
    files = generate(loaded.model)
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
  let migration: MigrationOutcome = { kind: 'none' }
  if (needsMigrations(root, loaded.model)) {
    try {
      migration = await migrateProject(root, loaded.model, schemaSources(root, files), options)
    } catch (error) {
      const message = (error as Error).message
      migration = { kind: 'error', message: /drizzle-kit/.test(message) ? message : `${message} (is drizzle-kit installed?)` }
    }
  }
  return { ok: true, report: syncProject(root, files).report, migration }
}

/**
 * Regenerations of one project, one at a time: overlapping runs (watcher,
 * editor saves, a confirmation) would otherwise plan the same migration twice.
 */
export const createRegenerator = (root: string, defaults: RegenerateOptions = {}) => {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    run: (options: RegenerateOptions = {}): Promise<RegenerateResult> => {
      const next = queue.then(() => regenerate(root, { ...defaults, ...options }))
      queue = next.catch(() => {})
      return next
    }
  }
}

/**
 * Whether a change the `.bildr/` watcher saw (a path relative to `.bildr/`)
 * should regenerate. The manifest a sync writes, atomic-write temp files and
 * the cache never do, or every sync would trigger the next one.
 */
export const isModelChange = (file: string | undefined): boolean => {
  if (!file) return false
  const path = file.split(sep).join('/')
  return path.endsWith('.json') && path !== 'manifest.json' && path !== '.cache' && !path.startsWith('.cache/')
}
