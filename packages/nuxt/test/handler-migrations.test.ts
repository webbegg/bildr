import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { PENDING_FILE } from '../src/node/migrations'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
let root: string
let dir: string
let confirmed: string[]
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-migrations-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  confirmed = []
  handle = createBildrHandler({
    root: dir,
    token: TOKEN,
    confirmMigration: async (hash) => {
      confirmed.push(hash)
      return { kind: 'written', tag: '0001_bildr', statements: ['ALTER TABLE `t` DROP COLUMN `c`;'] }
    }
  })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const request = (path: string, init: RequestInit & { token?: string | false, origin?: string } = {}) => {
  const { token = TOKEN, origin = 'http://localhost:3000', ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set('host', 'localhost:3000')
  headers.set('origin', origin)
  if (token) headers.set('x-bildr-token', token)
  return handle(new Request(`http://localhost:3000${path}`, { ...rest, headers }), { remoteAddress: '127.0.0.1' })
}
const confirm = (body: unknown, init: { token?: string | false, origin?: string } = {}) =>
  request('/__bildr/api/migrations/confirm', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...init })

// T8: a destructive migration waits until the user confirms it in the editor.
describe('migrations API', () => {
  it('reports no pending migration, then the pending plan', async () => {
    expect(await (await request('/__bildr/api/migrations/pending')).json()).toEqual({ pending: null })
    const plan = { hash: 'h1', destructive: ['DROP TABLE `t`;'], statements: ['DROP TABLE `t`;'] }
    mkdirSync(join(dir, '.bildr/.cache'), { recursive: true })
    writeFileSync(join(dir, PENDING_FILE), JSON.stringify(plan))
    expect(await (await request('/__bildr/api/migrations/pending')).json()).toEqual({ pending: plan })
  })

  it('confirms with the plan hash through the regenerator', async () => {
    const response = await confirm({ hash: 'h1' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, migration: { kind: 'written', tag: '0001_bildr', statements: ['ALTER TABLE `t` DROP COLUMN `c`;'] } })
    expect(confirmed).toEqual(['h1'])
  })

  it('needs the session token and a same-origin request, and a hash', async () => {
    expect((await confirm({ hash: 'h1' }, { token: false })).status).toBe(401)
    expect((await confirm({ hash: 'h1' }, { origin: 'http://evil.example' })).status).toBe(403)
    expect((await confirm({})).status).toBe(400)
    expect((await confirm({ hash: 42 })).status).toBe(400)
    expect(confirmed).toEqual([])
  })
})
