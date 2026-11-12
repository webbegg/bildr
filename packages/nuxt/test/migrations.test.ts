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

type Field = { id: string, name: string, type: string, required?: boolean, default?: unknown }
const writeNote = (fields: Field[]) => {
  const write = (path: string, value: unknown) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), JSON.stringify(value, null, 2))
  }
  write('.bildr/modules/main/entities/note.json', { id: 'ent_note', name: 'Note', plural: 'notes', idStrategy: 'uuid', timestamps: false, fields, relations: [], client: { sync: 'eager', limit: 500 } })
  write('.bildr/modules/main/repositories/note.json', { id: 'repo_note', entity: 'ent_note', datasource: 'ds_main', operations: ['list', 'get', 'create'], finders: [], list: { orderBy: [] }, expose: { list: true } })
}

const migrate = async (options: { confirm?: string } = {}) => {
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
    expect(readdirSync(join(migrationsDir(), 'meta')).sort()).toEqual(['0000_snapshot.json', '_journal.json', 'bildr.json'])
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
})
