import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editorSession, SESSION_FILE, sessionOwner } from '../src/node/session'

let base: string
let root: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bildr-session-'))
  root = join(base, 'app')
  mkdirSync(join(root, '.bildr'), { recursive: true })
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const TOKEN = /^[0-9a-f]{48}$/
const stored = () => JSON.parse(readFileSync(join(root, SESSION_FILE), 'utf8')) as { owner: number, token: string }

describe('sessionOwner', () => {
  it('is nuxi\'s supervisor in a dev fork (it restarts Nuxt in a new fork) and this process otherwise', () => {
    expect(sessionOwner({ __NUXT__FORK: 'true' }, 200, 100)).toBe(100)
    expect(sessionOwner({}, 100, 50)).toBe(100)
    // An orphaned fork (its parent gone) is a session of its own.
    expect(sessionOwner({ __NUXT__FORK: 'true' }, 200, 1)).toBe(200)
  })
})

describe('editorSession (one editor token per nuxt dev session)', () => {
  it('mints a 48-hex token and stores it with its owner, readable by the user only', () => {
    const session = editorSession(root, { owner: 100 })
    expect(session.token).toMatch(TOKEN)
    expect(session.reused).toBe(false)
    expect(session.warning).toBeUndefined()
    expect(stored()).toEqual({ owner: 100, token: session.token })
    expect(statSync(join(root, SESSION_FILE)).mode & 0o777).toBe(0o600)
  })

  it('reuses the token for the same owner (a Nuxt restart) and mints a new one for another (a new nuxt dev)', () => {
    const first = editorSession(root, { owner: 100 })
    const restarted = editorSession(root, { owner: 100 })
    expect(restarted).toEqual({ token: first.token, reused: true })
    const next = editorSession(root, { owner: 101 })
    expect(next.reused).toBe(false)
    expect(next.token).not.toBe(first.token)
    expect(stored()).toEqual({ owner: 101, token: next.token })
    expect(statSync(join(root, SESSION_FILE)).mode & 0o777).toBe(0o600)
  })

  it('ignores a garbage or malformed session file and replaces it', () => {
    mkdirSync(join(root, '.bildr/.cache'))
    for (const content of ['not json', '{"owner":100}', '{"owner":100,"token":"short"}', `{"owner":"100","token":"${'a'.repeat(48)}"}`, `{"owner":100,"token":"${'G'.repeat(48)}"}`, 'null']) {
      writeFileSync(join(root, SESSION_FILE), content)
      const session = editorSession(root, { owner: 100 })
      expect(session.reused, content).toBe(false)
      expect(session.token).toMatch(TOKEN)
      expect(stored()).toEqual({ owner: 100, token: session.token })
    }
  })

  it('never takes a token from a symlinked session file, and replaces the link instead of writing through it', () => {
    mkdirSync(join(root, '.bildr/.cache'))
    const planted = join(base, 'planted.json')
    const plantedContent = JSON.stringify({ owner: 100, token: 'b'.repeat(48) })
    writeFileSync(planted, plantedContent)
    symlinkSync(planted, join(root, SESSION_FILE))
    const session = editorSession(root, { owner: 100 })
    expect(session.reused).toBe(false)
    expect(session.token).not.toBe('b'.repeat(48))
    expect(readFileSync(planted, 'utf8')).toBe(plantedContent)
    expect(stored()).toEqual({ owner: 100, token: session.token })
  })

  it('never reads or writes outside the project: a symlinked .cache gets an in-memory token and a warning', () => {
    const outside = join(base, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'editor-session.json'), JSON.stringify({ owner: 100, token: 'c'.repeat(48) }))
    symlinkSync(outside, join(root, '.bildr/.cache'), 'dir')
    const session = editorSession(root, { owner: 100 })
    expect(session.reused).toBe(false)
    expect(session.token).toMatch(TOKEN)
    expect(session.token).not.toBe('c'.repeat(48))
    expect(session.warning).toMatch(/outside the project/)
    expect(JSON.parse(readFileSync(join(outside, 'editor-session.json'), 'utf8')).token).toBe('c'.repeat(48))
  })

  it('falls back to an in-memory token with a warning when the file can\'t be written', () => {
    // A folder where the file should be: the rename fails.
    mkdirSync(join(root, SESSION_FILE), { recursive: true })
    const session = editorSession(root, { owner: 100 })
    expect(session.token).toMatch(TOKEN)
    expect(session.reused).toBe(false)
    expect(session.warning).toMatch(/editor session/)
    expect(existsSync(join(root, `${SESSION_FILE}.tmp`))).toBe(false)
  })
})
