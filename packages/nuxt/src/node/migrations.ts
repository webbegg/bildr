import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { applyRenames, describeLosses, dropIndexesFirst, isDestructive, planRenames, schemaIds, unappliable, withAdditionsOnly, withoutAdditions } from '@bildr/codegen/migrate'
import type { SchemaIds, Snapshot } from '@bildr/codegen/migrate'
import type { Model } from '@bildr/codegen/model'
import type { GeneratedFile } from '@bildr/codegen/sync'
import { resolvesInside } from './project.ts'
import { readManifest, sha256, writeAtomically } from './sync.ts'

/**
 * Database migrations from model changes (T8, S9), with drizzle-kit from the
 * project itself. Renames come from model ids (`@bildr/codegen/migrate`), so
 * drizzle-kit only gets prompt-free diffs and its snapshots stay right for a
 * hand-run `db:generate`. Each migration's ids map sits next to its snapshot
 * (`meta/_bildr_ids_NNNN.json`: drizzle-kit skips `_` files, and its snapshot
 * schema is strict), written before the journal, so the two never disagree. A destructive plan waits in
 * `PENDING_FILE` until it is confirmed with its hash; with a database URL a
 * written migration is applied at once, and reverted if that fails, so the
 * journal never holds a migration the database refused.
 */

export const MIGRATIONS_DIR = 'server/database/migrations'
export const PENDING_FILE = '.bildr/.cache/pending-migration.json'
const STAGING_DIR = '.bildr/.cache/schema'
const ORIGIN = '00000000-0000-0000-0000-000000000000'
const SCHEMA_PATH = /^layers\/[^/]+\/server\/infrastructure\/db\/schema\.ts$/
const JOURNAL = `${MIGRATIONS_DIR}/meta/_journal.json`

export type MigrationResult
  = | { kind: 'none' }
    | { kind: 'written', tag: string, statements: string[], /** Set when a database URL was given: the migration ran. */ applied?: true }
    | {
      kind: 'pending'
      hash: string
      destructive: string[]
      /** What confirming loses, in the user's words. */
      losing: string[]
      statements: string[]
      /** The part that loses nothing (renames, additions), written (and applied) at once so the app's code can use it. */
      written?: { tag: string, statements: string[], applied?: true }
    }
    /** Nothing written (or written and reverted, then `tag` is set): the model change needs another step, or the database refused it. */
    | { kind: 'failed', error: string, statements: string[], tag?: string }

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
 * loader in between (nuxt dev runs this module through jiti, tests through
 * vitest). Exports are kept apart per file: two modules may both export `notes`.
 */
const SNAPSHOT_SCRIPT = `
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const [root, prevId, ...files] = process.argv.slice(1)
const api = createRequire(root + '/package.json')('drizzle-kit/api')
const imports = {}
for (const [index, file] of files.entries()) {
  for (const [name, value] of Object.entries(await import(pathToFileURL(file).href))) imports[index + ':' + name] = value
}
// Framed on its own line: a schema may print while it loads.
process.stdout.write('\\nBILDR_SNAPSHOT ' + JSON.stringify(await api.generateSQLiteDrizzleJson(imports, prevId)) + '\\n')
`

/** Applies pending migrations with drizzle's own migrator, as the app's boot plugin does. */
const APPLY_SCRIPT = `
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
const [root, migrationsFolder] = process.argv.slice(1)
// From the environment, not argv: other local users can read a process's arguments.
const url = process.env.BILDR_DATABASE_URL
const require = createRequire(root + '/package.json')
const { createClient } = require('@libsql/client')
const { drizzle } = require('drizzle-orm/libsql')
const { migrate } = require('drizzle-orm/libsql/migrator')
if (url.startsWith('file:')) mkdirSync(dirname(resolve(root, url.slice('file:'.length))), { recursive: true })
const client = createClient({ url })
try {
  await migrate(drizzle(client), { migrationsFolder })
} catch (error) {
  process.stderr.write('BILDR_ERROR ' + String(error?.cause?.message ?? error?.message ?? error).split('\\n')[0] + '\\n')
  process.exitCode = 1
} finally {
  client.close()
}
`

const run = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 120_000

/** Runs a script in a child Node process; a run past `timeoutMs` is killed, so it can't stall the regeneration queue. */
const node = async (script: string, root: string, args: string[], options: { timeoutMs: number, what: string, env?: Record<string, string> }) => {
  try {
    return await run(process.execPath, ['--input-type=module', '--no-warnings', '-e', script, root, ...args], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      timeout: options.timeoutMs,
      killSignal: 'SIGKILL',
      env: { ...process.env, ...options.env }
    })
  } catch (error) {
    if ((error as { killed?: boolean }).killed) {
      throw new Error(`${options.what} did not finish within ${options.timeoutMs / 1000}s (does the schema keep something open while it loads?)`, { cause: error })
    }
    throw error
  }
}

/** Stages the schemas as content-addressed files under `.bildr/.cache/` (imports resolve from the project) and snapshots them. */
const snapshotOf = async (root: string, sources: Record<string, string>, prevId: string, timeoutMs: number): Promise<Snapshot> => {
  mkdirSync(join(root, STAGING_DIR), { recursive: true })
  const files = Object.values(sources).map((content) => {
    const target = join(root, STAGING_DIR, `${sha256(content)}.ts`)
    if (!existsSync(target)) writeAtomically(target, content)
    return target
  })
  const { stdout } = await node(SNAPSHOT_SCRIPT, root, [prevId, ...files], { timeoutMs, what: 'The schema snapshot' })
  const framed = stdout.split('\n').reverse().find(line => line.startsWith('BILDR_SNAPSHOT '))
  if (!framed) throw new Error('The schema snapshot printed no result')
  return JSON.parse(framed.slice('BILDR_SNAPSHOT '.length)) as Snapshot
}

/** Runs the project's pending migrations against `databaseUrl`; throws with the database's message. */
export const applyMigrations = async (root: string, databaseUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  try {
    await node(APPLY_SCRIPT, root, [join(root, MIGRATIONS_DIR)], { timeoutMs, what: 'Applying the migrations', env: { BILDR_DATABASE_URL: databaseUrl } })
  } catch (error) {
    if (/did not finish within/.test((error as Error).message)) throw error
    const stderr = (error as { stderr?: string }).stderr ?? ''
    throw new Error(/BILDR_ERROR (.*)/.exec(stderr)?.[1] ?? (stderr.trim().slice(0, 500) || (error as Error).message), { cause: error })
  }
}

const readText = (root: string, path: string) => existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined
const readJson = <T>(root: string, path: string): T | undefined => {
  const text = readText(root, path)
  return text === undefined ? undefined : JSON.parse(text) as T
}

const snapshotPath = (idx: number) => `${MIGRATIONS_DIR}/meta/${String(idx).padStart(4, '0')}_snapshot.json`
const idsPath = (idx: number) => `${MIGRATIONS_DIR}/meta/_bildr_ids_${String(idx).padStart(4, '0')}.json`

export interface MigrateOptions {
  /** The hash of the pending destructive plan the user confirmed. */
  confirm?: string
  /** The app database: apply the migration as soon as it is written. */
  databaseUrl?: string
  now?: number
  /** Limit for each child process (snapshot, apply). Default 120 s. */
  timeoutMs?: number
}

/** Plans the next migration and writes it (and applies it), holds it as pending when destructive, or refuses it. */
export const migrateProject = async (root: string, model: Model, sources: Record<string, string>, options: MigrateOptions = {}): Promise<MigrationResult> => {
  // Same boundary as the file sync: a committed symlink can't send migration or cache writes elsewhere.
  for (const folder of [MIGRATIONS_DIR, '.bildr/.cache']) {
    if (!resolvesInside(root, join(root, folder))) throw new Error(`${folder} resolves outside the project (symlink): bildr won't write migrations there`)
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const api = createRequire(join(root, 'package.json'))('drizzle-kit/api') as DrizzleKitApi
  const journalText = readText(root, JOURNAL)
  const journal = journalText === undefined ? undefined : JSON.parse(journalText) as Journal
  const last = journal?.entries.at(-1)
  const previous: Snapshot = last
    ? readJson<Snapshot>(root, snapshotPath(last.idx)) ?? (() => { throw new Error(`Missing ${snapshotPath(last.idx)}: the migrations folder is incomplete`) })()
    : { ...await api.generateSQLiteDrizzleJson({}), id: ORIGIN, prevId: ORIGIN }
  const ids = schemaIds(model)
  const current = await snapshotOf(root, sources, previous.id as string, timeoutMs)

  // No ids map for the previous migration (written by hand or before bildr kept one): no renames to resolve.
  const renames = planRenames((last && readJson<SchemaIds>(root, idsPath(last.idx))) ?? ids, ids, previous)
  if (renames.conflicts.length) return { kind: 'failed', error: renames.conflicts.join('; '), statements: renames.sql }
  // Moved-aside names from an earlier migration that are still waiting to be dropped keep their description.
  const replaced = { ...(last && readJson<SchemaIds>(root, idsPath(last.idx)))?.replaced, ...renames.replaced }
  const renamed = applyRenames(previous, renames.renames)
  // Two prompt-free drizzle-kit diffs: removals and changes, then additions.
  const diff = async (from: Snapshot, to: Snapshot) => {
    const middle = withoutAdditions(to, from)
    return [...await api.generateSQLiteMigration(from, middle), ...await api.generateSQLiteMigration(middle, to)]
  }
  const statements = dropIndexesFirst([...renames.sql, ...await diff(renamed, current)])
  rmSync(join(root, PENDING_FILE), { force: true })
  if (!statements.length) return { kind: 'none' }
  const refused = unappliable(statements)
  if (refused.length) return { kind: 'failed', error: refused.join('; '), statements }

  let base = previous
  let rest = statements
  let written: { tag: string, statements: string[], applied?: true } | undefined
  if (rest.some(isDestructive) && !confirms(options.confirm, previous, rest)) {
    // What loses nothing runs now, so the synced app code can use it; only the rest waits for confirmation.
    const safe = withAdditionsOnly(renamed, current)
    const safeStatements = dropIndexesFirst([...renames.sql, ...await api.generateSQLiteMigration(renamed, safe)])
    if (safeStatements.length) {
      const result = await writeMigration(root, journalText, safe, safeStatements, { ...ids, ...stillIn(safe, replaced) }, options, timeoutMs)
      if (result.kind === 'failed') return result
      written = { tag: result.tag, statements: safeStatements, ...(result.applied ? { applied: true as const } : {}) }
      base = safe
      rest = dropIndexesFirst(await diff(safe, current))
    }
  }

  // Bound to the position: a hash shown for one plan never confirms a later one.
  const hash = planHash(base, rest)
  const destructive = rest.filter(isDestructive)
  if (destructive.length && options.confirm !== hash) {
    const losing = describeLosses(destructive, replaced)
    mkdirSync(join(root, '.bildr/.cache'), { recursive: true })
    writeAtomically(join(root, PENDING_FILE), `${JSON.stringify({ hash, destructive, losing, statements: rest }, null, 2)}\n`)
    return { kind: 'pending', hash, destructive, losing, statements: rest, ...(written ? { written } : {}) }
  }
  return writeMigration(root, readText(root, JOURNAL), current, rest, { ...ids, ...stillIn(current, replaced) }, options, timeoutMs)
}

const planHash = (previous: Snapshot, statements: string[]) => sha256(JSON.stringify([previous.id, statements]))
const confirms = (confirm: string | undefined, previous: Snapshot, statements: string[]) => confirm !== undefined && confirm === planHash(previous, statements)

/** The moved-aside names `snapshot` still has (the ids map keeps their description until they are dropped). */
const stillIn = (snapshot: Snapshot, replaced: Record<string, string>): Pick<SchemaIds, 'replaced'> => {
  const names = new Set(Object.values(snapshot.tables).flatMap(table => [table.name, ...Object.keys(table.columns)]))
  const kept = Object.fromEntries(Object.entries(replaced).filter(([name]) => names.has(name)))
  return Object.keys(kept).length ? { replaced: kept } : {}
}

/** Writes the next migration (and applies it when a database URL is given); a refused one is taken out again. */
const writeMigration = async (root: string, journalText: string | undefined, snapshot: Snapshot, statements: string[], ids: SchemaIds, options: MigrateOptions, timeoutMs: number): Promise<Extract<MigrationResult, { kind: 'written' | 'failed' }>> => {
  const journal = journalText === undefined ? undefined : JSON.parse(journalText) as Journal
  // Order: SQL, snapshot and its ids map, then the journal: what the migrator reads.
  const idx = journal?.entries.length ?? 0
  const tag = `${String(idx).padStart(4, '0')}_bildr`
  const files = [`${MIGRATIONS_DIR}/${tag}.sql`, snapshotPath(idx), idsPath(idx)]
  mkdirSync(join(root, MIGRATIONS_DIR, 'meta'), { recursive: true })
  writeAtomically(join(root, files[0]!), statements.join('\n--> statement-breakpoint\n'))
  writeAtomically(join(root, files[1]!), `${JSON.stringify(snapshot, null, 2)}\n`)
  writeAtomically(join(root, files[2]!), `${JSON.stringify(ids, null, 2)}\n`)
  const next: Journal = journal ? { ...journal, entries: [...journal.entries] } : { version: '7', dialect: 'sqlite', entries: [] }
  next.entries.push({ idx, version: '6', when: options.now ?? Date.now(), tag, breakpoints: true })
  writeAtomically(join(root, JOURNAL), `${JSON.stringify(next, null, 2)}\n`)
  if (!options.databaseUrl) return { kind: 'written', tag, statements }

  try {
    await applyMigrations(root, options.databaseUrl, timeoutMs)
    return { kind: 'written', tag, statements, applied: true }
  } catch (error) {
    // The database refused it (its transaction rolled back): take it out again, so the journal matches the database.
    if (journalText === undefined) rmSync(join(root, JOURNAL), { force: true })
    else writeAtomically(join(root, JOURNAL), journalText)
    for (const path of files) rmSync(join(root, path), { force: true })
    return { kind: 'failed', tag, statements, error: (error as Error).message }
  }
}
