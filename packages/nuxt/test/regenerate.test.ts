import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { readHealth } from '../src/node/health'
import { PENDING_FILE } from '../src/node/migrations'
import { createRegenerator, isModelChange, regenerate } from '../src/node/regenerate'

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-regenerate-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const pageModel = '.bildr/modules/main/pages/index.json'
const pageFile = 'layers/main/app/pages/index.vue'
const read = (path: string) => readFileSync(join(dir, path), 'utf8')

/** Edits the index page model as the editor or a hand edit would. */
const editPage = (edit: (page: { root: { children: Array<Record<string, unknown>> } }) => void) => {
  const page = JSON.parse(read(pageModel))
  edit(page)
  writeFileSync(join(dir, pageModel), JSON.stringify(page, null, 2))
}

// The fixture is not part of the workspace: `pnpm --dir fixtures/codegen/blog install` once (review RELIABILITY-001).
const fixtureModules = fileURLToPath(new URL('../../../fixtures/codegen/blog/node_modules', import.meta.url))
// In CI the install is required: a missing one fails these tests instead of skipping them.
const hasFixtureInstall = existsSync(join(fixtureModules, 'drizzle-kit')) || !!process.env.CI
const withDrizzle = hasFixtureInstall ? it : it.skip

/** A stored entity (needs drizzle-kit: linked from the golden fixture's install). */
const addNote = () => {
  symlinkSync(fixtureModules, join(dir, 'node_modules'), 'dir')
  const write = (path: string, value: unknown) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), JSON.stringify(value, null, 2))
  }
  write('.bildr/modules/main/entities/note.json', { id: 'ent_note', name: 'Note', plural: 'notes', idStrategy: 'uuid', timestamps: false, fields: [{ id: 'fld_title', name: 'title', type: 'text', required: true }], relations: [], client: { sync: 'eager', limit: 500 } })
  write('.bildr/modules/main/repositories/note.json', { id: 'repo_note', entity: 'ent_note', datasource: 'ds_main', operations: ['list', 'get', 'create'], finders: [], list: { orderBy: [] }, expose: { list: true } })
}

// T7d/T8: a .bildr/ change migrates the database, then regenerates the app through the sync engine.
describe('regenerate', { timeout: 60_000 }, () => {
  it('is a no-op on a freshly created project, without needing drizzle-kit', async () => {
    const result = await regenerate(dir)
    expect(result).toMatchObject({ ok: true, migration: { kind: 'none' } })
    expect(result.ok && result.report.written).toEqual([])
  })

  it('rewrites the generated page after a model edit and records it in the manifest', async () => {
    editPage((page) => {
      page.root.children[0]!.props = { level: 1, text: 'Hello from the model' }
    })
    const manifest = read('.bildr/manifest.json')
    const result = await regenerate(dir)
    expect(result.ok && result.report.written).toEqual([pageFile])
    expect(read(pageFile)).toContain('<h1 class="text-3xl font-semibold tracking-tight">Hello from the model</h1>')
    expect(read('.bildr/manifest.json')).not.toBe(manifest)
  })

  it('never syncs an invalid model: reports the problems and writes nothing', async () => {
    editPage((page) => {
      page.root.children[0]!.id = ''
    })
    const before = { page: read(pageFile), manifest: read('.bildr/manifest.json') }
    const result = await regenerate(dir)
    expect(result.ok).toBe(false)
    expect(!result.ok && 'problems' in result && result.problems[0]!.path).toBe(pageModel)
    expect({ page: read(pageFile), manifest: read('.bildr/manifest.json') }).toEqual(before)
  })

  it('writes nothing when the generator refuses the model', async () => {
    editPage((page) => {
      page.root.children.push({ id: 'n_video', type: 'Video' })
    })
    const before = { page: read(pageFile), manifest: read('.bildr/manifest.json') }
    const result = await regenerate(dir)
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/node type Video can't be generated yet/) })
    expect({ page: read(pageFile), manifest: read('.bildr/manifest.json') }).toEqual(before)
  })

  // T6: an older generator's project keeps its code until its owner upgrades it (project_update { upgradeGenerator: true }).
  it('holds a project made by an older generator: writes nothing, says why in Health, and regenerates once upgraded', async () => {
    const project = JSON.parse(read('.bildr/bildr.json'))
    writeFileSync(join(dir, '.bildr/bildr.json'), JSON.stringify({ ...project, generatorVersion: '0.1.0' }, null, 2))
    editPage((page) => {
      page.root.children[0]!.props = { level: 1, text: 'v2' }
    })
    const before = { page: read(pageFile), manifest: read('.bildr/manifest.json') }
    const result = await regenerate(dir)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('generated by bildr\'s generator 0.1.0') })
    expect({ page: read(pageFile), manifest: read('.bildr/manifest.json') }).toEqual(before)
    expect(readHealth(dir)).toMatchObject({ model: { ok: true }, drift: { error: expect.stringContaining('upgradeGenerator') } })
    writeFileSync(join(dir, '.bildr/bildr.json'), JSON.stringify(project, null, 2))
    expect((await regenerate(dir)).ok).toBe(true)
    expect(read(pageFile)).toContain('v2')
  })

  it('keeps a hand-edited page and reports it detached', async () => {
    writeFileSync(join(dir, pageFile), '<template>mine</template>\n')
    editPage((page) => {
      page.root.children[0]!.props = { level: 1, text: 'v2' }
    })
    const result = await regenerate(dir)
    expect(result.ok && result.report.detached).toEqual([pageFile])
    expect(read(pageFile)).toBe('<template>mine</template>\n')
  })

  withDrizzle('writes the migration for a new entity together with its generated schema', async () => {
    addNote()
    const result = await regenerate(dir)
    expect(result).toMatchObject({ ok: true, migration: { kind: 'written', tag: '0000_bildr' } })
    expect(read('server/database/migrations/0000_bildr.sql')).toContain('CREATE TABLE `main_notes`')
    expect(read('layers/main/server/infrastructure/db/schema.ts')).toContain('sqliteTable(\'main_notes\'')
  })

  withDrizzle('applies the migration it wrote to the app database, without waiting for a server reload', async () => {
    addNote()
    const url = `file:${join(dir, '.data/app.db')}`
    expect(await regenerate(dir, { databaseUrl: url })).toMatchObject({ ok: true, migration: { kind: 'written', tag: '0000_bildr', applied: true } })
    const { createClient } = (await import('node:module')).createRequire(join(dir, 'package.json'))('@libsql/client') as typeof import('@libsql/client')
    const client = createClient({ url })
    try {
      expect((await client.execute('select name from pragma_table_info(\'main_notes\') order by cid')).rows).toEqual([{ name: 'id' }, { name: 'title' }])
    } finally {
      client.close()
    }
  })

  withDrizzle('says so when a migration fails to apply, and takes it out of the journal', async () => {
    addNote()
    mkdirSync(join(dir, 'blocked'))
    const result = await regenerate(dir, { databaseUrl: `file:${join(dir, 'blocked')}` })
    expect(result).toMatchObject({ ok: true, migration: { kind: 'failed', tag: '0000_bildr', error: expect.any(String) } })
    expect(existsSync(join(dir, 'server/database/migrations/meta/_journal.json'))).toBe(false)
  })

  it('still regenerates the app when the migration can\'t be planned, and says why', async () => {
    addNote()
    rmSync(join(dir, 'node_modules'))
    const result = await regenerate(dir)
    expect(result).toMatchObject({ ok: true, migration: { kind: 'error', message: expect.stringMatching(/drizzle-kit/) } })
    expect(existsSync(join(dir, 'layers/main/server/infrastructure/db/schema.ts'))).toBe(true)
  })
})

// V7 (E2): without a sqlite data source there is no database: the migration pipeline is a no-op.
describe('regenerate without a database', { timeout: 60_000 }, () => {
  const DB_FILES = ['drizzle.config.ts', 'layers/core/server/plugins/migrate.ts', 'layers/core/server/utils/db.ts']

  it('an API-only project regenerates without drizzle-kit, ignoring a stale migrations folder and pending plan', async () => {
    const api = join(root, 'api')
    createProject(api, { name: 'Api', database: 'none' })
    mkdirSync(join(api, 'server/database/migrations/meta'), { recursive: true })
    writeFileSync(join(api, 'server/database/migrations/meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }))
    mkdirSync(join(api, '.bildr/.cache'), { recursive: true })
    writeFileSync(join(api, PENDING_FILE), JSON.stringify({ hash: 'h1', destructive: ['DROP TABLE `t`;'], losing: ['table t'], statements: [] }))
    const result = await regenerate(api)
    expect(result).toMatchObject({ ok: true, migration: { kind: 'none' } })
    expect(existsSync(join(api, PENDING_FILE))).toBe(false)
    expect(readHealth(api).migration).toBeNull()
    for (const path of DB_FILES) expect(existsSync(join(api, path)), path).toBe(false)
  })

  it('removing the last sqlite data source removes the database layer the sync manages', async () => {
    rmSync(join(dir, '.bildr/datasources/main.json'))
    const result = await regenerate(dir)
    expect(result.ok && result.report.removed.sort()).toEqual(DB_FILES)
    for (const path of DB_FILES) expect(existsSync(join(dir, path)), path).toBe(false)
    expect(read('layers/core/nuxt.config.ts')).not.toContain('db: {')
  })
})

// T9c (S6, RA §7): every regeneration refreshes the Health report; Health never blocks it.
describe('regenerate refreshes health', { timeout: 60_000 }, () => {
  it('lists a hand-edited generated file as detached with its diff, and no pending migration', async () => {
    writeFileSync(join(dir, pageFile), `${read(pageFile)}<!-- mine -->\n`)
    const result = await regenerate(dir)
    expect(result.ok && result.report.detached).toEqual([pageFile])
    const health = readHealth(dir)
    expect(health.model).toEqual({ ok: true })
    expect(health.migration).toBeNull()
    expect(health.drift).toEqual({ missingManifest: false, files: [{ path: pageFile, state: 'detached', diff: expect.stringContaining('+<!-- mine -->') }] })
  })

  it('records the pending destructive migration plan', async () => {
    const plan = { hash: 'h1', destructive: ['DROP TABLE `t`;'], losing: ['table t'], statements: [] }
    mkdirSync(join(dir, '.bildr/.cache'), { recursive: true })
    writeFileSync(join(dir, PENDING_FILE), JSON.stringify(plan))
    await regenerate(dir)
    expect(readHealth(dir).migration).toEqual(plan)
  })

  it('records the problems of an invalid model and keeps the last drift', async () => {
    writeFileSync(join(dir, pageFile), '<template>mine</template>\n')
    await regenerate(dir)
    const drift = readHealth(dir).drift
    editPage((page) => {
      page.root.children[0]!.id = ''
    })
    const result = await regenerate(dir)
    const health = readHealth(dir)
    expect(health.model).toEqual({ ok: false, problems: !result.ok && 'problems' in result ? result.problems : 'expected problems' })
    expect(health.drift).toEqual(drift)
  })

  it('records that drift is unknown when the generator refuses the model', async () => {
    editPage((page) => {
      page.root.children.push({ id: 'n_video', type: 'Video' })
    })
    await regenerate(dir)
    const health = readHealth(dir)
    expect(health.model).toEqual({ ok: true })
    expect(health.drift).toEqual({ error: expect.stringMatching(/Video/) })
  })

  it('still syncs when the report can\'t be written, and says why', async () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(dir, '.bildr/.cache'), 'dir')
    editPage((page) => {
      page.root.children[0]!.props = { level: 1, text: 'Still synced' }
    })
    const result = await regenerate(dir)
    expect(result).toMatchObject({ ok: true, report: { written: [pageFile] }, healthError: expect.stringMatching(/outside the project/) })
    expect(existsSync(join(outside, 'health.json'))).toBe(false)
  })
})

describe.skipIf(!hasFixtureInstall)('createRegenerator (needs `pnpm --dir fixtures/codegen/blog install`)', { timeout: 60_000 }, () => {
  it('runs one regeneration at a time, so two overlapping runs never write the same migration twice', async () => {
    addNote()
    const regenerator = createRegenerator(dir)
    const [first, second] = await Promise.all([regenerator.run(), regenerator.run()])
    expect(first).toMatchObject({ ok: true, migration: { kind: 'written' } })
    expect(second).toMatchObject({ ok: true, migration: { kind: 'none' } })
    expect(JSON.parse(read('server/database/migrations/meta/_journal.json')).entries).toHaveLength(1)
  })
})

describe('isModelChange (the watcher filter)', () => {
  it('reacts to model files only: never to the manifest a sync writes, temp files or the cache', () => {
    expect(isModelChange('modules/main/pages/index.json')).toBe(true)
    expect(isModelChange('theme.json')).toBe(true)
    expect(isModelChange('manifest.json')).toBe(false)
    expect(isModelChange('manifest.json.tmp')).toBe(false)
    expect(isModelChange('modules/main/pages/index.json.tmp')).toBe(false)
    expect(isModelChange('.cache/health.json')).toBe(false)
    expect(isModelChange('.cache')).toBe(false)
    expect(isModelChange(undefined)).toBe(false)
  })
})
