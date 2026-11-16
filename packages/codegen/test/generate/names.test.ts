import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import type { Model } from '../../src/model/load'
import type { EntityFile, RepositoryFile } from '../../src/model/schemas'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

/**
 * The generated names are collision-free for any entity name. The entity "Item" (plural
 * `items`) is the case that broke: its Drizzle table `items` was shadowed by the adapter's
 * own `const [items, …]`, so the app failed at runtime with "Cannot access 'items2' before
 * initialization". This compiles the generated Drizzle adapter and runs it over a real
 * in-memory libSQL database. Tools come from the golden blog fixture's install
 * (`pnpm --dir fixtures/codegen/blog install`), as in the parity test.
 */

const fixtureRequire = createRequire(join(fixtureRoot, 'package.json'))
const MISSING = !existsSync(join(fixtureRoot, 'node_modules/@libsql')) && !process.env.CI

const withEntity = (name: string, plural: string): Model => {
  const loaded = loadModel(fixtureModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  const blog = loaded.model.modules.blog!
  const post = blog.entities.find(entity => entity.id === 'ent_post')!
  const repository = blog.repositories.find(entry => entry.entity === 'ent_post')!
  const entity = {
    ...post,
    id: 'ent_extra',
    name,
    plural,
    timestamps: false,
    fields: [{ id: 'fld_extra_label', name: 'label', type: 'text', required: true }]
  } as EntityFile
  blog.entities.push(entity)
  const { finders: _finders, ...rest } = repository
  blog.repositories.push({ ...rest, id: 'repo_extra', entity: entity.id, table: `blog_${plural.toLowerCase()}`, list: { orderBy: [{ field: 'label', direction: 'asc' }] } } as RepositoryFile)
  return loaded.model
}

/** Compiles the generated modules (CommonJS) and loads one by path, resolving `../db/schema`-style imports among them. */
const load = (files: Array<{ path: string, content: string }>, path: string, externals: Record<string, unknown>): Record<string, unknown> => {
  const cache = new Map<string, Record<string, unknown>>()
  const require = (from: string, request: string): unknown => {
    if (request in externals) return externals[request]
    if (!request.startsWith('.')) throw new Error(`unexpected import ${request}`)
    const target = join(from, '..', request).replace(/^\//, '')
    return run(`${target}.ts`)
  }
  const run = (target: string): Record<string, unknown> => {
    const cached = cache.get(target)
    if (cached) return cached
    const file = files.find(entry => entry.path === target)
    if (!file) throw new Error(`no generated file ${target}`)
    const { outputText } = ts.transpileModule(file.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
    const exports: Record<string, unknown> = {}
    cache.set(target, exports)
    new Function('exports', 'require', outputText)(exports, (request: string) => require(`/${target}`, request))
    return exports
  }
  return run(path)
}

// "Item" is the reported case; the others are names the adapter itself binds (imports, parameters, locals).
const NAMES: Array<[string, string]> = [['Item', 'items'], ['Total', 'total'], ['Count', 'count'], ['Eq', 'eq'], ['Desc', 'desc'], ['Db', 'db'], ['Limit', 'limit'], ['Offset', 'offset'], ['Id', 'id']]

describe.skipIf(MISSING).each(NAMES)('an entity named "%s" (plural %s) generates a working Drizzle adapter', (name, plural) => {
  const files = generate(withEntity(name, plural))

  it('lists, reads, writes and deletes rows without shadowing its own table', async () => {
    const { createClient } = fixtureRequire('@libsql/client') as { createClient: (config: { url: string }) => { execute: (sql: string) => Promise<unknown> } }
    const { drizzle } = fixtureRequire('drizzle-orm/libsql') as { drizzle: (client: unknown) => unknown }
    const externals = {
      'drizzle-orm': fixtureRequire('drizzle-orm'),
      'drizzle-orm/sqlite-core': fixtureRequire('drizzle-orm/sqlite-core')
    }
    const client = createClient({ url: ':memory:' })
    await client.execute(`CREATE TABLE blog_${plural} (id text PRIMARY KEY NOT NULL, label text NOT NULL)`)
    interface Repository {
      list: (page: { limit: number, offset: number }) => Promise<{ items: unknown[], total: number }>
      get: (id: string) => Promise<unknown>
      create: (row: { id: string, label: string }) => Promise<unknown>
      update: (id: string, row: { id: string, label: string }) => Promise<unknown>
      delete: (id: string) => Promise<void>
    }
    const adapter = load(files, `layers/blog/server/infrastructure/repositories/${name.toLowerCase()}.drizzle.ts`, externals)
    const repository = (adapter[`drizzle${name}Repository`] as (db: unknown) => Repository)(drizzle(client))
    await repository.create({ id: 'b', label: 'Beta' })
    await repository.create({ id: 'a', label: 'Alpha' })
    expect(await repository.list({ limit: 10, offset: 0 })).toEqual({ items: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], total: 2 })
    expect(await repository.list({ limit: 1, offset: 1 })).toEqual({ items: [{ id: 'b', label: 'Beta' }], total: 2 })
    await repository.update('a', { id: 'a', label: 'Apple' })
    expect(await repository.get('a')).toEqual({ id: 'a', label: 'Apple' })
    await repository.delete('a')
    expect(await repository.get('a')).toBeUndefined()
  })
})
