import { existsSync, rmSync } from 'node:fs'
import { join, sep } from 'node:path'
import { generate, hasDatabase } from '@bildr/codegen/generate'
import { schemaIds } from '@bildr/codegen/migrate'
import { generatorHold } from '@bildr/codegen/starter'
import { loadModel } from '@bildr/codegen/model'
import type { Model, ModelProblem } from '@bildr/codegen/model'
import type { GeneratedFile, SyncReport } from '@bildr/codegen/sync'
import { projectDrift, readPendingMigration, updateHealth } from './health.ts'
import type { HealthPatch } from './health.ts'
import { migrateProject, MIGRATIONS_DIR, PENDING_FILE, schemaSources } from './migrations.ts'
import type { MigrationResult } from './migrations.ts'
import { readModelFiles, resolvesInside } from './project.ts'
import { syncProject } from './sync.ts'

export type MigrationOutcome = MigrationResult | { kind: 'error', message: string }

export type RegenerateResult = (
  | { ok: true, report: SyncReport, migration: MigrationOutcome }
  | { ok: false, problems: ModelProblem[] }
  | { ok: false, error: string }
) & {
  /** Why the Health report couldn't be refreshed (it never changes the rest of the result). */
  healthError?: string
}

export interface RegenerateOptions {
  /** The hash of a pending destructive migration the user confirmed. */
  confirm?: string
  /** The app database (libSQL URL). When set, a migration is applied as soon as it is written. */
  databaseUrl?: string
}

/**
 * No database (V7: no sqlite data source), or no stored entities and no migrations yet:
 * nothing to migrate, and drizzle-kit isn't needed.
 */
const needsMigrations = (root: string, model: Model) => hasDatabase(model)
  && (Object.keys(schemaIds(model).tables).length > 0 || existsSync(join(root, MIGRATIONS_DIR, 'meta/_journal.json')))

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
  if (!loaded.ok) return withHealth(root, { ok: false, problems: loaded.problems }, () => ({ model: { ok: false, problems: loaded.problems } }))
  // T6: a project of another generator keeps its code (the model still edits) until its owner upgrades it.
  const hold = generatorHold(loaded.model.project.generatorVersion)
  if (hold) {
    return withHealth(root, { ok: false, error: hold }, () => ({
      model: { ok: true },
      drift: { error: hold },
      migration: readPendingMigration(root)
    }))
  }
  let files: GeneratedFile[]
  try {
    files = generate(loaded.model)
  } catch (error) {
    const message = (error as Error).message
    return withHealth(root, { ok: false, error: message }, () => ({
      model: { ok: true },
      drift: { error: `bildr can't generate this model yet, so drift is unknown: ${message}` },
      migration: readPendingMigration(root)
    }))
  }
  let migration: MigrationOutcome = { kind: 'none' }
  // Without a database nothing can wait for confirmation: a plan left from when it had one goes.
  // Same boundary as migrateProject: never through a .bildr/.cache symlink that leaves the project.
  if (!hasDatabase(loaded.model) && resolvesInside(root, join(root, '.bildr/.cache'))) rmSync(join(root, PENDING_FILE), { force: true })
  if (needsMigrations(root, loaded.model)) {
    try {
      migration = await migrateProject(root, loaded.model, schemaSources(root, files), options)
    } catch (error) {
      const message = (error as Error).message
      migration = { kind: 'error', message: /drizzle-kit/.test(message) ? message : `${message} (is drizzle-kit installed?)` }
    }
  }
  const { report } = syncProject(root, files)
  return withHealth(root, { ok: true, report, migration }, () => {
    let drift: HealthPatch['drift']
    try {
      drift = projectDrift(root, files)
    } catch (error) {
      drift = { error: `bildr could not compute drift: ${(error as Error).message}` }
    }
    return { model: { ok: true }, drift, migration: readPendingMigration(root) }
  })
}

/**
 * Refreshes the Health report after a regeneration (RA §7: drift and pending
 * migrations after every sync). Health never blocks: a failure here only adds
 * `healthError` to the result.
 */
const withHealth = (root: string, result: RegenerateResult, patch: () => HealthPatch): RegenerateResult => {
  try {
    updateHealth(root, patch())
    return result
  } catch (error) {
    return { ...result, healthError: (error as Error).message }
  }
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
