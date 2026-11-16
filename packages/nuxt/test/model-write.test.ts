import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { deleteModelFile, saveModelFile } from '../src/node/editor-io'

/**
 * The write rule of `saveModelFile` and `deleteModelFile` is strict: a change is accepted only when the model is valid
 * after it. Otherwise it is refused (`json` for text that is not JSON, else `invalid`, with the problems the model would
 * have) and nothing changes, whatever state the model is in now.
 */

const INDEX = '.bildr/modules/main/pages/index.json'
const ABOUT = '.bildr/modules/main/pages/about.json'
const CONTACT = '.bildr/modules/main/pages/contact.json'
const LAYOUT = '.bildr/layouts/main.json'
let root: string
let dir: string

const read = (path: string) => readFileSync(join(dir, path), 'utf8')
const json = (path: string) => JSON.parse(read(path)) as { id: string, layout: string, seo: { title: string } } & Record<string, unknown>
/** Puts text on disk as it is, valid or not: the state a hand edit or an agent leaves. */
const disk = (path: string, content: unknown) => writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
const pageLike = (name: string) => ({ ...json(INDEX), id: `pg_${name}`, name, path: `/${name}` })
const noLayout = (name: string) => ({ ...pageLike(name), layout: 'lay_nope' })
const save = (path: string, content: unknown) => saveModelFile(dir, path, typeof content === 'string' ? content : JSON.stringify(content))
const problemPaths = (outcome: { problems?: Array<{ path: string }> }) => (outcome.problems ?? []).map(problem => problem.path)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-model-write-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  disk(ABOUT, pageLike('about'))
  disk(CONTACT, pageLike('contact'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('a valid model', () => {
  it('takes a write that keeps it valid, with no problems to report', () => {
    const outcome = save(ABOUT, { ...pageLike('about'), seo: { title: 'About' } })
    expect(outcome).toMatchObject({ ok: true })
    expect(outcome).not.toHaveProperty('problems')
    expect(json(ABOUT).seo.title).toBe('About')
  })

  it('writes the file in its canonical form', () => {
    save(ABOUT, JSON.stringify(pageLike('about')))
    expect(read(ABOUT)).toMatch(/^\{\n {2}"id": "pg_about",/)
  })

  it('refuses a write that breaks it, with the problems, and writes nothing', () => {
    const before = read(ABOUT)
    const outcome = save(ABOUT, noLayout('about'))
    expect(outcome).toEqual({ ok: false, reason: 'invalid', problems: [{ path: ABOUT, message: 'layout: Unknown layout "lay_nope"' }] })
    expect(read(ABOUT)).toBe(before)
  })

  it('refuses a write that breaks another file (a layout the pages use)', () => {
    const outcome = save(LAYOUT, { ...json(LAYOUT), id: 'lay_other' })
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid' })
    expect(json(LAYOUT).id).toBe('lay_main')
  })

  it('refuses a file that is not JSON', () => {
    expect(save(ABOUT, '{ "id": ')).toEqual({ ok: false, reason: 'json', message: 'Invalid JSON' })
  })
})

describe('a model with problems', () => {
  it('refuses the fix of one of two broken files while the other stays broken, and names the other\'s problem', () => {
    disk(ABOUT, noLayout('about'))
    disk(CONTACT, noLayout('contact'))
    const outcome = save(ABOUT, pageLike('about'))
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid', problems: [{ path: CONTACT, message: 'layout: Unknown layout "lay_nope"' }] })
    expect(json(ABOUT).layout).toBe('lay_nope')
  })

  it('takes the fix that makes the model valid, and then reports no problems', () => {
    disk(ABOUT, noLayout('about'))
    const outcome = save(ABOUT, pageLike('about'))
    expect(outcome).toMatchObject({ ok: true })
    expect(outcome).not.toHaveProperty('problems')
    expect(json(ABOUT).layout).toBe('lay_main')
  })

  it('refuses a write whose own file still has problems, and writes nothing', () => {
    disk(CONTACT, noLayout('contact'))
    const before = read(ABOUT)
    const outcome = save(ABOUT, { ...pageLike('about'), name: 5 })
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid' })
    expect(problemPaths(outcome as { problems: Array<{ path: string }> })).toContain(ABOUT)
    expect(read(ABOUT)).toBe(before)
  })

  it('refuses a file that still has a problem of its own even when it was the broken one', () => {
    disk(ABOUT, noLayout('about'))
    const outcome = save(ABOUT, noLayout('about'))
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid', problems: [{ path: ABOUT, message: 'layout: Unknown layout "lay_nope"' }] })
  })

  it('refuses a write that adds a problem to another file, even though the model had problems already', () => {
    disk(CONTACT, noLayout('contact'))
    const before = read(LAYOUT)
    const outcome = save(LAYOUT, { ...json(LAYOUT), id: 'lay_other' })
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid' })
    expect(problemPaths(outcome as { problems: Array<{ path: string }> })).toEqual(expect.arrayContaining([INDEX, ABOUT]))
    expect(read(LAYOUT)).toBe(before)
  })

  it('refuses text that is not JSON, and writes nothing', () => {
    disk(CONTACT, noLayout('contact'))
    const before = read(ABOUT)
    expect(save(ABOUT, '{ "id": ')).toEqual({ ok: false, reason: 'json', message: 'Invalid JSON' })
    expect(read(ABOUT)).toBe(before)
  })

  it('refuses a file while the project file is not JSON, but takes the project file\'s fix', () => {
    const project = json('.bildr/bildr.json')
    disk('.bildr/bildr.json', '{ nope')
    expect(save(ABOUT, pageLike('about'))).toMatchObject({ ok: false, reason: 'invalid' })
    expect(save('.bildr/bildr.json', project)).toMatchObject({ ok: true })
  })

  it('refuses a dangling reference or a duplicate id in the file written while another file has a schema problem', () => {
    disk(CONTACT, { ...pageLike('contact'), name: 5 })
    const before = read(ABOUT)
    expect(save(ABOUT, { ...pageLike('about'), layout: 'lay_nope' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(save(ABOUT, { ...pageLike('about'), id: 'pg_index' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(read(ABOUT)).toBe(before)
  })

  it('refuses any file whose schema fails while an unknown JSON file is in .bildr/', () => {
    disk('.bildr/notes.json', { hi: 1 })
    const before = read(ABOUT)
    expect(save(ABOUT, { totally: 'garbage' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(save('.bildr/bildr.json', { schemaVersion: 99 })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(read(ABOUT)).toBe(before)
  })

  it('refuses a file while the project file parses but does not load (not an object, or a newer schemaVersion)', () => {
    const project = json('.bildr/bildr.json')
    for (const broken of ['[]', JSON.stringify({ ...project, schemaVersion: 99 })]) {
      disk('.bildr/bildr.json', broken)
      expect(save(ABOUT, { totally: 'garbage' })).toMatchObject({ ok: false, reason: 'invalid' })
    }
    expect(json(ABOUT).id).toBe('pg_about')
  })
})

describe('an invalid model takes no write that leaves it invalid', () => {
  it('refuses a broken write over a file that is not JSON while another file is not JSON either', () => {
    disk(ABOUT, '{ nope')
    disk(CONTACT, '{ nope')
    for (const content of [{ totally: 'garbage' }, noLayout('about'), { ...pageLike('about'), id: 'pg_index' }]) {
      expect(save(ABOUT, content)).toMatchObject({ ok: false, reason: 'invalid' })
      expect(read(ABOUT)).toBe('{ nope')
    }
  })

  it('refuses a broken write over a file that is not JSON while a stray file is in .bildr/', () => {
    disk(ABOUT, '{ nope')
    disk('.bildr/notes.json', { hi: 1 })
    expect(save(ABOUT, { totally: 'garbage' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(read(ABOUT)).toBe('{ nope')
  })

  it('refuses a project file that does not load while another file is not JSON', () => {
    const project = json('.bildr/bildr.json')
    for (const broken of [{ garbage: true }, { ...project, schemaVersion: 99 }, '[]']) {
      disk('.bildr/bildr.json', '{ nope')
      disk(CONTACT, '{ nope')
      expect(save('.bildr/bildr.json', broken)).toMatchObject({ ok: false, reason: 'invalid' })
      expect(read('.bildr/bildr.json')).toBe('{ nope')
    }
  })

  it('refuses deleting a layout the pages use that is not JSON, whether or not another file is not JSON', () => {
    const truncated = read(LAYOUT).slice(0, 40)
    disk(LAYOUT, truncated)
    disk(CONTACT, '{ nope')
    expect(deleteModelFile(dir, LAYOUT)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(read(LAYOUT)).toBe(truncated)
  })

  it('takes the fix that makes the model valid', () => {
    const project = json('.bildr/bildr.json')
    disk('.bildr/bildr.json', '{ nope')
    expect(save('.bildr/bildr.json', project)).toMatchObject({ ok: true })
  })
})

describe('deleting from a model', () => {
  it('refuses a delete that breaks a valid model: the rest must stay valid', () => {
    expect(deleteModelFile(dir, LAYOUT)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(existsSync(join(dir, LAYOUT))).toBe(true)
  })

  it('takes the delete of a broken file when the rest is valid, and of a stray file that is the only problem', () => {
    disk(ABOUT, '{ "id": ')
    const outcome = deleteModelFile(dir, ABOUT)
    expect(outcome).toEqual({ ok: true })
    expect(existsSync(join(dir, ABOUT))).toBe(false)
    disk('.bildr/notes.json', { hi: 1 })
    expect(deleteModelFile(dir, '.bildr/notes.json')).toEqual({ ok: true })
    expect(existsSync(join(dir, '.bildr/notes.json'))).toBe(false)
  })

  it('refuses the delete of a broken file while another is broken', () => {
    disk(ABOUT, '{ "id": ')
    disk(CONTACT, noLayout('contact'))
    expect(deleteModelFile(dir, ABOUT)).toMatchObject({ ok: false, reason: 'invalid', problems: [{ path: CONTACT }] })
    expect(existsSync(join(dir, ABOUT))).toBe(true)
  })

  it('refuses deleting a layout the pages use while another file has a schema problem', () => {
    disk(CONTACT, { ...pageLike('contact'), name: 5 })
    expect(deleteModelFile(dir, LAYOUT)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(existsSync(join(dir, LAYOUT))).toBe(true)
  })

  it('refuses a delete that adds a problem to another file', () => {
    disk(CONTACT, noLayout('contact'))
    expect(deleteModelFile(dir, LAYOUT)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(existsSync(join(dir, LAYOUT))).toBe(true)
  })
})
