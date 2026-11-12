import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { applyRenames, effectiveRenames, isDestructive, renamesBetween, renameSql, schemaIds, withoutAdditions } from '@bildr/codegen/migrate'
import type { SchemaIds, Snapshot } from '@bildr/codegen/migrate'
import type { Model } from '@bildr/codegen/model'
import type { GeneratedFile } from '@bildr/codegen/sync'
import { readManifest, sha256, writeAtomically } from './sync.ts'

/**
 * Database migrations from model changes (T8, S9), with drizzle-kit from the
 * project itself. Renames come from model ids (`@bildr/codegen/migrate`), so
 * drizzle-kit only gets prompt-free diffs and its snapshots stay right for a
 * hand-run `db:generate`. A destructive plan waits in `PENDING_FILE` until
 * it is confirmed with its hash.
 */

export const MIGRATIONS_DIR = 'server/database/migrations'
export const IDS_FILE = `${MIGRATIONS_DIR}/meta/bildr.json`
export const PENDING_FILE = '.bildr/.cache/pending-migration.json'
const STAGING_DIR = '.bildr/.cache/schema'
const ORIGIN = '00000000-0000-0000-0000-000000000000'
const SCHEMA_PATH = /^layers\/[^/]+\/server\/infrastructure\/db\/schema\.ts$/

export type MigrationResult
  = | { kind: 'none' }
    | { kind: 'written', tag: string, statements: string[] }
    | { kind: 'pending', hash: string, destructive: string[], statements: string[] }

interface Journal {
  version: string
  dialect: string
  entries: Array<{ idx: number, version: string, when: number, tag: string, breakpoints: boolean }>
}

interface DrizzleKitApi {
  generateSQLiteDrizzleJson: (imports: Record<string, unknown>, prevId?: string) => Promise<Snapshot>
  generateSQLiteMigration: (prev: Snapshot, cur: Snapshot) => Promise<string[]>
}

/**
 * The schema each layer will run: the generated one, or the user's own when
 * they detached `schema.ts` (the app runs their file, so migrations follow it).
 */
export const schemaSources = (root: string, generated: GeneratedFile[]): Record<string, string> => {
  const manifest = readManifest(root)
  return Object.fromEntries(generated.filter(file => SCHEMA_PATH.test(file.path)).map((file) => {
    const target = join(root, file.path)
    const entry = manifest[file.path]
    const detached = existsSync(target) && entry !== undefined && (entry.owner === 'detached' || sha256(readFileSync(target)) !== entry.sha256)
    return [file.path, detached ? readFileSync(target, 'utf8') : file.content]
  }))
}

/**
 * drizzle-kit's snapshot of the schemas, computed in a child Node process: a
 * fresh module cache every time, Node's own type stripping (>= 22.18), and no
 * loader in between (nuxt dev runs this module through jiti, tests through vitest).
 */
const SNAPSHOT_SCRIPT = `
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const [root, prevId, ...files] = process.argv.slice(1)
const api = createRequire(root + '/package.json')('drizzle-kit/api')
const imports = {}
for (const file of files) Object.assign(imports, await import(pathToFileURL(file).href))
process.stdout.write(JSON.stringify(await api.generateSQLiteDrizzleJson(imports, prevId)))
`

const run = promisify(execFile)

/** Stages the schemas as content-addressed files under `.bildr/.cache/` (imports resolve from the project) and snapshots them. */
const snapshotOf = async (root: string, sources: Record<string, string>, prevId: string): Promise<Snapshot> => {
  mkdirSync(join(root, STAGING_DIR), { recursive: true })
  const files = Object.values(sources).map((content) => {
    const target = join(root, STAGING_DIR, `${sha256(content)}.ts`)
    if (!existsSync(target)) writeAtomically(target, content)
    return target
  })
  const { stdout } = await run(process.execPath, ['--input-type=module', '--no-warnings', '-e', SNAPSHOT_SCRIPT, root, prevId, ...files], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(stdout) as Snapshot
}

const readJson = <T>(root: string, path: string): T | undefined => {
  const target = join(root, path)
  return existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) as T : undefined
}

const snapshotPath = (idx: number) => `${MIGRATIONS_DIR}/meta/${String(idx).padStart(4, '0')}_snapshot.json`

/** Plans the next migration and writes it, holds it as pending when destructive, or does nothing. */
export const migrateProject = async (root: string, model: Model, sources: Record<string, string>, options: { confirm?: string, now?: number } = {}): Promise<MigrationResult> => {
  const api = createRequire(join(root, 'package.json'))('drizzle-kit/api') as DrizzleKitApi
  const journal = readJson<Journal>(root, `${MIGRATIONS_DIR}/meta/_journal.json`)
  const last = journal?.entries.at(-1)
  const previous: Snapshot = last
    ? readJson<Snapshot>(root, snapshotPath(last.idx)) ?? (() => { throw new Error(`Missing ${snapshotPath(last.idx)}: the migrations folder is incomplete`) })()
    : { ...await api.generateSQLiteDrizzleJson({}), id: ORIGIN, prevId: ORIGIN }
  const current = await snapshotOf(root, sources, previous.id as string)

  const ids = schemaIds(model)
  const renames = effectiveRenames(renamesBetween(readJson<SchemaIds>(root, IDS_FILE) ?? ids, ids), previous)
  const renamed = applyRenames(previous, renames)
  const middle = withoutAdditions(current, renamed)
  const statements = [
    ...renameSql(renames),
    ...await api.generateSQLiteMigration(renamed, middle),
    ...await api.generateSQLiteMigration(middle, current)
  ]

  if (!statements.length) {
    // Keep the ids map in step (e.g. a project migrated before bildr kept one), but never start a migrations folder for nothing.
    if (journal && JSON.stringify(readJson<SchemaIds>(root, IDS_FILE)) !== JSON.stringify(ids)) writeAtomically(join(root, IDS_FILE), `${JSON.stringify(ids, null, 2)}\n`)
    rmSync(join(root, PENDING_FILE), { force: true })
    return { kind: 'none' }
  }

  const hash = sha256(JSON.stringify(statements))
  const destructive = statements.filter(isDestructive)
  if (destructive.length && options.confirm !== hash) {
    mkdirSync(join(root, '.bildr/.cache'), { recursive: true })
    writeAtomically(join(root, PENDING_FILE), `${JSON.stringify({ hash, destructive, statements }, null, 2)}\n`)
    return { kind: 'pending', hash, destructive, statements }
  }

  // Order: SQL and snapshot, then the journal (what the migrator reads), then the ids map.
  const idx = journal?.entries.length ?? 0
  const tag = `${String(idx).padStart(4, '0')}_bildr`
  mkdirSync(join(root, MIGRATIONS_DIR, 'meta'), { recursive: true })
  writeAtomically(join(root, MIGRATIONS_DIR, `${tag}.sql`), statements.join('\n--> statement-breakpoint\n'))
  writeAtomically(join(root, snapshotPath(idx)), `${JSON.stringify(current, null, 2)}\n`)
  const next: Journal = journal ?? { version: '7', dialect: 'sqlite', entries: [] }
  next.entries.push({ idx, version: '6', when: options.now ?? Date.now(), tag, breakpoints: true })
  writeAtomically(join(root, MIGRATIONS_DIR, 'meta/_journal.json'), `${JSON.stringify(next, null, 2)}\n`)
  writeAtomically(join(root, IDS_FILE), `${JSON.stringify(ids, null, 2)}\n`)
  rmSync(join(root, PENDING_FILE), { force: true })
  return { kind: 'written', tag, statements }
}
