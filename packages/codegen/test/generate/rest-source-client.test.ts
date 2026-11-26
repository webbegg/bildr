import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { starterKit } from '../../src/starter/index'
import { generatedRunner } from './run-generated'

/**
 * codegen-architecture R1': a REST data source's client is built in its module's composition root (it replaced core's useRemote), over
 * the core HTTP client. The API-only golden's root is run for real against a local server, with `nuxt/server` stubbed to the runtime
 * config it reads: the key is sent to the source only, a failure is the source's error, and a 404 is no such row.
 */
const apiOnlyRoot = fileURLToPath(new URL('../../../../fixtures/codegen/api-only', import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
const CONFIG = '__bildrSourceConfig'
const TASK = '6f1c2d3e-4b5a-4c6d-8e7f-000000000101'

interface Main {
  listTasks: (page: { limit: number, offset: number }) => Promise<unknown>
  completeTask: (id: string) => Promise<unknown>
  deleteTask: (id: string) => Promise<unknown>
}
type Call = (path: string, request: { method: string, query?: Record<string, unknown> }) => Promise<unknown>

describe('the generated client of a REST data source', () => {
  const seen: Array<{ method?: string, url?: string, headers: Record<string, string | string[] | undefined> }> = []
  const elsewhere: string[] = []
  const other = createServer((request, response) => {
    elsewhere.push(request.url!)
    response.end('{}')
  })
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers })
    const path = decodeURIComponent(new URL(request.url!, 'http://stub').pathname)
    const answer = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, body === undefined ? headers : { 'content-type': 'application/json', ...headers })
      response.end(body === undefined ? undefined : JSON.stringify(body))
    }
    if (path === '/v1/tasks') return answer(200, { items: [{ id: TASK, title: 'Write', done: false }], total: 1 })
    if (path === `/v1/tasks/${TASK}`) return answer(404)
    for (const status of [401, 429, 500, 422]) {
      if (path === `/v1/tasks/6f1c2d3e-4b5a-4c6d-8e7f-000000000${status}`) return answer(status, undefined, status === 429 ? { 'retry-after': '3' } : {})
    }
    if (path === '/v1/tasks/6f1c2d3e-4b5a-4c6d-8e7f-000000000302') {
      return answer(302, undefined, { location: `http://127.0.0.1:${(other.address() as AddressInfo).port}/v1/tasks` })
    }
    answer(200, { path })
  })
  let dir: string
  let useMain: () => Main
  let statusOf: Record<string, number>
  let call: Call

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bildr-rest-source-'))
    const kit = starterKit({ name: 'Tasks', database: 'none' })
    const added = Object.fromEntries(walk(join(apiOnlyRoot, '.bildr')).map(path => [relative(apiOnlyRoot, path), readFileSync(path, 'utf8')]))
    const loaded = loadModel({ ...kit.model, ...added })
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const { load } = generatedRunner(new Map(generate(loaded.model).map(file => [file.path, file.content])), dir, {
      'nuxt/server': `export const useRuntimeConfig = () => globalThis.${CONFIG}`
    })
    const root = await load<{ useMain: typeof useMain, mainErrorStatus: typeof statusOf }>('layers/main/server/utils/main.ts')
    useMain = root.useMain
    statusOf = root.mainErrorStatus
    const core = await load<{ createHttpClient: (options: { baseUrl: string }) => Call }>('layers/core/shared/http/client.ts')
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    ;(globalThis as Record<string, unknown>)[CONFIG] = { datasources: { api: { baseUrl, apiKey: 'secret' } } }
    call = core.createHttpClient({ baseUrl })
  })
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    Reflect.deleteProperty(globalThis, CONFIG)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await new Promise<void>(resolve => other.close(() => resolve()))
  })

  it('calls the path with the query and the source\'s bearer key, and answers the page it read', async () => {
    seen.length = 0
    await expect(useMain().listTasks({ limit: 3, offset: 0 })).resolves.toEqual({ ok: true, value: { items: [{ id: TASK, title: 'Write', done: false }], total: 1 } })
    expect(seen).toMatchObject([{ method: 'GET', url: '/v1/tasks?limit=3&offset=0', headers: { accept: 'application/json', authorization: 'Bearer secret' } }])
  })

  it('a lookup answered 404 is no such row: the use-case answers its own not-found error', async () => {
    await expect(useMain().completeTask(TASK)).resolves.toEqual({ ok: false, error: { type: 'task_not_found', message: 'Task not found.', id: TASK } })
  })

  it('a delete answered 404 is done: the row is gone already', async () => {
    await expect(useMain().deleteTask(TASK)).resolves.toEqual({ ok: true, value: undefined })
  })

  // R3': why it failed, and what the route answers for it (a gateway's statuses: the source refusing the app's key is the server's to fix).
  it.each([[401, 'unauthorized', 502], [429, 'rate_limited', 503], [500, 'unavailable', 503], [422, 'remote_failed', 502]])(
    'any other failure is the source\'s error, naming the source and what it answered: %i is %s, the route answers %i', async (status, type, answered) => {
      await expect(useMain().completeTask(`6f1c2d3e-4b5a-4c6d-8e7f-000000000${status}`)).resolves.toEqual({
        // R3'b: a source that asks to wait says for how long.
        ok: false, error: { type, message: `The "api" data source answered ${status}.`, status, ...(status === 429 ? { retryAfter: 3 } : {}) }
      })
      expect(statusOf[type]).toBe(answered)
    })

  it('does not follow a redirect: the key never reaches another host', async () => {
    elsewhere.length = 0
    await expect(useMain().completeTask('6f1c2d3e-4b5a-4c6d-8e7f-000000000302')).resolves.toEqual({
      ok: false, error: { type: 'remote_failed', message: 'The "api" data source answered 302: a redirect is not followed.', status: 302 }
    })
    expect(elsewhere).toEqual([])
  })

  // Verify T3a advisory: a hand-written REST path may hold its own query string, or characters the URL encodes; the client sends them.
  it.each([
    ['/posts?userId=1', '/v1/posts?userId=1'],
    ['/artículos', '/v1/art%C3%ADculos'],
    ['/a b', '/v1/a%20b']
  ])('calls a path %j as it is written', async (path, url) => {
    seen.length = 0
    await call(path, { method: 'GET' })
    expect(seen.map(entry => entry.url)).toEqual([url])
  })
})
