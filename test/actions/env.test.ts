import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createMcpServer } from '../../server/mcp/server'
import { createApiFetcher } from '../../server/utils/apiFetch'
import type { Resolver, Transport } from '../../server/utils/urlGuard'
import type { Collection, Project, PublishedSnapshot } from '#shared/document/schema'
import { visitorSnapshot } from '#shared/runtime/visitor'
import { memoryStorage } from '../helpers'

const SECRET = 'sk_test_SECRET123'
const mcp = { caller: 'mcp' as const, source: 'mcp' }
const SOURCE = {
  type: 'api',
  url: 'https://api.example.com/{{ env.API_PATH }}',
  itemsPath: 'results',
  headers: [{ name: 'Authorization', value: 'Bearer {{ env.API_KEY }}' }]
}

const leaks = (value: unknown) => JSON.stringify(value).toLowerCase().includes(SECRET.toLowerCase())

const resolve: Resolver = async (host) => {
  if (host === 'blocked.example.com') return [{ address: '10.0.0.1', family: 4 }]
  if (host.endsWith('.example.com')) return [{ address: '93.184.216.34', family: 4 }]
  throw new Error(`getaddrinfo ENOTFOUND ${host}`)
}

async function setup() {
  const calls: { url: string, headers?: Record<string, string> }[] = []
  const transport: Transport = async (url, init) => {
    calls.push({ url: url.href, headers: init.headers })
    if (url.hostname === 'down.example.com') throw new Error(`connect ECONNREFUSED ${url.href} (${init.headers?.authorization})`)
    if (url.pathname === '/to-http') return new Response(null, { status: 302, headers: { location: 'http://api.example.com/character' } })
    if (url.pathname === '/character') return new Response(JSON.stringify({ results: [{ id: 1, name: 'Rick' }] }), { headers: { 'content-type': 'application/json' } })
    return new Response('nope', { status: 404 })
  }
  const storage = memoryStorage()
  const bildr = createBildr(storage, ACTIONS, { api: createApiFetcher({ transport, resolve }) })
  const project = await bildr.call<Project>('project_create', { name: 'Env' }, mcp)
  const projectId = project.id
  await bildr.call('env_set', { projectId, name: 'API_PATH', value: 'character' }, mcp)
  await bildr.call('env_set', { projectId, name: 'API_KEY', value: SECRET, secret: true }, mcp)
  return { bildr, storage, projectId, calls }
}

async function mcpClient(bildr: ReturnType<typeof createBildr>) {
  const client = new Client({ name: 'env-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createMcpServer(bildr).connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

describe('env actions', () => {
  it('stores variables under env:<projectId>, outside the document', async () => {
    const { bildr, storage, projectId } = await setup()
    expect(await storage.getItem(`env:${projectId}`)).toEqual([
      { name: 'API_PATH', value: 'character', secret: false },
      { name: 'API_KEY', value: SECRET, secret: true }
    ])
    const project = await bildr.call<Project>('project_get', { projectId }, mcp)
    expect(project.version).toBe(0)
    expect(JSON.stringify(project)).not.toContain('API_PATH')
  })

  it('lists public values and only marks secrets as set', async () => {
    const { bildr, projectId } = await setup()
    expect(await bildr.call('env_list', { projectId }, mcp)).toEqual({
      variables: [
        { name: 'API_PATH', secret: false, value: 'character' },
        { name: 'API_KEY', secret: true, set: true }
      ]
    })
  })

  it('updates in place, needs a new value to turn a secret public, and deletes', async () => {
    const { bildr, projectId } = await setup()
    expect(await bildr.call('env_set', { projectId, name: 'API_KEY', secret: true }, mcp)).toEqual({ name: 'API_KEY', secret: true, set: true })
    await expect(bildr.call('env_set', { projectId, name: 'API_KEY', secret: false }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: 'Turning the secret "API_KEY" public needs a new value' })
    expect(await bildr.call('env_set', { projectId, name: 'API_KEY', secret: false, value: 'open' }, mcp)).toEqual({ name: 'API_KEY', secret: false, value: 'open' })
    expect(await bildr.call('env_delete', { projectId, name: 'API_PATH' }, mcp)).toEqual({ name: 'API_PATH' })
    await expect(bildr.call('env_delete', { projectId, name: 'API_PATH' }, mcp)).rejects.toMatchObject({ code: 'not_found', message: 'Variable "API_PATH" not found' })
    await expect(bildr.call('env_set', { projectId, name: 'lower', value: '1' }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(bildr.call('env_list', { projectId: 'nope' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('records no undo step', async () => {
    const { bildr, projectId } = await setup()
    expect(await bildr.call('history_get', { projectId }, mcp)).toEqual({ undo: null, redo: null })
    await expect(bildr.call('history_undo', { projectId }, mcp)).rejects.toMatchObject({ message: 'Nothing to undo' })
  })
})

describe('API sources with env refs', () => {
  it('resolves the URL and headers on the server, at fetch time', async () => {
    const { bildr, projectId, calls } = await setup()
    const preview = await bildr.call<{ itemsPath: string }>('api_source_preview', { projectId, url: SOURCE.url, headers: SOURCE.headers }, mcp)
    expect(preview.itemsPath).toBe('results')
    expect(calls[0]).toEqual({ url: 'https://api.example.com/character', headers: { 'accept': 'application/json', 'user-agent': 'bildr', 'authorization': `Bearer ${SECRET}` } })

    const { collection } = await bildr.call<{ collection: Collection }>('collection_create', { projectId, name: 'Chars', source: SOURCE, fields: [{ key: 'name', type: 'text' }] }, mcp)
    expect(collection.source).toEqual(SOURCE)
    await bildr.call('env_set', { projectId, name: 'API_KEY', value: 'sk_test_ROTATED' }, mcp)
    const list = await bildr.call<{ records: { values: unknown }[] }>('record_list', { projectId, collection: 'chars' }, mcp)
    expect(list.records.map(r => r.values)).toEqual([{ name: 'Rick' }])
    expect(calls.at(-1)!.headers?.authorization).toBe('Bearer sk_test_ROTATED')
  })

  it('names an unknown variable, never a value', async () => {
    const { bildr, projectId } = await setup()
    await expect(bildr.call('api_source_preview', { projectId, url: 'https://api.example.com/{{ env.MISSING }}?k={{ env.API_KEY }}' }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: 'The API source uses the variable "MISSING", which is not set' })
  })

  it('runs the URL checks on the resolved URL', async () => {
    const { bildr, projectId, calls } = await setup()
    await bildr.call('env_set', { projectId, name: 'BASE', value: 'file:///etc' }, mcp)
    await expect(bildr.call('api_source_preview', { projectId, url: '{{ env.BASE }}/passwd' }, mcp)).rejects.toMatchObject({ message: 'Only http and https URLs can be fetched' })
    await bildr.call('env_set', { projectId, name: 'BASE', value: 'https://blocked.example.com' }, mcp)
    await expect(bildr.call('api_source_preview', { projectId, url: '{{ env.BASE }}/x' }, mcp)).rejects.toMatchObject({ message: expect.stringContaining('Blocked address') })
    expect(calls).toHaveLength(0)
  })

  it('refuses a secret holding the whole URL when it points somewhere blocked, sending nothing', async () => {
    const { bildr, projectId, calls } = await setup()
    for (const value of ['http://127.0.0.1/x', 'file:///etc/passwd', 'http://[::1]/', 'https://blocked.example.com/']) {
      await bildr.call('env_set', { projectId, name: 'URL', value, secret: true }, mcp)
      await expect(bildr.call('api_source_preview', { projectId, url: '{{ env.URL }}' }, mcp), value).rejects.toMatchObject({ code: 'invalid' })
    }
    expect(calls).toHaveLength(0)
  })

  it('drops the custom headers when a redirect goes from https to http', async () => {
    const { bildr, projectId, calls } = await setup()
    await bildr.call('api_source_preview', { projectId, url: 'https://api.example.com/to-http', headers: SOURCE.headers }, mcp)
    expect(calls.map(c => c.url)).toEqual(['https://api.example.com/to-http', 'http://api.example.com/character'])
    expect(calls[0]!.headers?.authorization).toBe(`Bearer ${SECRET}`)
    expect(calls[1]!.headers).toEqual({ 'accept': 'application/json', 'user-agent': 'bildr' })
  })

  it('caches each resolved secret separately', async () => {
    const { bildr, projectId, calls } = await setup()
    const preview = () => bildr.call('api_source_preview', { projectId, url: 'https://api.example.com/character', headers: [{ name: 'Authorization', value: '{{ env.K }}' }] }, mcp)
    await bildr.call('env_set', { projectId, name: 'K', value: 'one', secret: true }, mcp)
    await preview()
    await bildr.call('env_set', { projectId, name: 'K', value: 'two' }, mcp)
    await preview()
    expect(calls.map(c => c.headers?.authorization)).toEqual(['one', 'two'])
    expect(calls).toHaveLength(2)
  })

  it('does not echo an oversized secret in the error and keeps the stored variables', async () => {
    const { bildr, storage, projectId } = await setup()
    const before = await storage.getItem(`env:${projectId}`)
    const error = await bildr.call('env_set', { projectId, name: 'API_KEY', value: 'S3CR3T'.repeat(800), secret: true }, mcp).catch((e: unknown) => e as Error & { issues?: unknown })
    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toContain('S3CR3T')
    expect(JSON.stringify(error.issues ?? [])).not.toContain('S3CR3T')
    expect(await storage.getItem(`env:${projectId}`)).toEqual(before)
  })

  it('refuses a resolved header value with line breaks', async () => {
    const { bildr, projectId } = await setup()
    await bildr.call('env_set', { projectId, name: 'BAD', value: 'a\r\nX-Injected: 1' }, mcp)
    await expect(bildr.call('api_source_preview', { projectId, url: 'https://api.example.com/character', headers: [{ name: 'X-A', value: '{{ env.BAD }}' }] }, mcp))
      .rejects.toMatchObject({ message: 'The header "X-A" has an invalid value: Header values cannot contain line breaks' })
  })
})

describe('publish with env', () => {
  it('snapshots the public variables only; visitors get them without source headers', async () => {
    const { bildr, storage, projectId } = await setup()
    await bildr.call('collection_create', { projectId, name: 'Chars', source: SOURCE, fields: [{ key: 'name', type: 'text' }] }, mcp)
    const published = await bildr.call('project_publish', { projectId }, mcp)
    expect(leaks(published)).toBe(false)
    const stored = await storage.getItem<PublishedSnapshot>(`published:${projectId}`)
    expect(stored!.env).toEqual({ API_PATH: 'character' })
    const visitor = visitorSnapshot((await bildr.services.getPublished('env'))!)
    expect(visitor.env).toEqual({ API_PATH: 'character' })
    expect(visitor.project.collections[0]!.source).toEqual({ type: 'api' })
    expect(JSON.stringify(visitor)).not.toContain('Authorization')
  })
})

describe('secret leak checks', () => {
  async function everything() {
    const ctx = await setup()
    const { bildr, storage, projectId } = ctx
    await bildr.call('collection_create', { projectId, name: 'Chars', source: SOURCE, fields: [{ key: 'name', type: 'text' }] }, mcp)
    await bildr.call('collection_create', { projectId, name: 'Down', source: { ...SOURCE, url: 'https://down.example.com/?k={{ env.API_KEY }}' } }, mcp)
    await bildr.call('theme_update', { projectId, colors: { primary: '{{ env.BRAND }}' } }, mcp)
    return { ...ctx, history: () => storage.getItem(`history:${projectId}`) }
  }

  it('never shows the secret in project_get, env_list, the history or history_get', async () => {
    const { bildr, projectId, history } = await everything()
    expect(leaks(await bildr.call('project_get', { projectId }, mcp))).toBe(false)
    expect(leaks(await bildr.call('env_list', { projectId }, mcp))).toBe(false)
    expect(leaks(await bildr.call('env_set', { projectId, name: 'API_KEY', secret: true }, mcp))).toBe(false)
    expect(leaks(await bildr.call('history_get', { projectId }, mcp))).toBe(false)
    expect(leaks(await history())).toBe(false)
  })

  it('never shows the secret in project_publish, the stored snapshot or /api/published', async () => {
    const { bildr, storage, projectId } = await everything()
    expect(leaks(await bildr.call('project_publish', { projectId }, mcp))).toBe(false)
    expect(leaks(await storage.getItem(`published:${projectId}`))).toBe(false)
    expect(leaks(visitorSnapshot((await bildr.services.getPublished('env'))!))).toBe(false)
  })

  it('redacts the secret from fetch errors: unreachable host, blocked host, unresolvable host', async () => {
    const { bildr, projectId, calls } = await everything()
    const failure = async (input: object) => {
      const error = await bildr.call('api_source_preview', { projectId, ...input }, mcp).then(() => undefined, (e: unknown) => e as Error)
      expect(error).toBeInstanceOf(Error)
      return error!.message
    }
    const down = await failure({ url: 'https://down.example.com/?k={{ env.API_KEY }}', headers: SOURCE.headers })
    expect(calls.at(-1)!.url).toContain(SECRET)
    expect(down).toBe('Could not reach the API: connect ECONNREFUSED https://down.example.com/?k=••• (Bearer •••)')
    await bildr.call('env_set', { projectId, name: 'HOST', value: SECRET, secret: true }, mcp)
    expect(await failure({ url: 'https://{{ env.HOST }}.example.org/' })).toBe('Could not resolve •••.example.org')
    await bildr.call('env_set', { projectId, name: 'HOST', value: 'blocked.example.com', secret: true }, mcp)
    expect(await failure({ url: 'https://{{ env.HOST }}/' })).toBe('Blocked address: ••• resolves to 10.0.0.1, a private, loopback or link-local address')
  })

  it('redacts the secret from record reads of the draft and the published app (public reads)', async () => {
    const { bildr, projectId } = await everything()
    await expect(bildr.call('record_list', { projectId, collection: 'down' }, mcp)).rejects.toMatchObject({ message: expect.not.stringContaining(SECRET) })
    await bildr.call('project_publish', { projectId }, mcp)
    const snapshot = (await bildr.services.getPublished('env'))!
    const down = snapshot.project.collections.find(c => c.slug === 'down')!
    const error = await bildr.services.collectionRecords(projectId, down).catch((e: Error) => e)
    expect((error as Error).message).toBe('Could not reach the API: connect ECONNREFUSED https://down.example.com/?k=••• (Bearer •••)')
  })

  it('never shows the secret over MCP: tools/list and tools/call', async () => {
    const { bildr, projectId } = await everything()
    const client = await mcpClient(bildr)
    expect(leaks(await client.listTools())).toBe(false)
    const tools = (await client.listTools()).tools.map(t => t.name)
    expect(tools).toEqual(expect.arrayContaining(['env_list', 'env_set', 'env_delete']))
    for (const [name, args] of [
      ['env_list', { projectId }],
      ['env_set', { projectId, name: 'API_KEY', secret: true }],
      ['project_get', { projectId }],
      ['history_get', { projectId }],
      ['project_publish', { projectId }],
      ['record_list', { projectId, collection: 'down' }],
      ['api_source_preview', { projectId, url: 'https://down.example.com/?k={{ env.API_KEY }}' }]
    ] as const) {
      expect(leaks(await client.callTool({ name, arguments: args })), name).toBe(false)
    }
    expect(leaks(await client.callTool({ name: 'env_delete', arguments: { projectId, name: 'API_KEY' } }))).toBe(false)
  })
})
