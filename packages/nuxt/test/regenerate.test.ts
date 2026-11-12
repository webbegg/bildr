import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
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

/** A stored entity (needs drizzle-kit: linked from the golden fixture's install). */
const addNote = () => {
  symlinkSync(fileURLToPath(new URL('../../../fixtures/codegen/blog/node_modules', import.meta.url)), join(dir, 'node_modules'), 'dir')
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
    expect(read(pageFile)).toContain('<h1 class="text-3xl font-semibold">Hello from the model</h1>')
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

  it('keeps a hand-edited page and reports it detached', async () => {
    writeFileSync(join(dir, pageFile), '<template>mine</template>\n')
    editPage((page) => {
      page.root.children[0]!.props = { level: 1, text: 'v2' }
    })
    const result = await regenerate(dir)
    expect(result.ok && result.report.detached).toEqual([pageFile])
    expect(read(pageFile)).toBe('<template>mine</template>\n')
  })

  it('writes the migration for a new entity together with its generated schema', async () => {
    addNote()
    const result = await regenerate(dir)
    expect(result).toMatchObject({ ok: true, migration: { kind: 'written', tag: '0000_bildr' } })
    expect(read('server/database/migrations/0000_bildr.sql')).toContain('CREATE TABLE `main_notes`')
    expect(read('layers/main/server/infrastructure/db/schema.ts')).toContain('sqliteTable(\'main_notes\'')
  })

  it('applies the migration it wrote to the app database, without waiting for a server reload', async () => {
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

  it('says so when a migration fails to apply, and takes it out of the journal', async () => {
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

describe('createRegenerator', { timeout: 60_000 }, () => {
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
