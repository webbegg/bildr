// D10a (S10): the query and action module actions over HTTP and MCP: the contract a client sees (statuses, codes, files left alone on a refusal).
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  root = mkdtempSync(join(tmpdir(), 'bildr-d10a-handlers-'))
  dir = join(root, 'app')
  cpSync(blog, join(dir, '.bildr'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"blog","private":true}')
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)])
/** A digest of every file of the project (the editor's own cache aside), to prove a refusal wrote nothing. */
const snapshot = () => createHash('sha256').update(JSON.stringify(files(dir)
  .filter(path => !path.includes('/.cache/'))
  .sort()
  .map(path => [relative(dir, path), readFileSync(path, 'utf8')]))).digest('hex')

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

describe('query and action module actions', () => {
  it('answer 400 to input of the wrong shape and 404 to an unknown target, and write nothing', async () => {
    const malformed: Array<[string, unknown]> = [
      ['query_create', { entity: 'ent_post', result: 'many' }],
      ['query_create', { entity: 'ent_post', result: 'x', name: 'a' }],
      ['query_create', { entity: 'ent_post', result: 'many', name: '' }],
      ['query_rename', { query: 'q_all_posts' }],
      ['query_rename', { query: 'q_all_posts', name: 1 }],
      ['query_delete', {}],
      ['query_delete', { query: 'bad id!' }],
      ['action_create', { entity: 'ent_post', template: 'x', name: 'a' }],
      ['action_create', { entity: 'ent_post', name: 'a' }],
      ['action_update', { action: 'act_publish_post', steps: [] }],
      ['action_update', { action: 'act_publish_post', http: { method: 'GET' } }],
      ['action_rename', { action: 'act_publish_post' }],
      ['action_delete', {}],
      ['query_update', { query: 'q_all_posts', inPlace: 'yes' }],
      ['query_update', { query: 'q_all_posts', result: 'some' }],
      ['query_update', { query: 'q_all_posts', params: [{ name: 'a', type: 'nope' }] }]
    ]
    for (const [name, body] of malformed) await refused(name, body, 400, 'invalid_input')
    const unknown: Array<[string, unknown]> = [
      ['query_create', { entity: 'ent_nope', result: 'many', name: 'a' }],
      ['query_create', { module: 'nope', entity: 'ent_post', result: 'many', name: 'a' }],
      ['query_rename', { query: 'q_nope', name: 'a' }],
      ['query_delete', { query: 'q_nope' }],
      ['action_create', { entity: 'ent_nope', template: 'blank', name: 'a' }],
      ['action_update', { action: 'act_nope', label: 'x' }],
      ['action_rename', { action: 'act_nope', name: 'a' }],
      ['action_delete', { action: 'act_nope' }],
      ['query_update', { query: 'q_nope', inPlace: true }]
    ]
    for (const [name, body] of unknown) await refused(name, body, 404, 'not_found')
  })

  it('refuse a delete while the item is used (422), and write nothing', async () => {
    for (const query of ['q_featured_posts', 'q_all_posts', 'q_latest_quotes', 'q_post_by_slug']) await refused('query_delete', { query }, 422, 'invalid')
    for (const action of ['act_create_post', 'act_publish_post']) await refused('action_delete', { action }, 422, 'invalid')
  })

  it('refuse an action_delete when only a Form prop names the action (no page use), saying so', async () => {
    type Node = { id: string, props?: Record<string, unknown>, interactions?: unknown, children?: Node[] }
    const path = join(dir, '.bildr/modules/blog/pages/new-post.json')
    const page = JSON.parse(readFileSync(path, 'utf8')) as { uses?: unknown, root: Node }
    // Drop the page use and the interactions: only the Form's action prop still names it.
    delete page.uses
    const strip = (node: Node) => {
      if (node.id === 'n_form') delete node.interactions
      const props = node.props ?? {}
      if (typeof props.text === 'object' && String((props.text as { $bind?: string }).$bind).startsWith('createPost')) props.text = 'x'
      for (const key of ['visible', 'disabled']) if (typeof props[key] === 'object' && String((props[key] as { $bind?: string }).$bind).startsWith('createPost')) Reflect.deleteProperty(props, key)
      node.children?.forEach(strip)
    }
    strip(page.root)
    writeFileSync(path, `${JSON.stringify(page, null, 2)}\n`)
    const message = await refused('action_delete', { action: 'act_create_post' }, 422, 'invalid')
    expect(message).toContain('Form')
  })

  it('are listed by MCP with a description and an input schema', async () => {
    const local = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const headers = new Headers(request.headers)
      headers.set('host', 'localhost:3000')
      return handle(new Request(request, { headers }), { remoteAddress: '127.0.0.1' })
    }) as typeof fetch
    const client = new Client({ name: 'd10a-handlers', version: '0' })
    await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3000/__bildr/mcp'), { fetch: local, requestInit: { headers: { 'x-bildr-token': TOKEN } } }))
    const { tools } = await client.listTools()
    for (const name of ['query_create', 'query_rename', 'query_delete', 'action_create', 'action_update', 'action_rename', 'action_delete', 'query_update']) {
      const tool = tools.find(entry => entry.name === name)
      expect(tool, name).toBeDefined()
      expect(tool!.description!.length).toBeGreaterThan(20)
      expect(tool!.inputSchema.type).toBe('object')
      expect(Object.keys(tool!.inputSchema.properties ?? {}).length).toBeGreaterThan(0)
    }
    await client.close()
  })

  it('write only files under .bildr/modules', async () => {
    const action = await done('action_create', { entity: 'ent_post', template: 'delete', name: 'removePost' })
    expect(action.changed).toEqual(['.bildr/modules/blog/actions/remove-post.json'])
    const query = await done('query_create', { entity: 'ent_post', result: 'one', name: 'postById' })
    expect(query.changed).toEqual(['.bildr/modules/blog/queries/post-by-id.json'])
  })

  it('refuse a name the generated app can\'t declare (422), and write nothing', async () => {
    for (const name of ['blogPreferences', 'index']) await refused('action_create', { entity: 'ent_post', template: 'blank', name }, 422, 'invalid')
    await refused('query_create', { entity: 'ent_post', result: 'many', name: 'blogPreferences' }, 422, 'invalid')
  })
})
