import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const CSP = 'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\' data:; connect-src \'self\'; frame-src \'self\'; frame-ancestors \'self\''
const SHELL = '<!doctype html><html><head><script type="module" src="/__bildr/_assets/index-abc.js"></script></head><body><div id="app"></div></body></html>'
let root: string
let dir: string
let dist: string
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-assets-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  dist = join(root, 'dist')
  mkdirSync(join(dist, '_assets'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), SHELL)
  writeFileSync(join(dist, 'secret.txt'), 'inside dist, outside _assets')
  writeFileSync(join(root, 'outside.js'), 'outside')
  handle = createBildrHandler({ root: dir, token: TOKEN, editorDist: dist })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const request = (path: string, init: { token?: string | false, cookie?: string } = {}, target = handle) => {
  const { token = false, cookie } = init
  const headers = new Headers({ host: 'localhost:3000' })
  if (token) headers.set('x-bildr-token', token)
  if (cookie) headers.set('cookie', cookie)
  return target(new Request(`http://localhost:3000${path}`, { headers }), { remoteAddress: '127.0.0.1' })
}
const cookie = `bildr_token=${TOKEN}`

// T10a (D12): the module serves the prebuilt @bildr/editor SPA under a strict CSP.
describe('editor shell', () => {
  it('opens with ?token=: sets the cookie and serves dist/index.html with the CSP', async () => {
    const response = await request(`/__bildr?token=${TOKEN}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('set-cookie')).toMatch(/^bildr_token=a+; Path=\/__bildr; HttpOnly; SameSite=Strict/)
    expect(response.headers.get('content-security-policy')).toBe(CSP)
    expect(await response.text()).toBe(SHELL)
  })

  it('serves the same shell with the CSP to the cookie', async () => {
    for (const path of ['/__bildr', '/__bildr/']) {
      const response = await request(path, { cookie })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toBe(CSP)
      expect(await response.text()).toBe(SHELL)
    }
    expect((await request('/__bildr')).status).toBe(401)
  })

  it('keeps the placeholder page, with a CSP and a build hint, when dist/ is missing', async () => {
    const bare = createBildrHandler({ root: dir, token: TOKEN, editorDist: join(root, 'nope') })
    for (const response of [await request(`/__bildr?token=${TOKEN}`, {}, bare), await request('/__bildr', { cookie }, bare)]) {
      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toMatch(/frame-ancestors 'self'/)
      const html = await response.text()
      expect(html).toContain('/__bildr/api/model')
      expect(html).toContain('pnpm build:editor')
    }
  })
})

describe('editor assets', () => {
  const files: [string, string][] = [
    ['index-abc.js', 'text/javascript; charset=utf-8'],
    ['index-abc.css', 'text/css; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['inter.woff2', 'font/woff2'],
    ['shot.png', 'image/png'],
    ['icons.json', 'application/json; charset=utf-8'],
    ['index-abc.js.map', 'application/json; charset=utf-8']
  ]

  it('serves files from dist/_assets with their content type, behind the cookie', async () => {
    for (const [name, type] of files) {
      writeFileSync(join(dist, '_assets', name), `content of ${name}`)
      const response = await request(`/__bildr/_assets/${name}`, { cookie })
      expect(response.status, name).toBe(200)
      expect(response.headers.get('content-type'), name).toBe(type)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await response.text()).toBe(`content of ${name}`)
    }
    expect((await request('/__bildr/_assets/index-abc.js')).status).toBe(401)
    expect((await request('/__bildr/_assets/missing.js', { cookie })).status).toBe(404)
    expect((await request('/__bildr/_assets', { cookie })).status).toBe(404)
  })

  it('refuses traversal, encoded or not', async () => {
    for (const path of ['/__bildr/_assets/..%2fsecret.txt', '/__bildr/_assets/..%2F..%2Foutside.js', '/__bildr/_assets/%2e%2e/secret.txt', '/__bildr/_assets/..%5csecret.txt', '/__bildr/_assets/%2fetc%2fpasswd', '/__bildr/_assets/%E0%A4%A']) {
      const response = await request(path, { cookie })
      expect(response.status, path).toBe(404)
      expect(await response.text(), path).not.toMatch(/inside dist|outside/)
    }
  })

  it('refuses symlinks that point out of dist', async () => {
    symlinkSync(join(root, 'outside.js'), join(dist, '_assets/evil.js'))
    symlinkSync(root, join(dist, '_assets/up'))
    for (const path of ['/__bildr/_assets/evil.js', '/__bildr/_assets/up/outside.js']) {
      const response = await request(path, { cookie })
      expect(response.status, path).toBe(404)
      expect(await response.text()).not.toContain('outside')
    }
  })
})

describe('prefix', () => {
  it('answers only /__bildr and below: /__bildrfoo is 404', async () => {
    for (const path of ['/__bildrfoo', '/__bildrfoo/api/model', `/__bildrfoo?token=${TOKEN}`]) {
      // Not ours, so not even the token guard answers.
      expect((await request(path)).status, path).toBe(404)
      expect((await request(path, { cookie, token: TOKEN })).status, path).toBe(404)
    }
  })
})
