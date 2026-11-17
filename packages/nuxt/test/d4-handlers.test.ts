// D4 (S4): the sample-data module actions over HTTP and MCP: the contract a client sees (statuses, codes, files left alone on a refusal).
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const blog = fileURLToPath(new URL('../../../fixtures/codegen/blog/.bildr', import.meta.url))
const POSTS = '.bildr/modules/blog/fixtures/post.json'
const FIRST = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01'
const SECOND = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02'
let root: string
let dir: string
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-d4-handlers-'))
  dir = join(root, 'app')
  cpSync(blog, join(dir, '.bildr'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"blog","private":true}')
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)])
/** A digest of the project's files, optionally only those `keep` accepts (relative paths), to prove what a call changed. */
const snapshot = (keep: (path: string) => boolean = () => true) => createHash('sha256').update(JSON.stringify(files(dir)
  .map(path => relative(dir, path))
  .filter(path => !path.includes('.cache/') && keep(path))
  .sort()
  .map(path => [path, readFileSync(join(dir, path), 'utf8')]))).digest('hex')
const posts = () => (JSON.parse(readFileSync(join(dir, POSTS), 'utf8')) as { rows: Array<Record<string, unknown>> }).rows

const act = (name: string, body: unknown) => handle(new Request(`http://localhost:3000/__bildr/api/actions/${name}`, {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000', 'x-bildr-token': TOKEN, 'content-type': 'application/json' }
}), { remoteAddress: '127.0.0.1' })

const refused = async (name: string, body: unknown, status: number, code: string) => {
  const before = snapshot()
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, code: string, message: string }
  expect(response.status, `${name} ${JSON.stringify(body)} → ${JSON.stringify(json)}`).toBe(status)
  expect(json.code).toBe(code)
  expect(snapshot(), `${name} changed files`).toBe(before)
  return json.message
}

const done = async (name: string, body: unknown) => {
  const json = await (await act(name, body)).json() as { ok: boolean, result: Record<string, unknown> }
  expect(json.ok, `${name}: ${JSON.stringify(json)}`).toBe(true)
  return json.result
}

describe('sample-data module actions', () => {
  it('fixture_row_update writes the value to the fixtures file and says only that file changed', async () => {
    const outside = snapshot(path => !path.startsWith('.bildr/'))
    const result = await done('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { title: 'Edited' } })
    expect(result).toMatchObject({ rowId: FIRST, changed: [POSTS] })
    expect(posts()[0]).toMatchObject({ id: FIRST, title: 'Edited' })
    expect(posts()[1]).toMatchObject({ id: SECOND, title: 'A draft' })
    // Nothing but the fixtures file moved: the app's own files and rows are untouched (E2).
    expect(snapshot(path => !path.startsWith('.bildr/'))).toBe(outside)
    expect(existsSync(join(dir, '.bildr/manifest.json'))).toBe(true)
  })

  it('answers 409 conflict, writing nothing, when the row now at a key is not the one the client saw (base)', async () => {
    const seen = posts()[1]
    await done('fixture_row_update', { entity: 'ent_post', row: SECOND, base: seen, values: { title: 'Edited once' } })
    // The client still holds the first version: the row changed under it.
    expect(await refused('fixture_row_update', { entity: 'ent_post', row: SECOND, base: seen, values: { title: 'Edited twice' } }, 409, 'conflict')).toContain('changed since you loaded it')
    expect(await refused('fixture_rows_delete', { entity: 'ent_post', rows: [SECOND], base: { [SECOND]: seen } }, 409, 'conflict')).toContain('changed since you loaded it')
    expect(posts()[1]).toMatchObject({ title: 'Edited once' })
  })

  it('keeps the last row an action\'s generated test loads (422), and a null on a field with a default stores the default', async () => {
    await done('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { body: null, published: null } })
    expect(posts()[0]).toMatchObject({ body: '', published: false })
    await done('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST] })
    expect(await refused('fixture_rows_delete', { entity: 'ent_post', rows: [SECOND] }, 422, 'invalid')).toBe('Keep at least one sample row: publishPost tests use it')
    expect(posts()).toHaveLength(1)
  })

  it('refuses a value of the wrong type (422) and writes nothing', async () => {
    const message = await refused('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { published: 'yes' } }, 422, 'invalid')
    expect(message).toContain('published must be true or false')
    await refused('fixture_row_create', { entity: 'ent_post', values: { title: 7, slug: 'x' } }, 422, 'invalid')
  })

  it('refuses an unknown field (422) and an emptied required one, and writes nothing', async () => {
    expect(await refused('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { nope: 1 } }, 422, 'invalid')).toContain('has no field "nope"')
    expect(await refused('fixture_row_create', { entity: 'ent_post', values: { title: null, slug: 'only-a-slug' } }, 422, 'invalid')).toContain('title is required')
  })

  it('answers 404 to an unknown entity or row and 400 to input of the wrong shape', async () => {
    await refused('fixture_row_update', { entity: 'ent_nope', row: FIRST, values: { title: 'x' } }, 404, 'not_found')
    await refused('fixture_row_create', { entity: 'ent_nope' }, 404, 'not_found')
    await refused('fixture_rows_delete', { entity: 'ent_nope', rows: [FIRST] }, 404, 'not_found')
    await refused('fixture_row_update', { entity: 'ent_post', row: 'missing', values: { title: 'x' } }, 404, 'not_found')
    await refused('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST, 'missing'] }, 404, 'not_found')
    for (const [name, body] of [
      ['fixture_row_update', { entity: 'ent_post', row: FIRST }],
      ['fixture_row_update', { entity: 'ent_post', row: FIRST, values: {} }],
      ['fixture_row_update', { entity: 'ent_post', row: FIRST, values: 'x' }],
      ['fixture_row_create', { entity: 'bad id!' }],
      ['fixture_rows_delete', { entity: 'ent_post', rows: [] }],
      ['fixture_rows_delete', { entity: 'ent_post', rows: FIRST }]
    ] as const) await refused(name, body, 400, 'invalid_input')
  })

  it('refuses a REST collection: it has no sample data', async () => {
    for (const [name, body] of [
      ['fixture_row_create', { entity: 'ent_quote', values: {} }],
      ['fixture_row_update', { entity: 'ent_quote', row: '1', values: { text: 'x' } }],
      ['fixture_rows_delete', { entity: 'ent_quote', rows: ['1'] }]
    ] as const) expect(await refused(name, body, 422, 'invalid')).toBe('A REST collection has no sample data')
  })

  it('fixture_row_create mints the id, and fixture_rows_delete removes several rows at once', async () => {
    const made = await done('fixture_row_create', { entity: 'ent_post', values: { title: 'Third', slug: 'third' } })
    expect(made.rowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(made.changed).toEqual([POSTS])
    expect(posts().map(row => row.id)).toEqual([FIRST, SECOND, made.rowId])
    const removed = await done('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST, made.rowId] })
    expect(removed).toMatchObject({ deleted: [FIRST, made.rowId], changed: [POSTS] })
    expect(posts().map(row => row.id)).toEqual([SECOND])
  })

  it('writes the fixtures file of an entity that has none, and undoes as one step', async () => {
    await done('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] })
    const tags = '.bildr/modules/blog/fixtures/tag.json'
    expect(existsSync(join(dir, tags))).toBe(false)
    const made = await done('fixture_row_create', { entity: 'ent_tag', values: { label: 'news' } })
    expect(made).toMatchObject({ fixturesPath: tags, changed: [tags] })
    expect(JSON.parse(readFileSync(join(dir, tags), 'utf8'))).toMatchObject({ entity: 'ent_tag', rows: [{ label: 'news' }] })
    const history = await done('history_get', {}) as { undo: Array<{ action: string }> }
    expect(history.undo[0]).toMatchObject({ action: 'fixture_row_create' })
    await done('history_undo', {})
    expect(existsSync(join(dir, tags))).toBe(false)
  })

  it('are listed by MCP with a description and an input schema', async () => {
    const local = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const headers = new Headers(request.headers)
      headers.set('host', 'localhost:3000')
      return handle(new Request(request, { headers }), { remoteAddress: '127.0.0.1' })
    }) as typeof fetch
    const client = new Client({ name: 'd4-handlers', version: '0' })
    await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3000/__bildr/mcp'), { fetch: local, requestInit: { headers: { 'x-bildr-token': TOKEN } } }))
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]))
    for (const name of ['fixture_row_create', 'fixture_row_update', 'fixture_rows_delete']) {
      expect(byName[name], name).toBeDefined()
      expect(byName[name]!.description!.length).toBeGreaterThan(40)
      expect(byName[name]!.inputSchema.type).toBe('object')
    }
    expect(byName.fixture_row_create!.inputSchema.required).toEqual(['entity'])
    expect(byName.fixture_row_update!.inputSchema.required).toEqual(['entity', 'row', 'values'])
    expect(byName.fixture_rows_delete!.inputSchema.required).toEqual(['entity', 'rows'])
    await client.close()
  })
})
