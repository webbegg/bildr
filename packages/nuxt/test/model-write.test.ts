import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { deleteModelFile, saveModelFile } from '../src/node/editor-io'

/**
 * The write rule of `saveModelFile` and `deleteModelFile`:
 * - a valid model stays valid;
 * - a model that already has problems takes a write that is itself sound (it parses, and the file has no problem of its
 *   own) and adds no problem to any other file, and says the problems that remain, so two broken files can be fixed one
 *   after the other.
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
  it('takes the fix of one of two broken files, and reports the other\'s problem', () => {
    disk(ABOUT, noLayout('about'))
    disk(CONTACT, noLayout('contact'))
    const outcome = save(ABOUT, pageLike('about'))
    expect(outcome).toMatchObject({ ok: true, problems: [{ path: CONTACT, message: 'layout: Unknown layout "lay_nope"' }] })
    expect(json(ABOUT).layout).toBe('lay_main')
    // The last one fixes the model: nothing remains.
    const last = save(CONTACT, pageLike('contact'))
    expect(last).toMatchObject({ ok: true })
    expect(last).not.toHaveProperty('problems')
  })

  it('takes the fix of a file that is not JSON while another is not JSON either', () => {
    disk(ABOUT, '{ "id": ')
    disk(CONTACT, '{ nope')
    const outcome = save(ABOUT, pageLike('about'))
    expect(outcome).toMatchObject({ ok: true })
    expect(problemPaths(outcome)).toEqual([CONTACT])
    expect(json(ABOUT).id).toBe('pg_about')
  })

  it('takes the fix of a file that is not JSON while another has a schema problem, and the other way round', () => {
    disk(ABOUT, '{ "id": ')
    disk(CONTACT, { ...pageLike('contact'), name: 5 })
    const first = save(ABOUT, pageLike('about'))
    expect(first).toMatchObject({ ok: true })
    expect(problemPaths(first)).toEqual([CONTACT])
    disk(ABOUT, { ...pageLike('about'), name: 5 })
    disk(CONTACT, '{ nope')
    const second = save(CONTACT, pageLike('contact'))
    expect(second).toMatchObject({ ok: true })
    expect(problemPaths(second)).toEqual([ABOUT])
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

  it('cannot tell a file is sound while the project file is not JSON, so it refuses the file but takes the project file\'s fix', () => {
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

  it('cannot judge a file while the project file parses but does not load (not an object, or a newer schemaVersion)', () => {
    const project = json('.bildr/bildr.json')
    for (const broken of ['[]', JSON.stringify({ ...project, schemaVersion: 99 })]) {
      disk('.bildr/bildr.json', broken)
      expect(save(ABOUT, { totally: 'garbage' })).toMatchObject({ ok: false, reason: 'invalid' })
    }
    expect(json(ABOUT).id).toBe('pg_about')
  })

  it('takes the fixes of a schema problem and a dangling reference in either order, when each fix is clean', () => {
    const broken = () => {
      disk(CONTACT, { ...pageLike('contact'), name: 5 })
      disk(ABOUT, noLayout('about'))
    }
    broken()
    const first = save(CONTACT, pageLike('contact'))
    expect(first).toMatchObject({ ok: true })
    expect(problemPaths(first)).toEqual([ABOUT])
    expect(save(ABOUT, pageLike('about'))).not.toHaveProperty('problems')
    broken()
    const second = save(ABOUT, pageLike('about'))
    expect(second).toMatchObject({ ok: true })
    expect(problemPaths(second)).toEqual([CONTACT])
    expect(save(CONTACT, pageLike('contact'))).not.toHaveProperty('problems')
  })

  it('takes the fix of the project file or the delete of a stray file, though they hide other problems', () => {
    const project = json('.bildr/bildr.json')
    disk(ABOUT, noLayout('about'))
    disk('.bildr/bildr.json', '[]')
    const fixed = save('.bildr/bildr.json', project)
    expect(fixed).toMatchObject({ ok: true })
    expect(problemPaths(fixed)).toEqual([ABOUT])
    disk('.bildr/notes.json', { hi: 1 })
    const deleted = deleteModelFile(dir, '.bildr/notes.json')
    expect(deleted).toMatchObject({ ok: true })
    expect(problemPaths(deleted as { problems?: Array<{ path: string }> })).toEqual([ABOUT])
    expect(existsSync(join(dir, '.bildr/notes.json'))).toBe(false)
  })

  it('takes a page edit while its layout is broken, as long as the reference to the layout stays what it was', () => {
    disk(LAYOUT, { ...json(LAYOUT), name: 5 })
    const title = { ...json(ABOUT), seo: { title: 'About' } }
    // The pages' reference to the broken layout is as it was: the page can be edited, not pointed elsewhere.
    expect(save(ABOUT, title)).toMatchObject({ ok: true })
    expect(json(ABOUT).seo.title).toBe('About')
    expect(save(ABOUT, { ...title, layout: 'lay_other' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(json(ABOUT).layout).toBe('lay_main')
  })

  it('refuses changing the id of a file that was broken while the files that point at it stay', () => {
    disk(LAYOUT, { ...json(LAYOUT), name: 5 })
    expect(save(LAYOUT, { ...json(LAYOUT), name: 'main', id: 'lay_other' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(save(LAYOUT, { ...json(LAYOUT), name: 'main' })).toMatchObject({ ok: true })
  })

  it('writes the file in its canonical form', () => {
    disk(CONTACT, noLayout('contact'))
    save(ABOUT, JSON.stringify(pageLike('about')))
    expect(read(ABOUT)).toMatch(/^\{\n {2}"id": "pg_about",/)
  })
})

describe('deleting from a model', () => {
  it('stays as strict for a valid model: the rest must stay valid', () => {
    expect(deleteModelFile(dir, LAYOUT)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(existsSync(join(dir, LAYOUT))).toBe(true)
  })

  it('takes the delete of a broken file while another is broken, and reports the other\'s problem', () => {
    disk(ABOUT, '{ "id": ')
    disk(CONTACT, noLayout('contact'))
    const outcome = deleteModelFile(dir, ABOUT)
    expect(outcome).toMatchObject({ ok: true })
    expect(problemPaths(outcome as { problems?: Array<{ path: string }> })).toEqual([CONTACT])
    expect(existsSync(join(dir, ABOUT))).toBe(false)
  })

  it('refuses deleting a layout the pages use while another file has a schema problem', () => {
    disk(CONTACT, { ...pageLike('contact'), name: 5 })
    expect(deleteModelFile(dir, LAYOUT)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(existsSync(join(dir, LAYOUT))).toBe(true)
  })

  it('refuses a delete that adds a problem to another file', () => {
    disk(CONTACT, noLayout('contact'))
    const outcome = deleteModelFile(dir, LAYOUT)
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid' })
    expect(existsSync(join(dir, LAYOUT))).toBe(true)
  })
})
