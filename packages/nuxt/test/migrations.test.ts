import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generate } from '@bildr/codegen/generate'
import { loadModel } from '@bildr/codegen/model'
import { createProject } from '../../create-bildr/src/create'
import { migrateProject, PENDING_FILE, schemaSources } from '../src/node/migrations'
import { readModelFiles } from '../src/node/project'

// drizzle-kit, drizzle-orm and @libsql/client come from the golden fixture's install, as a project would have them.
const fixtureModules = fileURLToPath(new URL('../../../fixtures/codegen/blog/node_modules', import.meta.url))

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-migrations-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  symlinkSync(fixtureModules, join(dir, 'node_modules'), 'dir')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

type Field = { id: string, name: string, type: string, required?: boolean, default?: unknown, unique?: boolean }
const write = (path: string, value: unknown) => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), JSON.stringify(value, null, 2))
}
const writeNote = (fields: Field[], module = 'main', id = 'note') => {
  write(`.bildr/modules/${module}/entities/note.json`, { id: `ent_${id}`, name: 'Note', plural: 'notes', idStrategy: 'uuid', timestamps: false, fields, relations: [], client: { sync: 'eager', limit: 500 } })
  write(`.bildr/modules/${module}/repositories/note.json`, { id: `repo_${id}`, entity: `ent_${id}`, datasource: 'ds_main', operations: ['list', 'get', 'create'], finders: [], list: { orderBy: [] }, expose: { list: true } })
}
const addModule = (name: string) => {
  write(`.bildr/modules/${name}/module.json`, { id: `mod_${name}`, name, label: name, dependsOn: [] })
  const project = JSON.parse(readFileSync(join(dir, '.bildr/bildr.json'), 'utf8'))
  write('.bildr/bildr.json', { ...project, modules: [...project.modules, name] })
}

const databaseUrl = () => `file:${join(dir, 'app.db')}`
const migrate = async (options: { confirm?: string, databaseUrl?: string } = {}) => {
  const loaded = loadModel(readModelFiles(dir))
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return migrateProject(dir, loaded.model, schemaSources(dir, generate(loaded.model)), options)
}

const migrationsDir = () => join(dir, 'server/database/migrations')
const journal = () => JSON.parse(readFileSync(join(migrationsDir(), 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> }
const sqlOf = (tag: string) => readFileSync(join(migrationsDir(), `${tag}.sql`), 'utf8')

/** Applies the migrations with drizzle's own migrator, as the app's boot plugin does. */
const applyAndQuery = async (sql: string) => {
  const require = createRequire(join(dir, 'package.json'))
  const { createClient } = require('@libsql/client') as typeof import('@libsql/client')
  const { drizzle } = require('drizzle-orm/libsql') as typeof import('drizzle-orm/libsql')
  const { migrate: run } = require('drizzle-orm/libsql/migrator') as typeof import('drizzle-orm/libsql/migrator')
  const client = createClient({ url: `file:${join(dir, 'app.db')}` })
  try {
    await run(drizzle(client), { migrationsFolder: migrationsDir() })
    return (await client.execute(sql)).rows
  } finally {
    client.close()
  }
}

const title: Field = { id: 'fld_title', name: 'title', type: 'text', required: true }

// Each plan snapshots the schema in a child Node process that loads drizzle-kit: allow for a busy machine.
describe('migrateProject', { timeout: 60_000 }, () => {
  it('writes nothing for a project without stored entities', async () => {
    expect(await migrate()).toEqual({ kind: 'none' })
    expect(existsSync(join(migrationsDir(), 'meta/_journal.json'))).toBe(false)
  })

  it('creates the first migration for a new entity, then has nothing more to do', async () => {
    writeNote([title])
    const first = await migrate()
    expect(first).toMatchObject({ kind: 'written', tag: '0000_bildr' })
    expect(sqlOf('0000_bildr')).toContain('CREATE TABLE `main_notes`')
    expect(journal().entries.map(entry => entry.tag)).toEqual(['0000_bildr'])
    expect(readdirSync(join(migrationsDir(), 'meta')).sort()).toEqual(['0000_snapshot.json', '_bildr_ids_0000.json', '_journal.json'])
    // Each migration's ids map sits next to its snapshot; drizzle-kit skips `_` files in meta/ and reads the snapshot as its own.
    expect(JSON.parse(readFileSync(join(migrationsDir(), 'meta/_bildr_ids_0000.json'), 'utf8')).tables.ent_note.columns).toEqual({ fld_id: 'id', fld_title: 'title' })
    const api = createRequire(join(dir, 'package.json'))('drizzle-kit/api') as { generateSQLiteMigration: (a: unknown, b: unknown) => Promise<string[]> }
    const snapshot = JSON.parse(readFileSync(join(migrationsDir(), 'meta/0000_snapshot.json'), 'utf8'))
    expect(await api.generateSQLiteMigration(snapshot, snapshot)).toEqual([])
    expect(await migrate()).toEqual({ kind: 'none' })
    expect(await applyAndQuery('select name from pragma_table_info(\'main_notes\') order by cid')).toEqual([{ name: 'id' }, { name: 'title' }])
  })

  it('adds a column, renames one by id without losing data, and holds a dropped one for confirmation', async () => {
    writeNote([title])
    await migrate()
    await applyAndQuery('insert into main_notes (id, title) values (\'n1\', \'Hello\')')

    writeNote([title, { id: 'fld_body', name: 'body', type: 'text' }])
    expect(await migrate()).toMatchObject({ kind: 'written', tag: '0001_bildr', statements: ['ALTER TABLE `main_notes` ADD `body` text;'] })

    writeNote([{ ...title, name: 'heading' }, { id: 'fld_body', name: 'body', type: 'text' }])
    expect(await migrate()).toMatchObject({ kind: 'written', tag: '0002_bildr', statements: ['ALTER TABLE `main_notes` RENAME COLUMN `title` TO `heading`;'] })
    expect(await applyAndQuery('select heading, body from main_notes')).toEqual([{ heading: 'Hello', body: null }])

    writeNote([{ ...title, name: 'heading' }])
    const pending = await migrate()
    expect(pending).toMatchObject({ kind: 'pending', destructive: ['ALTER TABLE `main_notes` DROP COLUMN `body`;'] })
    expect(journal().entries).toHaveLength(3)
    expect(existsSync(join(dir, PENDING_FILE))).toBe(true)

    expect(await migrate({ confirm: 'not-the-hash' })).toMatchObject({ kind: 'pending' })
    const confirmed = await migrate({ confirm: pending.kind === 'pending' ? pending.hash : '' })
    expect(confirmed).toMatchObject({ kind: 'written', tag: '0003_bildr' })
    expect(existsSync(join(dir, PENDING_FILE))).toBe(false)
    expect(await applyAndQuery('select * from main_notes')).toEqual([{ id: 'n1', heading: 'Hello' }])
  })

  it('never writes a required field added without a default: SQLite refuses it on any table (verification B1)', async () => {
    writeNote([title])
    await migrate({ databaseUrl: databaseUrl() })
    writeNote([title, { id: 'fld_n', name: 'n', type: 'text', required: true }])
    expect(await migrate({ databaseUrl: databaseUrl() })).toMatchObject({ kind: 'failed', error: 'main_notes.n is required: give the field a default value, so existing rows get one' })
    expect(journal().entries).toHaveLength(1)
  })

  it('reverts a migration that fails to apply, so the next ones still run (verification B1)', async () => {
    writeNote([{ id: 'fld_code', name: 'code', type: 'text' }])
    await migrate({ databaseUrl: databaseUrl() })
    await applyAndQuery('insert into main_notes (id, code) values (\'n1\', \'same\'), (\'n2\', \'same\')')
    writeNote([{ id: 'fld_code', name: 'code', type: 'text', unique: true }])
    expect(await migrate({ databaseUrl: databaseUrl() })).toMatchObject({ kind: 'failed', tag: '0001_bildr', error: expect.stringMatching(/UNIQUE/) })
    expect(journal().entries.map(entry => entry.tag)).toEqual(['0000_bildr'])
    expect(existsSync(join(migrationsDir(), '0001_bildr.sql'))).toBe(false)
    expect(existsSync(join(migrationsDir(), 'meta/0001_snapshot.json'))).toBe(false)
    expect(existsSync(join(migrationsDir(), 'meta/_bildr_ids_0001.json'))).toBe(false)
    writeNote([{ id: 'fld_code', name: 'code', type: 'text' }, { id: 'fld_body', name: 'body', type: 'text' }])
    expect(await migrate({ databaseUrl: databaseUrl() })).toMatchObject({ kind: 'written', tag: '0001_bildr', applied: true })
  })

  it('keeps each field\'s data when two field names swap (verification B2)', async () => {
    const body: Field = { id: 'fld_body', name: 'body', type: 'text' }
    writeNote([{ ...title, required: false }, body])
    await migrate()
    await applyAndQuery('insert into main_notes (id, title, body) values (\'n1\', \'T\', \'B\')')
    writeNote([{ ...title, required: false, name: 'body' }, { ...body, name: 'title' }])
    expect(await migrate()).toMatchObject({ kind: 'written' })
    expect(await applyAndQuery('select title, body from main_notes')).toEqual([{ title: 'B', body: 'T' }])
  })

  it('renames onto a removed field\'s name in one gated plan: the removed data is dropped only on confirmation (verification B2)', async () => {
    writeNote([{ ...title, required: false }, { id: 'fld_body', name: 'body', type: 'text' }])
    await migrate({ databaseUrl: databaseUrl() })
    await applyAndQuery('insert into main_notes (id, title, body) values (\'n1\', \'T\', \'B\')')
    writeNote([{ id: 'fld_body', name: 'title', type: 'text' }])
    const pending = await migrate({ databaseUrl: databaseUrl() })
    expect(pending).toMatchObject({
      kind: 'pending',
      destructive: ['ALTER TABLE `main_notes` DROP COLUMN `__bildr_replaced_0`;'],
      // What the user agrees to lose, by the names they know.
      losing: ['the data of main_notes.title (a removed field)']
    })
    expect(await applyAndQuery('select title, body from main_notes')).toEqual([{ title: 'T', body: 'B' }])
    await migrate({ databaseUrl: databaseUrl(), confirm: pending.kind === 'pending' ? pending.hash : '' })
    expect(await applyAndQuery('select * from main_notes')).toEqual([{ id: 'n1', title: 'B' }])
  })

  it('names a removed entity\'s table when a new entity takes it, and leaves the new table empty', async () => {
    writeNote([title])
    await migrate({ databaseUrl: databaseUrl() })
    await applyAndQuery('insert into main_notes (id, title) values (\'n1\', \'T\')')
    rmSync(join(dir, '.bildr/modules/main/entities/note.json'))
    rmSync(join(dir, '.bildr/modules/main/repositories/note.json'))
    write('.bildr/modules/main/entities/memo.json', { id: 'ent_memo', name: 'Memo', plural: 'notes', idStrategy: 'uuid', timestamps: false, fields: [title], relations: [], client: { sync: 'eager', limit: 500 } })
    write('.bildr/modules/main/repositories/memo.json', { id: 'repo_memo', entity: 'ent_memo', datasource: 'ds_main', operations: ['list', 'get', 'create'], finders: [], list: { orderBy: [] }, expose: { list: true } })
    const pending = await migrate({ databaseUrl: databaseUrl() })
    expect(pending).toMatchObject({ kind: 'pending', destructive: ['DROP TABLE `__bildr_replaced_0`;'], losing: ['the table main_notes (a removed entity)'] })
    await migrate({ databaseUrl: databaseUrl(), confirm: pending.kind === 'pending' ? pending.hash : '' })
    expect(await applyAndQuery('select * from main_notes')).toEqual([])
  })

  it('gives a new field that reuses a removed field\'s name an empty column, never the old data (verification A2)', async () => {
    writeNote([title, { id: 'fld_body', name: 'body', type: 'text' }])
    await migrate({ databaseUrl: databaseUrl() })
    await applyAndQuery('insert into main_notes (id, title, body) values (\'n1\', \'T\', \'secret\')')
    writeNote([title, { id: 'fld_notes', name: 'body', type: 'text' }])
    const pending = await migrate({ databaseUrl: databaseUrl() })
    expect(pending).toMatchObject({ kind: 'pending' })
    await migrate({ databaseUrl: databaseUrl(), confirm: pending.kind === 'pending' ? pending.hash : '' })
    expect(await applyAndQuery('select * from main_notes')).toEqual([{ id: 'n1', title: 'T', body: null }])
  })

  it('swaps the tables of two entities that both have unique fields (verification N1)', async () => {
    const code = (unique: boolean): Field => ({ id: 'fld_code', name: 'code', type: 'text', unique })
    const writeEntity = (id: string, plural: string, extra: Field[] = []) => {
      write(`.bildr/modules/main/entities/${id}.json`, { id: `ent_${id}`, name: pascalName(id), plural, idStrategy: 'uuid', timestamps: false, fields: [code(true), ...extra], relations: [], client: { sync: 'eager', limit: 500 } })
      write(`.bildr/modules/main/repositories/${id}.json`, { id: `repo_${id}`, entity: `ent_${id}`, datasource: 'ds_main', operations: ['list', 'get', 'create'], finders: [], list: { orderBy: [] }, expose: { list: true } })
    }
    const pascalName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)
    writeEntity('note', 'notes')
    writeEntity('post', 'posts')
    await migrate({ databaseUrl: databaseUrl() })
    await applyAndQuery('insert into main_notes (id, code) values (\'n\', \'N\')')
    await applyAndQuery('insert into main_posts (id, code) values (\'p\', \'P\')')
    writeEntity('note', 'posts')
    writeEntity('post', 'notes')
    expect(await migrate({ databaseUrl: databaseUrl() })).toMatchObject({ kind: 'written', applied: true })
    expect(await applyAndQuery('select code from main_notes')).toEqual([{ code: 'P' }])
    expect(await applyAndQuery('select code from main_posts')).toEqual([{ code: 'N' }])
    // The next change migrates cleanly too.
    writeEntity('note', 'posts', [{ id: 'fld_extra', name: 'extra', type: 'text' }])
    expect(await migrate({ databaseUrl: databaseUrl() })).toMatchObject({ kind: 'written', applied: true })
  })

  it('creates a table per module when two modules have entities with the same plural (verification B3)', async () => {
    addModule('blog')
    writeNote([title])
    writeNote([title], 'blog', 'blog_note')
    const result = await migrate()
    expect(result.kind === 'written' && result.statements.filter(statement => statement.startsWith('CREATE TABLE')).map(statement => statement.split('`')[1])).toEqual(['blog_notes', 'main_notes'])
  })

  it('binds a confirmation to the migration it was shown for: an old hash never confirms a later plan', async () => {
    const body: Field = { id: 'fld_body', name: 'body', type: 'text' }
    writeNote([title, body])
    await migrate()
    writeNote([title])
    const first = await migrate()
    if (first.kind !== 'pending') throw new Error('expected a pending drop')
    await migrate({ confirm: first.hash })
    writeNote([title, body])
    await migrate()
    writeNote([title])
    expect(await migrate({ confirm: first.hash })).toMatchObject({ kind: 'pending' })
  })
})
