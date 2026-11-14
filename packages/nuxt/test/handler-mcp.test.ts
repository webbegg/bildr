import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { ACTIONS } from '../src/actions/registry'
import { readHealth } from '../src/node/health'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
let root: string
let dir: string
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-mcp-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Sends every request of the MCP client to the handler, as a loopback client. */
const localFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init)
  const headers = new Headers(request.headers)
  headers.set('host', 'localhost:3000')
  return handle(new Request(request, { headers }), { remoteAddress: '127.0.0.1' })
}) as typeof fetch

const connect = async (token: string | false = TOKEN) => {
  const client = new Client({ name: 'bildr-test', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3000/__bildr/mcp'), {
    fetch: localFetch,
    requestInit: { headers: token ? { 'x-bildr-token': token } : {} }
  })
  await client.connect(transport)
  return client
}

const rpc = (body: unknown, headers: Record<string, string> = {}) => handle(new Request('http://localhost:3000/__bildr/mcp', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'host': 'localhost:3000', 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', ...headers }
}), { remoteAddress: '127.0.0.1' })
const listTools = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }

const text = (result: unknown) => JSON.parse(((result as { content: { text: string }[] }).content[0]!).text) as unknown

// T10a (S11): the actions are MCP tools at /__bildr/mcp, behind the editor's guard.
describe('MCP', () => {
  it('lists one tool per action, with its JSON schema', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual(ACTIONS.map(action => action.name).sort())
    const put = tools.find(tool => tool.name === 'model_file_put')!
    expect(put.inputSchema).toMatchObject({ type: 'object', required: ['path', 'content'] })
    expect(tools.find(tool => tool.name === 'model_get')!.annotations?.readOnlyHint).toBe(true)
    await client.close()
  })

  it('calls model_get and health_get', async () => {
    const client = await connect()
    const model = text(await client.callTool({ name: 'model_get', arguments: {} })) as { ok: boolean, model: { project: { name: string } } }
    expect(model.ok).toBe(true)
    expect(model.model.project.name).toBe('App')
    expect(text(await client.callTool({ name: 'health_get', arguments: {} }))).toEqual(readHealth(dir))
    await client.close()
  })

  it('runs the editing actions too (P3a): node_insert writes the page', async () => {
    const client = await connect()
    const inserted = text(await client.callTool({ name: 'node_insert', arguments: { file: 'pg_index', type: 'Text', props: { text: 'From an agent' } } })) as { nodeId: string, changed: string[] }
    expect(inserted).toEqual({ nodeId: 'n_text_1', changed: ['.bildr/modules/main/pages/index.json'] })
    expect(readFileSync(join(dir, '.bildr/modules/main/pages/index.json'), 'utf8')).toContain('From an agent')
    const refused = await client.callTool({ name: 'node_delete', arguments: { file: 'pg_index', nodeId: 'n_page' } }) as { isError?: boolean, content: { text: string }[] }
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toBe('forbidden: The page root cannot be deleted')
    await client.close()
  })

  it('reports action errors as tool errors', async () => {
    const client = await connect()
    const failed = await client.callTool({ name: 'model_file_delete', arguments: { path: '.bildr/bildr.json' } }) as { isError?: boolean, content: { text: string }[] }
    expect(failed.isError).toBe(true)
    expect(failed.content[0]!.text).toMatch(/^forbidden: /)
    const unavailable = await client.callTool({ name: 'health_run', arguments: { checks: ['lint'] } }) as { isError?: boolean, content: { text: string }[] }
    expect(unavailable.isError).toBe(true)
    expect(unavailable.content[0]!.text).toMatch(/^unavailable: /)
    await client.close()
  })

  it('needs the token as a header (the cookie is not enough) and refuses cross-origin requests', async () => {
    expect((await rpc(listTools)).status).toBe(401)
    expect((await rpc(listTools, { cookie: `bildr_token=${TOKEN}` })).status).toBe(401)
    expect((await rpc(listTools, { 'x-bildr-token': 'b'.repeat(48) })).status).toBe(401)
    expect((await rpc(listTools, { 'x-bildr-token': TOKEN, 'origin': 'http://evil.example' })).status).toBe(403)
    expect((await rpc(listTools, { 'x-bildr-token': TOKEN })).status).toBe(200)
    await expect(connect(false)).rejects.toThrow()
  })
})

describe('parity', () => {
  it('every registered action is an MCP tool and is in the HTTP list', async () => {
    const names = ACTIONS.map(action => action.name).sort()
    expect(new Set(names).size).toBe(names.length)
    const client = await connect()
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(names)
    await client.close()
    const list = await (await handle(new Request('http://localhost:3000/__bildr/api/actions', { headers: { 'host': 'localhost:3000', 'x-bildr-token': TOKEN } }), { remoteAddress: '127.0.0.1' })).json() as { name: string }[]
    expect(list.map(action => action.name).sort()).toEqual(names)
  })
})
