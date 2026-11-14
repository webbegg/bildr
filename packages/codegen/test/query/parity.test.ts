import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { moduleContext } from '../../src/generate/context'
import { queryFile } from '../../src/generate/client'
import { loadModel } from '../../src/model/load'
import type { QueryFile } from '../../src/model/schemas'
import { evaluateQuery } from '../../src/query/index'
import type { Row } from '../../src/query/index'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

/**
 * V4: the canvas's rows come from `evaluateQuery`, the app's from the
 * generated query composables over TanStack DB. This runs the generated
 * composable source (compiled, with the real `@tanstack/db` live queries
 * and the model's own rows as the client collection) and expects the same
 * rows, in the same order, as the evaluator for the same arguments.
 * `@tanstack/db` comes from the golden fixture's install (CI installs it;
 * locally the suite skips without `pnpm --dir fixtures/codegen/blog install`).
 */

const store = join(fixtureRoot, 'node_modules/.pnpm')
const dbDir = existsSync(store) ? readdirSync(store).find(name => name.startsWith('@tanstack+db@')) : undefined
const MISSING = !dbDir && !process.env.CI
const ready = dbDir ? await import(pathToFileURL(join(store, dbDir, 'node_modules/@tanstack/db/dist/esm/index.js')).href) as Record<string, any> : undefined // eslint-disable-line @typescript-eslint/no-explicit-any

const loaded = loadModel(fixtureModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const context = moduleContext(loaded.model, 'blog')

const base = { $schema: '', id: 'q_x', name: 'x', label: 'X', from: 'ent_post', params: [], result: 'many' } as unknown as QueryFile
const query = (patch: Partial<QueryFile>): QueryFile => ({ ...base, ...patch })

const rows: Row[] = [
  { id: 'p1', title: 'Alpha', slug: 'alpha', body: '', published: true, publishedAt: '2026-11-03T09:00:00.000Z', createdAt: '2026-11-03T09:00:00.000Z', n: 3 },
  { id: 'p2', title: 'beta', slug: 'beta', body: 'x', published: false, publishedAt: null, createdAt: '2026-11-01T09:00:00.000Z', n: null },
  { id: 'p3', title: 'Gamma', slug: 'gamma', body: '', published: true, publishedAt: '2026-11-02T09:00:00.000Z', createdAt: '2026-11-02T09:00:00.000Z', n: 1 },
  { id: 'p4', title: 'Delta', slug: 'delta', body: 'y', published: true, publishedAt: null, createdAt: '2026-11-04T09:00:00.000Z', n: 2 },
  { id: 'p5', title: 'alpha two', slug: 'alpha-2', body: '', published: false, publishedAt: '2026-11-05T09:00:00.000Z', createdAt: '2026-11-05T09:00:00.000Z', n: 2 }
]

/** The rows of the app's generated query: compiles its composable and runs it over a local collection of `rows`. */
const generated = async (file: QueryFile, args: unknown[], data: Row[] = rows): Promise<Array<Row | undefined>> => {
  const db = ready!
  const source = queryFile(context, file).content
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const collection = db.createCollection(db.localOnlyCollectionOptions({ id: `c${Math.random()}`, getKey: (row: Row) => row.id, initialData: data }))
  let live: { toArrayWhenReady: () => Promise<Row[]> } | undefined
  const modules: Record<string, unknown> = {
    '@tanstack/vue-db': {
      ...db,
      useLiveQuery: (build: (q: unknown) => unknown) => {
        live = db.createLiveQueryCollection((q: unknown) => build(q))
        return { data: { value: undefined } }
      }
    },
    'vue': {
      computed: (get: () => unknown) => ({
        get value() {
          return get()
        }
      }),
      toValue: (value: unknown) => typeof value === 'function' ? value() : value
    },
    '../../data/posts.collection': { postsCollection: collection }
  }
  const exports: Record<string, (...input: unknown[]) => unknown> = {}
  const load = (name: string) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`)
    return modules[name]
  }
  new Function('exports', 'require', outputText)(exports, load)
  Object.values(exports)[0]!(...args)
  return live!.toArrayWhenReady()
}

const cases: Array<{ name: string, query: QueryFile, args?: Record<string, unknown> }> = [
  { name: 'every row', query: query({}) },
  { name: 'order by a nullable field, both ways', query: query({ orderBy: [{ field: 'publishedAt', direction: 'asc' }] }) },
  { name: 'order descending by two keys', query: query({ orderBy: [{ field: 'published', direction: 'desc' }, { field: 'title', direction: 'asc' }] }) },
  { name: 'order by words (mixed case)', query: query({ orderBy: [{ field: 'title', direction: 'asc' }] }) },
  { name: 'eq on a boolean', query: query({ where: { op: 'eq', field: 'published', value: true }, orderBy: [{ field: 'createdAt', direction: 'desc' }] }) },
  { name: 'ne skips the null rows', query: query({ where: { op: 'ne', field: 'publishedAt', value: '2026-11-03T09:00:00.000Z' } }) },
  { name: 'gt on a number with nulls', query: query({ where: { op: 'gt', field: 'n', value: 1 } }) },
  { name: 'lte on dates as text', query: query({ where: { op: 'lte', field: 'createdAt', value: '2026-11-02T09:00:00.000Z' } }) },
  { name: 'in a list', query: query({ where: { op: 'in', field: 'slug', value: ['alpha', 'gamma', 'nope'] } }) },
  { name: 'like is case-sensitive', query: query({ where: { op: 'like', field: 'title', value: 'alpha%' } }) },
  { name: 'like with a single-character wildcard', query: query({ where: { op: 'like', field: 'slug', value: 'alpha-_' } }) },
  { name: 'a limit', query: query({ orderBy: [{ field: 'id', direction: 'desc' }], limit: 2 }) },
  { name: 'a limit parameter with its default', query: query({ params: [{ name: 'limit', type: 'integer', default: 3 }], orderBy: [{ field: 'id', direction: 'asc' }], limit: { $param: 'limit' } }) },
  { name: 'a limit parameter given', query: query({ params: [{ name: 'limit', type: 'integer', default: 3 }], orderBy: [{ field: 'id', direction: 'asc' }], limit: { $param: 'limit' } }), args: { limit: 4 } },
  { name: 'a condition parameter', query: query({ params: [{ name: 'slug', type: 'text', reactive: true }], where: { op: 'eq', field: 'slug', value: { $param: 'slug' } }, result: 'one' }), args: { slug: 'gamma' } },
  { name: 'a one query without a match', query: query({ params: [{ name: 'slug', type: 'text', reactive: true }], where: { op: 'eq', field: 'slug', value: { $param: 'slug' } }, result: 'one' }), args: { slug: 'zzz' } },
  { name: 'a missing parameter', query: query({ params: [{ name: 'slug', type: 'text', reactive: true }], where: { op: 'eq', field: 'slug', value: { $param: 'slug' } }, result: 'one' }) },
  { name: 'a limit without an ordering', query: query({ limit: 2 }) },
  { name: 'lt on words (mixed case)', query: query({ where: { op: 'lt', field: 'title', value: 'beta' } }) },
  { name: 'gte on words (mixed case)', query: query({ where: { op: 'gte', field: 'title', value: 'B' } }) },
  { name: 'filter, order and limit together', query: query({ where: { op: 'eq', field: 'published', value: true }, orderBy: [{ field: 'publishedAt', direction: 'desc' }], limit: 2 }) }
]

describe.skipIf(MISSING)('the evaluator and the generated query composable agree (fixtures rows)', () => {
  it.each(cases)('$name', async ({ query: file, args = {} }) => {
    const given = file.params.map(param => args[param.name])
    const app = (await generated(file, given)).map(row => row?.id)
    expect(evaluateQuery(file, rows, args).rows.map(row => row.id)).toEqual(app)
  })

  it('also agrees on the model\'s own queries and fixtures', async () => {
    const fixtures = loaded.model.modules.blog!.fixtures.find(entry => entry.entity === 'ent_post')!.rows
    expect(fixtures.length).toBeGreaterThan(0)
    for (const file of context.module.queries.filter(entry => entry.from === 'ent_post')) {
      const args = file.params.some(param => param.name === 'slug') ? { slug: 'hello-bildr' } : {}
      const given = file.params.map(param => args[param.name as keyof typeof args])
      const app = (await generated(file, given, fixtures as Row[])).map(row => row?.id)
      expect(evaluateQuery(file, fixtures as Row[], args).rows.map(row => row.id), file.id).toEqual(app)
    }
  })
})

describe('the generated query composable of a limited query', () => {
  it('orders by the entity key when the query has no ordering, so the live query compiles', () => {
    const { content } = queryFile(context, query({ limit: 2 }))
    expect(content).toContain(`.orderBy(({ post }) => post.id, 'asc')`)
    expect(content.indexOf('.orderBy(')).toBeLessThan(content.indexOf('.limit(2)'))
  })

  it('keeps the query\'s own ordering', () => {
    const { content } = queryFile(context, query({ limit: 2, orderBy: [{ field: 'title', direction: 'desc' }] }))
    expect(content).not.toContain('post.id')
  })

  it('leaves an unlimited query unordered', () => {
    expect(queryFile(context, query({})).content).not.toContain('.orderBy(')
  })
})
