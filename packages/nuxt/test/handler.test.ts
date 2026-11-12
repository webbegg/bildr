import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
let root: string
let dir: string
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const request = (path: string, init: RequestInit & { token?: string | false, host?: string, remote?: string } = {}) => {
  const { token = TOKEN, host = 'localhost:3000', remote = '127.0.0.1', ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set('host', host)
  if (token) headers.set('x-bildr-token', token)
  return handle(new Request(`http://${host}${path}`, { ...rest, headers }), { remoteAddress: remote })
}
const pagePath = '.bildr/modules/main/pages/index.json'

describe('guard', () => {
  it('refuses requests without the session token', async () => {
    expect((await request('/__bildr/api/model', { token: false })).status).toBe(401)
    expect((await request('/__bildr/api/model', { token: 'b'.repeat(48) })).status).toBe(401)
  })

  it('refuses non-loopback clients and foreign Host headers (DNS rebinding)', async () => {
    expect((await request('/__bildr/api/model', { remote: '192.168.1.20' })).status).toBe(403)
    expect((await request('/__bildr/api/model', { host: 'evil.example:3000' })).status).toBe(403)
    expect((await request('/__bildr/api/model', { remote: '::1', host: '[::1]:3000' })).status).toBe(200)
    expect((await request('/__bildr/api/model', { remote: '::ffff:127.0.0.1', host: '127.0.0.1:3000' })).status).toBe(200)
  })

  it('refuses cross-origin writes', async () => {
    const response = await request(`/__bildr/api/file?path=${pagePath}`, {
      method: 'PUT', body: readFileSync(join(dir, pagePath), 'utf8'), headers: { 'content-type': 'application/json', 'origin': 'http://evil.example' }
    })
    expect(response.status).toBe(403)
  })

  it('opens the editor with ?token= once, then trusts the HttpOnly cookie', async () => {
    const open = await request(`/__bildr/?token=${TOKEN}`, { token: false })
    expect(open.status).toBe(200)
    const cookie = open.headers.get('set-cookie')!
    expect(cookie).toMatch(/^bildr_token=a+; Path=\/__bildr; HttpOnly; SameSite=Strict/)
    expect((await request('/__bildr/api/model', { token: false, headers: { cookie: cookie.split(';')[0]! } })).status).toBe(200)
    expect((await request('/__bildr/', { token: false })).status).toBe(401)
  })
})

describe('model API', () => {
  it('returns the loaded model', async () => {
    const response = await request('/__bildr/api/model')
    const body = await response.json() as { ok: boolean, model: { project: { name: string } } }
    expect(body.ok).toBe(true)
    expect(body.model.project.name).toBe('App')
  })

  it('writes a .bildr file only when the whole model stays valid', async () => {
    const page = JSON.parse(readFileSync(join(dir, pagePath), 'utf8'))
    page.seo.title = 'Changed'
    const ok = await request(`/__bildr/api/file?path=${pagePath}`, { method: 'PUT', body: JSON.stringify(page), headers: { 'content-type': 'application/json' } })
    expect(ok.status).toBe(200)
    expect(JSON.parse(readFileSync(join(dir, pagePath), 'utf8')).seo.title).toBe('Changed')
    // Written in canonical form.
    expect(readFileSync(join(dir, pagePath), 'utf8')).toMatch(/^\{\n {2}"id": "pg_index",/)

    page.layout = 'lay_nope'
    const bad = await request(`/__bildr/api/file?path=${pagePath}`, { method: 'PUT', body: JSON.stringify(page), headers: { 'content-type': 'application/json' } })
    expect(bad.status).toBe(422)
    expect(await bad.json()).toEqual({ ok: false, problems: [{ path: pagePath, message: 'layout: Unknown layout "lay_nope"' }] })
    expect(JSON.parse(readFileSync(join(dir, pagePath), 'utf8')).layout).toBe('lay_main')
  })

  it('only writes model files: never the manifest, the cache or anything outside .bildr/', async () => {
    for (const path of ['.bildr/manifest.json', '.bildr/.cache/health.json', 'nuxt.config.ts', '../x.json', '.bildr/../package.json', '.bildr/modules/main/notes/x.json']) {
      const response = await request(`/__bildr/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: '{}', headers: { 'content-type': 'application/json' } })
      expect(response.status, path).toBe(400)
    }
    expect(existsSync(join(root, 'x.json'))).toBe(false)
  })

  it('requires JSON and limits the body size', async () => {
    expect((await request(`/__bildr/api/file?path=${pagePath}`, { method: 'PUT', body: '{}', headers: { 'content-type': 'text/plain' } })).status).toBe(415)
    expect((await request(`/__bildr/api/file?path=${pagePath}`, { method: 'PUT', body: 'x'.repeat(3_000_000), headers: { 'content-type': 'application/json' } })).status).toBe(413)
  })
})

describe('drift API', () => {
  it('lists hand-edited generated files', async () => {
    writeFileSync(join(dir, 'layers/main/app/pages/index.vue'), 'mine')
    const body = await (await request('/__bildr/api/drift')).json()
    expect(body).toEqual({ detached: ['layers/main/app/pages/index.vue'], deleted: [], missingManifest: false })
  })
})

it('answers unknown routes with 404', async () => {
  expect((await request('/__bildr/api/nope')).status).toBe(404)
})
