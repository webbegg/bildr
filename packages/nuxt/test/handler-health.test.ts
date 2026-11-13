import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { updateHealth } from '../src/node/health'
import type { CheckName, CheckResult } from '../src/node/health'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
let root: string
let dir: string
let asked: CheckName[][]
let handle: ReturnType<typeof createBildrHandler>

const result = (name: CheckName): CheckResult => ({ name, ok: true, startedAt: '2026-11-13T10:00:00.000Z', durationMs: 5, summary: 'fine', findings: [] })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-health-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  asked = []
  handle = createBildrHandler({
    root: dir,
    token: TOKEN,
    runHealth: async (checks) => {
      asked.push(checks)
      return checks.map(result)
    }
  })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const request = (path: string, init: RequestInit & { token?: string | false, origin?: string } = {}, target = handle) => {
  const { token = TOKEN, origin = 'http://localhost:3000', ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set('host', 'localhost:3000')
  headers.set('origin', origin)
  if (token) headers.set('x-bildr-token', token)
  return target(new Request(`http://localhost:3000${path}`, { ...rest, headers }), { remoteAddress: '127.0.0.1' })
}
const run = (body: unknown, init: { token?: string | false, origin?: string } = {}, target = handle) =>
  request('/__bildr/api/health/run', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...init }, target)

// T9c (S6, RA §7): the editor reads the Health report and runs checks on demand.
describe('health API', () => {
  it('returns the stored report (an empty one before any)', async () => {
    expect(await (await request('/__bildr/api/health')).json()).toEqual({ updatedAt: '', checks: {} })
    const stored = updateHealth(dir, { migration: null, checks: { lint: result('lint') } })
    const response = await request('/__bildr/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(stored)
  })

  it('runs the requested checks through the module and returns their results', async () => {
    const response = await run({ checks: ['lint', 'types'] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, results: [result('lint'), result('types')] })
    expect(asked).toEqual([['lint', 'types']])
  })

  it('needs the session token, and a same-origin request to run checks', async () => {
    expect((await request('/__bildr/api/health', { token: false })).status).toBe(401)
    expect((await run({ checks: ['lint'] }, { token: false })).status).toBe(401)
    expect((await run({ checks: ['lint'] }, { origin: 'http://evil.example' })).status).toBe(403)
    expect(asked).toEqual([])
  })

  it('refuses bad JSON, and empty, unknown or repeated checks', async () => {
    for (const body of ['{ not json', {}, { checks: [] }, { checks: 'lint' }, { checks: ['lint', 'format'] }, { checks: ['lint', 'lint'] }, { checks: [1] }, null]) {
      const response = await run(body as unknown)
      expect(response.status).toBe(400)
      expect((await response.json()).message).toEqual(expect.any(String))
    }
    expect((await (await run({ checks: ['lint', 'lint'] })).json()).message).toMatch(/more than once/)
    expect((await (await run({ checks: ['format'] })).json()).message).toMatch(/format/)
    expect(asked).toEqual([])
  })

  it('says checks can\'t run when the module gave no runner', async () => {
    const bare = createBildrHandler({ root: dir, token: TOKEN })
    const response = await run({ checks: ['lint'] }, {}, bare)
    expect(response.status).toBe(501)
    expect((await response.json()).ok).toBe(false)
  })
})
