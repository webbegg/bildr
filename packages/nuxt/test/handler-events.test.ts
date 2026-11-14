// P3b: the event stream (SSE) and the version route, behind the editor's guard.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { createModelEvents } from '../src/node/events'
import type { ModelEvents } from '../src/node/events'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const pagePath = '.bildr/modules/main/pages/index.json'
let root: string
let dir: string
let events: ModelEvents
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-events-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  events = createModelEvents()
  handle = createBildrHandler({ root: dir, token: TOKEN, events, heartbeatMs: 20 })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const get = (path: string, headers: Record<string, string> = { 'x-bildr-token': TOKEN }, context: { remoteAddress?: string, signal?: AbortSignal } = { remoteAddress: '127.0.0.1' }) =>
  handle(new Request(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000', ...headers } }), context)

const act = async (name: string, body: unknown = {}) => {
  const response = await handle(new Request(`http://localhost:3000/__bildr/api/actions/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000', 'x-bildr-token': TOKEN, 'content-type': 'application/json' }
  }), { remoteAddress: '127.0.0.1' })
  const json = await response.json() as { ok: boolean }
  expect(json.ok, JSON.stringify(json)).toBe(true)
}

/** Reads SSE messages from a stream: each `data:` payload parsed, comments (heartbeats) as `':'`. */
const reader = (response: Response) => {
  const stream = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  const next = async (): Promise<unknown> => {
    for (;;) {
      const end = buffer.indexOf('\n\n')
      if (end >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n')
        if (data) return JSON.parse(data) as unknown
        if (block.startsWith(':')) return ':'
        continue
      }
      const { value, done } = await stream.read()
      if (done) return undefined
      buffer += value
    }
  }
  /** The next message that isn't a heartbeat. */
  const event = async () => {
    for (;;) {
      const message = await next()
      if (message !== ':') return message
    }
  }
  return { next, event, cancel: () => stream.cancel() }
}

describe('GET /__bildr/api/events', () => {
  it('is guarded like the other routes', async () => {
    expect((await get('/__bildr/api/events', {})).status).toBe(401)
    expect((await get('/__bildr/api/events', { 'x-bildr-token': 'b'.repeat(48) })).status).toBe(401)
    expect((await get('/__bildr/api/events', { 'x-bildr-token': TOKEN }, { remoteAddress: '10.0.0.2' })).status).toBe(403)
    expect(events.listeners).toBe(0)
  })

  it('streams the current version, then a model event for each action, and navigate/context', async () => {
    const response = await get('/__bildr/api/events', { cookie: `bildr_token=${TOKEN}` })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const sse = reader(response)
    expect(await sse.event()).toEqual({ type: 'ready', version: 0 })

    await act('node_insert', { file: 'pg_index', type: 'Text' })
    expect(await sse.event()).toEqual({ type: 'model', version: 1, files: [pagePath], source: 'action' })
    events.regenerated({ ok: true })
    expect(await sse.event()).toEqual({ type: 'regenerated', version: 1, ok: true })

    await act('history_undo')
    expect(await sse.event()).toEqual({ type: 'model', version: 2, files: [pagePath], source: 'undo' })
    await act('history_redo')
    expect(await sse.event()).toEqual({ type: 'model', version: 3, files: [pagePath], source: 'redo' })

    await act('editor_navigate', { file: 'pg_index', nodeId: 'n_h1' })
    expect(await sse.event()).toEqual({ type: 'navigate', target: { file: 'pg_index', kind: 'page', nodeId: 'n_h1', variant: null } })
    await act('editor_context_set', { file: 'pg_index', nodeId: null })
    expect(await sse.event()).toMatchObject({ type: 'context', context: { file: 'pg_index', nodeId: null, variant: null } })
    await sse.cancel()
  })

  it('sends heartbeats', async () => {
    const sse = reader(await get('/__bildr/api/events'))
    await sse.event()
    expect(await sse.next()).toBe(':')
    await sse.cancel()
  })

  it('drops the subscriber when the client goes away (stream cancelled or request aborted)', async () => {
    const sse = reader(await get('/__bildr/api/events'))
    await sse.event()
    expect(events.listeners).toBe(1)
    await sse.cancel()
    expect(events.listeners).toBe(0)

    const disconnect = new AbortController()
    const response = await get('/__bildr/api/events', { 'x-bildr-token': TOKEN }, { remoteAddress: '127.0.0.1', signal: disconnect.signal })
    const aborted = reader(response)
    await aborted.event()
    expect(events.listeners).toBe(1)
    disconnect.abort()
    expect(events.listeners).toBe(0)
    expect(await aborted.event()).toBeUndefined()
  })

  it('refuses more streams than the bus takes (503)', async () => {
    const full = createModelEvents()
    const offs = Array.from({ length: 64 }, () => full.subscribe(() => {}))
    const crowded = createBildrHandler({ root: dir, token: TOKEN, events: full })
    const response = await crowded(new Request('http://localhost:3000/__bildr/api/events', { headers: { 'host': 'localhost:3000', 'x-bildr-token': TOKEN } }), { remoteAddress: '127.0.0.1' })
    expect(response.status).toBe(503)
    offs.forEach(off => off!())
  })
})

describe('GET /__bildr/api/version', () => {
  it('returns the model version, guarded', async () => {
    expect((await get('/__bildr/api/version', {})).status).toBe(401)
    expect(await (await get('/__bildr/api/version')).json()).toEqual({ version: 0 })
    await act('node_insert', { file: 'pg_index', type: 'Text' })
    expect(await (await get('/__bildr/api/version')).json()).toEqual({ version: 1 })
  })
})
