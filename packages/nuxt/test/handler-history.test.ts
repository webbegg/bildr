// P3b (V2, V6): undo/redo of the module actions as file-level change sets in .bildr/.cache.
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { HISTORY_FILE, REDO_FILE, readHistory, recordStep, stepOf } from '../src/node/history'
import { sha256 } from '../src/node/sync'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const pagePath = '.bildr/modules/main/pages/index.json'
let root: string
let dir: string
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-history-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const act = (name: string, body: unknown = {}) => handle(new Request(`http://localhost:3000/__bildr/api/actions/${name}`, {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000', 'x-bildr-token': TOKEN, 'content-type': 'application/json' }
}), { remoteAddress: '127.0.0.1' })
const ok = async (name: string, body: unknown = {}): Promise<Json> => {
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, result?: Json }
  expect(json.ok, `${name}: ${JSON.stringify(json)}`).toBe(true)
  return json.result!
}
const failure = async (name: string, body: unknown, status: number, code: string) => {
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, code: string, message: string, problems?: unknown }
  expect(response.status, JSON.stringify(json)).toBe(status)
  expect(json.code).toBe(code)
  return json
}
const read = (path: string) => readFileSync(join(dir, path), 'utf8')

/** Every file under the project except node_modules, with its content: what an undo may touch. */
const snapshot = (base = dir): Record<string, string> => {
  const out: Record<string, string> = {}
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[path.slice(base.length + 1)] = readFileSync(path, 'utf8')
    }
  }
  walk(base)
  return out
}

describe('history', () => {
  it('records each edit as one step, undoes and redoes it through the model files', async () => {
    const before = read(pagePath)
    await ok('node_insert', { file: 'pg_index', type: 'Text', props: { text: 'Hello' } })
    const after = read(pagePath)

    const history = await ok('history_get')
    expect(history.undo).toEqual([{ id: expect.any(String), action: 'node_insert', time: expect.any(String), files: [pagePath] }])
    expect(history.redo).toEqual([])
    expect(JSON.stringify(history)).not.toContain('Hello')

    expect(await ok('history_undo')).toMatchObject({ action: 'node_insert', files: [pagePath] })
    expect(read(pagePath)).toBe(before)
    expect((await ok('history_get')).redo).toMatchObject([{ action: 'node_insert' }])

    expect(await ok('history_redo')).toMatchObject({ action: 'node_insert', files: [pagePath] })
    expect(read(pagePath)).toBe(after)
    expect(await ok('history_get')).toMatchObject({ undo: [{ action: 'node_insert' }], redo: [] })
  })

  it('undoes a created file by deleting it, and model_file_put/delete are steps too', async () => {
    const created = await ok('page_create', { name: 'About' })
    await ok('history_undo')
    expect(existsSync(join(dir, created.filePath as string))).toBe(false)

    const project = JSON.parse(read('.bildr/bildr.json')) as Json
    const original = read('.bildr/bildr.json')
    await ok('model_file_put', { path: '.bildr/bildr.json', content: { ...project, name: 'Renamed' } })
    expect((await ok('history_get')).undo[0]).toMatchObject({ action: 'model_file_put', files: ['.bildr/bildr.json'] })
    await ok('history_undo')
    expect(read('.bildr/bildr.json')).toBe(original)

    await ok('page_create', { name: 'Contact' })
    const contact = read('.bildr/modules/main/pages/contact.json')
    await ok('model_file_delete', { path: '.bildr/modules/main/pages/contact.json' })
    expect((await ok('history_get')).undo[0]).toMatchObject({ action: 'model_file_delete' })
    await ok('history_undo')
    expect(read('.bildr/modules/main/pages/contact.json')).toBe(contact)
  })

  it('lets a new edit clear the redo stack', async () => {
    await ok('node_insert', { file: 'pg_index', type: 'Text' })
    await ok('history_undo')
    expect((await ok('history_get')).redo).toHaveLength(1)
    await ok('node_insert', { file: 'pg_index', type: 'Button' })
    expect((await ok('history_get')).redo).toEqual([])
    await failure('history_redo', {}, 404, 'not_found')
  })

  it('refuses with 409 conflict when a file changed since the step (a hand edit), and changes nothing', async () => {
    await ok('node_insert', { file: 'pg_index', type: 'Text' })
    const edited = read(pagePath).replace('"Text"', '"Text" ')
    writeFileSync(join(dir, pagePath), edited)
    const refused = await failure('history_undo', {}, 409, 'conflict')
    expect(refused.message).toBe(`${pagePath} changed since node_insert (edited outside the editor's history): nothing was undone`)
    expect(read(pagePath)).toBe(edited)
    expect((await ok('history_get')).undo).toHaveLength(1)

    // Redo checks the files against the step's before state the same way.
    writeFileSync(join(dir, pagePath), JSON.stringify(JSON.parse(edited), null, 2) + '\n')
    const undoable = await ok('node_insert', { file: 'pg_index', type: 'Button' })
    expect(undoable.changed).toEqual([pagePath])
    await ok('history_undo')
    writeFileSync(join(dir, pagePath), read(pagePath).replace('"Page"', '"Page" '))
    const redo = await failure('history_redo', {}, 409, 'conflict')
    expect(redo.message).toBe(`${pagePath} changed since node_insert was undone (edited outside the editor's history): nothing was redone`)
  })

  it('refuses an undo after which the model would no longer generate, with the problems', async () => {
    const current = read(pagePath)
    const broken = current.replace('"text": "Welcome to App"', '"text": { "$bind": "nothing.here" }')
    expect(broken).not.toBe(current)
    recordStep(dir, stepOf('model_file_put', { [pagePath]: broken }, [{ path: pagePath, content: current }]))
    const refused = await failure('history_undo', {}, 422, 'invalid')
    expect(refused.message).toMatch(/^The undo would leave a model the generator can't build: /)
    expect(refused.problems).toEqual([{ path: pagePath, message: expect.stringContaining('"nothing.here" doesn\'t refer to anything') }])
    expect(read(pagePath)).toBe(current)
  })

  it('writes nothing outside .bildr/.cache besides the files of the step', async () => {
    await ok('node_insert', { file: 'pg_index', type: 'Text' })
    const before = snapshot()
    await ok('history_undo')
    const after = snapshot()
    const changed = Object.keys({ ...before, ...after }).filter(path => before[path] !== after[path]).sort()
    expect(changed.filter(path => !path.startsWith('.bildr/.cache/'))).toEqual([pagePath])
    expect(changed.filter(path => path.startsWith('.bildr/.cache/')).sort()).toEqual([HISTORY_FILE, REDO_FILE].sort())
  })

  it('refuses edits and undo, writing nothing, when .bildr/.cache leaves the project (symlink)', async () => {
    mkdirSync(join(root, 'outside'))
    rmSync(join(dir, '.bildr/.cache'), { recursive: true, force: true })
    symlinkSync(join(root, 'outside'), join(dir, '.bildr/.cache'))
    const before = read(pagePath)
    const refused = await failure('node_insert', { file: 'pg_index', type: 'Text' }, 403, 'forbidden')
    expect(refused.message).toContain('.bildr/.cache resolves outside the project')
    expect(read(pagePath)).toBe(before)
    expect(readdirSync(join(root, 'outside'))).toEqual([])
    await failure('history_undo', {}, 403, 'forbidden')
  })

  // Every accepted model change is undoable: a history that can't be written undoes the model write.
  const asRoot = process.getuid?.() === 0
  const cache = () => join(dir, '.bildr/.cache')

  it.skipIf(asRoot)('an undo/redo whose history write fails changes no model file', async () => {
    await ok('node_insert', { file: 'pg_index', type: 'Text' })
    await ok('history_undo')
    const before = read(pagePath)
    chmodSync(cache(), 0o555)
    try {
      const refused = await failure('history_redo', {}, 500, 'write_failed')
      expect(refused.message).toContain(REDO_FILE)
      expect(read(pagePath)).toBe(before)
    } finally {
      chmodSync(cache(), 0o755)
    }
    expect(await ok('history_get')).toMatchObject({ undo: [], redo: [{ action: 'node_insert' }] })
    await ok('history_redo')
    await ok('history_undo')
    expect(read(pagePath)).toBe(before)
  })

  it.skipIf(asRoot)('an undo whose history write fails changes no model file', async () => {
    await ok('node_insert', { file: 'pg_index', type: 'Text' })
    const before = read(pagePath)
    chmodSync(cache(), 0o555)
    try {
      await failure('history_undo', {}, 500, 'write_failed')
      expect(read(pagePath)).toBe(before)
    } finally {
      chmodSync(cache(), 0o755)
    }
    expect((await ok('history_get')).undo).toMatchObject([{ action: 'node_insert' }])
  })

  it.skipIf(asRoot)('an edit whose history write fails is not kept: 500, no file, the redo stack intact', async () => {
    await ok('node_insert', { file: 'pg_index', type: 'Text' })
    await ok('history_undo')
    chmodSync(cache(), 0o555)
    try {
      const refused = await failure('page_create', { name: 'About' }, 500, 'write_failed')
      expect(refused.message).toContain(HISTORY_FILE)
      expect(existsSync(join(dir, '.bildr/modules/main/pages/about.json'))).toBe(false)
      const project = JSON.parse(read('.bildr/bildr.json')) as Json
      const original = read('.bildr/bildr.json')
      await failure('model_file_put', { path: '.bildr/bildr.json', content: { ...project, name: 'Renamed' } }, 500, 'write_failed')
      expect(read('.bildr/bildr.json')).toBe(original)
    } finally {
      chmodSync(cache(), 0o755)
    }
    expect(await ok('history_get')).toMatchObject({ undo: [], redo: [{ action: 'node_insert' }] })
  })

  it('refuses a tampered step whose path is not a model file (__proto__), writing nothing', async () => {
    recordStep(dir, stepOf('model_file_put', {}, [{ path: '__proto__', content: 'x' }]))
    const before = snapshot()
    const refused = await failure('history_undo', {}, 403, 'forbidden')
    expect(refused.message).toContain('__proto__')
    expect(snapshot()).toEqual(before)
  })

  it('answers history_get and undo with the same code when history.jsonl is a folder', async () => {
    mkdirSync(join(dir, HISTORY_FILE), { recursive: true })
    await failure('history_get', {}, 403, 'forbidden')
    await failure('history_undo', {}, 403, 'forbidden')
  })
})

describe('history storage', () => {
  it('keeps at most the cap of steps, oldest dropped first', () => {
    for (let n = 1; n <= 5; n++) recordStep(dir, stepOf(`edit_${n}`, {}, [{ path: pagePath, content: `{"n":${n}}\n` }]), 3)
    expect(readHistory(dir).undo.map(step => step.action)).toEqual(['edit_3', 'edit_4', 'edit_5'])
    expect(read(HISTORY_FILE).trim().split('\n')).toHaveLength(3)
  })

  it('stores the before and after content with the after sha, one JSON line per step', () => {
    const step = stepOf('node_insert', { [pagePath]: 'old' }, [{ path: pagePath, content: 'new' }, { path: '.bildr/layouts/x.json', content: null }])
    expect(step.changes).toEqual([
      { path: pagePath, before: 'old', after: 'new', afterSha: sha256('new') },
      { path: '.bildr/layouts/x.json', before: null, after: null, afterSha: null }
    ])
    recordStep(dir, step)
    expect(JSON.parse(read(HISTORY_FILE).trim())).toEqual(step)
  })

  it('skips lines it can\'t read', () => {
    recordStep(dir, stepOf('a', {}, [{ path: pagePath, content: 'x' }]))
    writeFileSync(join(dir, HISTORY_FILE), read(HISTORY_FILE) + 'not json\n{"id":1}\n')
    expect(readHistory(dir).undo.map(step => step.action)).toEqual(['a'])
  })
})
