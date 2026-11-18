// B1 (S1–S4, S6): the app behaviour module actions (state, node interactions, page uses of a state, computed values) over HTTP and MCP:
// the contract a client sees (statuses, codes, files left alone on a refusal, the files an action writes).
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const blog = fileURLToPath(new URL('../../../fixtures/codegen/blog/.bildr', import.meta.url))
let root: string
let dir: string
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-b1-handlers-'))
  dir = join(root, 'app')
  cpSync(blog, join(dir, '.bildr'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"blog","private":true}')
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)])
/**
 * A digest of every file of the project (the editor's own cache aside), to prove a refusal wrote nothing. The cache is told by the path
 * relative to the project: the temp folder itself may sit under a `.cache` folder (TMPDIR=~/.cache/…), and then nothing would be counted.
 */
const snapshot = () => createHash('sha256').update(JSON.stringify(files(dir)
  .map(path => relative(dir, path))
  .filter(path => !`/${path}`.includes('/.cache/'))
  .sort()
  .map(path => [path, readFileSync(join(dir, path), 'utf8')]))).digest('hex')

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

const read = (path: string) => JSON.parse(readFileSync(join(dir, path), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const PAGE = '.bildr/modules/blog/pages/new-post.json'
const READING = '.bildr/modules/blog/state/reading.json'
const READING_FIELDS = [{ name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }]

describe('the snapshot a refusal is held to', () => {
  it('sees a file written in the project, wherever the temp folder is (also under a .cache folder)', () => {
    const before = snapshot()
    writeFileSync(join(dir, 'written.txt'), 'x')
    expect(snapshot()).not.toBe(before)
    // The editor's own cache is left out: a path relative to the project says which one it is.
    const withCache = snapshot()
    mkdirSync(join(dir, '.cache'), { recursive: true })
    writeFileSync(join(dir, '.cache', 'index.json'), '{}')
    expect(snapshot()).toBe(withCache)
  })
})

describe('behaviour module actions', () => {
  it('answer 400 to input of the wrong shape and 404 to an unknown target, and write nothing', async () => {
    const malformed: Array<[string, unknown]> = [
      ['state_create', {}],
      ['state_create', { name: 'reading', persist: 'cloud' }],
      ['state_create', { name: 'reading', fields: [{ name: 'a', type: 'nope' }] }],
      ['state_create', { name: 'reading', fields: [] }],
      ['state_update', {}],
      ['state_update', { state: 'bad id!' }],
      ['state_update', { state: 'st_preferences', fields: [] }],
      ['state_rename', { state: 'st_preferences' }],
      ['state_delete', {}],
      ['node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'hover', do: [{ kind: 'toast', title: 'x' }] }],
      ['node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'click', do: [] }],
      ['node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'click', do: [{ kind: 'dance' }] }],
      ['node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'click' }],
      ['node_interaction_update', { file: 'pg_index', nodeId: 'n_toggle', index: -1, on: 'click' }],
      ['node_interaction_remove', { file: 'pg_index', nodeId: 'n_toggle' }],
      ['page_computed_set', { page: 'pg_index', as: 'x' }],
      ['page_computed_set', { page: 'pg_index', as: 'Not Camel', if: true, then: 1, else: 2 }],
      ['page_computed_remove', { page: 'pg_index' }]
    ]
    for (const [name, body] of malformed) await refused(name, body, 400, 'invalid_input')
    const unknown: Array<[string, unknown]> = [
      ['state_create', { module: 'nope', name: 'reading' }],
      ['state_update', { state: 'st_nope', label: 'x' }],
      ['state_rename', { state: 'st_nope', name: 'a' }],
      ['state_delete', { state: 'st_nope' }],
      ['node_interaction_add', { file: 'pg_nope', nodeId: 'n_toggle', on: 'click', do: [{ kind: 'toast', title: 'x' }] }],
      ['node_interaction_add', { file: 'pg_index', nodeId: 'n_nope', on: 'click', do: [{ kind: 'toast', title: 'x' }] }],
      ['node_interaction_update', { file: 'pg_index', nodeId: 'n_toggle', index: 5, on: 'click' }],
      ['node_interaction_remove', { file: 'pg_index', nodeId: 'n_toggle', index: 5 }],
      ['page_computed_set', { page: 'pg_nope', as: 'x', if: true, then: 1, else: 2 }],
      ['page_computed_remove', { page: 'pg_index', as: 'nothing' }],
      ['page_use_add', { page: 'pg_new_post', as: 'x', state: 'st_nope' }],
      ['page_use_remove', { page: 'pg_new_post', state: 'st_preferences' }]
    ]
    for (const [name, body] of unknown) await refused(name, body, 404, 'not_found')
  })

  it('refuse what the model or the generator cannot take (422), and write nothing', async () => {
    const message = await refused('state_delete', { state: 'st_preferences' }, 422, 'invalid')
    expect(message).toContain('pg_index')
    await refused('state_update', { state: 'st_preferences', fields: [{ name: 'other', type: 'boolean', default: false }] }, 422, 'invalid')
    await refused('state_create', { name: 'preferences' }, 422, 'invalid')
    await refused('state_create', { name: 'data' }, 422, 'invalid')
    await refused('state_create', { name: 'posts' }, 422, 'invalid')
    await refused('state_create', { name: 'reading', shape: 'many' }, 422, 'invalid')
    await refused('state_create', { name: 'reading', fields: [{ name: 'a', type: 'text', required: true }] }, 422, 'invalid')
    await refused('page_use_remove', { page: 'pg_index', as: 'preferences' }, 422, 'invalid')
    await refused('page_computed_remove', { page: 'pg_index', as: 'posts' }, 422, 'invalid')
    await refused('page_computed_set', { page: 'pg_index', as: 'x', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'quotes' } }, 422, 'invalid')
    const appear = await refused('node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'appear', do: [{ kind: 'toast', title: 'x' }] }, 422, 'invalid')
    expect(appear).toContain('not generated yet')
    await refused('node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'click', do: [{ kind: 'setVariant', to: '' }] }, 422, 'invalid')
    await refused('node_interaction_add', { file: 'pg_index', nodeId: 'n_head', on: 'click', do: [{ kind: 'toast', title: 'x' }] }, 422, 'invalid')
    await refused('node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'change', do: [{ kind: 'toast', title: 'x' }] }, 422, 'invalid')
  })

  it('build a state, a use of it, an interaction that sets it and a computed value, and write only model files', async () => {
    const state = await done('state_create', { name: 'reading', label: 'Reading', persist: 'session', fields: READING_FIELDS })
    expect(state).toEqual({ stateId: 'st_reading', filePath: READING, changed: [READING] })
    expect(read(READING)).toMatchObject({ id: 'st_reading', persist: 'session', shape: 'single' })

    expect(await done('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading' })).toEqual({ as: 'reading', changed: [PAGE] })
    expect(read(PAGE).uses.state).toEqual([{ as: 'reading', state: 'st_reading' }])

    const added = await done('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_cancel', on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: 2 }] })
    expect(added).toEqual({ index: 1, addedUses: [], changed: [PAGE] })
    expect(await done('node_interaction_update', { file: 'pg_new_post', nodeId: 'n_cancel', index: 1, on: 'mouseleave' })).toEqual({ addedUses: [], droppedUses: [], changed: [PAGE] })
    // The last step that sets the state goes: the use the page had of it goes with it.
    expect(await done('node_interaction_remove', { file: 'pg_new_post', nodeId: 'n_cancel', index: 1 })).toEqual({ droppedUses: [{ as: 'reading', state: 'st_reading' }], changed: [PAGE] })
    expect(read(PAGE).uses.state).toBeUndefined()
    expect(await done('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading' })).toEqual({ as: 'reading', changed: [PAGE] })
    expect(await done('page_use_remove', { page: 'pg_new_post', state: 'st_reading' })).toEqual({ changed: [PAGE] })

    const INDEX = '.bildr/modules/blog/pages/index.json'
    expect(await done('page_computed_set', { page: 'pg_index', as: 'shown', if: { not: { $bind: 'preferences.showDrafts' } }, then: { $bind: 'featured' }, else: { $bind: 'all' } })).toEqual({ as: 'shown', changed: [INDEX] })
    expect(read(INDEX).uses.computed.map((entry: { as: string }) => entry.as)).toEqual(['posts', 'shown'])
    expect(await done('page_computed_remove', { page: 'pg_index', as: 'shown' })).toEqual({ changed: [INDEX] })

    expect(await done('state_update', { state: 'st_reading', persist: 'localStorage', fields: [{ name: 'zoom', type: 'number', default: 1 }] })).toEqual({ stateId: 'st_reading', changed: [READING] })
    expect(await done('state_rename', { state: 'st_reading', name: 'view' })).toMatchObject({ name: 'view', previousName: 'reading', composable: 'useBlogView', previousComposable: 'useBlogReading' })
    expect(await done('state_delete', { state: 'st_reading' })).toEqual({ deleted: ['st_reading'], changed: [READING] })
    expect(files(join(dir, '.bildr')).map(path => relative(dir, path)).filter(path => path.includes('reading'))).toEqual([])
  })

  it('refuse a layout or component node a setState, the way the generator cannot build it', async () => {
    const inserted = await done('node_insert', { file: 'lay_main', parentId: 'n_nav', type: 'Button', props: { text: 'Write' } })
    await refused('node_interaction_add', { file: 'lay_main', nodeId: inserted.nodeId, on: 'click', do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: true }] }, 422, 'invalid')
    await done('node_interaction_add', { file: 'lay_main', nodeId: inserted.nodeId, on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_new_post' } }] })
  })

  it('are listed by MCP with a description and the input each takes', async () => {
    const local = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const headers = new Headers(request.headers)
      headers.set('host', 'localhost:3000')
      return handle(new Request(request, { headers }), { remoteAddress: '127.0.0.1' })
    }) as typeof fetch
    const client = new Client({ name: 'b1-handlers', version: '0' })
    await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3000/__bildr/mcp'), { fetch: local, requestInit: { headers: { 'x-bildr-token': TOKEN } } }))
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]))
    const required = (name: string) => (byName[name]!.inputSchema.required ?? []) as string[]
    expect(required('state_create')).toEqual(['name'])
    expect(required('state_update')).toEqual(['state'])
    expect(required('state_rename')).toEqual(['state', 'name'])
    expect(required('state_delete')).toEqual(['state'])
    expect(required('node_interaction_add')).toEqual(['file', 'nodeId', 'on', 'do'])
    expect(required('node_interaction_update')).toEqual(['file', 'nodeId', 'index'])
    expect(required('node_interaction_remove')).toEqual(['file', 'nodeId', 'index'])
    expect(required('page_computed_set')).toEqual(['page', 'as', 'if', 'then', 'else'])
    expect(required('page_computed_remove')).toEqual(['page', 'as'])
    expect(Object.keys(byName.page_use_add!.inputSchema.properties ?? {})).toContain('state')
    expect(Object.keys(byName.page_use_remove!.inputSchema.properties ?? {})).toEqual(['page', 'as', 'state'])
    expect((byName.state_create!.inputSchema.properties as Record<string, { enum?: string[] }>).persist!.enum).toEqual(['memory', 'session', 'localStorage'])
    for (const name of ['state_create', 'state_update', 'state_rename', 'state_delete', 'node_interaction_add', 'node_interaction_update', 'node_interaction_remove', 'page_computed_set', 'page_computed_remove']) {
      expect(byName[name]!.description!.length, name).toBeGreaterThan(40)
      expect(byName[name]!.annotations?.readOnlyHint, name).not.toBe(true)
    }
    expect(byName.state_create!.description).toContain('not generated yet')
    expect(byName.node_interaction_add!.description).toContain('not generated yet')

    const created = await client.callTool({ name: 'state_create', arguments: { name: 'reading', fields: READING_FIELDS } }) as { isError?: boolean, content: { text: string }[] }
    expect(created.isError).toBeFalsy()
    expect(JSON.parse(created.content[0]!.text)).toEqual({ stateId: 'st_reading', filePath: READING, changed: [READING] })
    const refusedCall = await client.callTool({ name: 'state_delete', arguments: { state: 'st_preferences' } }) as { isError?: boolean, content: { text: string }[] }
    expect(refusedCall.isError).toBe(true)
    expect(refusedCall.content[0]!.text).toMatch(/^invalid: State preferences \(st_preferences\) is still used/)
    await client.close()
  })
})
