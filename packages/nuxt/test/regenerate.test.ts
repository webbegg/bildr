import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { isModelChange, regenerate } from '../src/node/regenerate'

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-regenerate-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const pageModel = '.bildr/modules/main/pages/index.json'
const pageFile = 'layers/main/app/pages/index.vue'
const read = (path: string) => readFileSync(join(dir, path), 'utf8')

/** Edits the index page model as the editor or a hand edit would. */
const editPage = (edit: (page: { root: { children: Array<Record<string, unknown>> } }) => void) => {
  const page = JSON.parse(read(pageModel))
  edit(page)
  writeFileSync(join(dir, pageModel), JSON.stringify(page, null, 2))
}

// T7d: a .bildr/ change regenerates the app through the sync engine.
describe('regenerate', () => {
  it('is a no-op on a freshly created project', () => {
    const result = regenerate(dir)
    expect(result.ok).toBe(true)
    expect(result.ok && result.report.written).toEqual([])
  })

  it('rewrites the generated page after a model edit and records it in the manifest', () => {
    editPage((page) => {
      page.root.children[0]!.props = { level: 1, text: 'Hello from the model' }
    })
    const manifest = read('.bildr/manifest.json')
    const result = regenerate(dir)
    expect(result.ok && result.report.written).toEqual([pageFile])
    expect(read(pageFile)).toContain('<h1 class="text-3xl font-semibold">Hello from the model</h1>')
    expect(read('.bildr/manifest.json')).not.toBe(manifest)
  })

  it('never syncs an invalid model: reports the problems and writes nothing', () => {
    editPage((page) => {
      page.root.children[0]!.id = ''
    })
    const before = { page: read(pageFile), manifest: read('.bildr/manifest.json') }
    const result = regenerate(dir)
    expect(result.ok).toBe(false)
    expect(!result.ok && 'problems' in result && result.problems[0]!.path).toBe(pageModel)
    expect({ page: read(pageFile), manifest: read('.bildr/manifest.json') }).toEqual(before)
  })

  it('writes nothing when the generator refuses the model', () => {
    editPage((page) => {
      page.root.children.push({ id: 'n_video', type: 'Video' })
    })
    const before = { page: read(pageFile), manifest: read('.bildr/manifest.json') }
    const result = regenerate(dir)
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/node type Video can't be generated yet/) })
    expect({ page: read(pageFile), manifest: read('.bildr/manifest.json') }).toEqual(before)
  })

  it('keeps a hand-edited page and reports it detached', () => {
    writeFileSync(join(dir, pageFile), '<template>mine</template>\n')
    editPage((page) => {
      page.root.children[0]!.props = { level: 1, text: 'v2' }
    })
    const result = regenerate(dir)
    expect(result.ok && result.report.detached).toEqual([pageFile])
    expect(read(pageFile)).toBe('<template>mine</template>\n')
  })
})

describe('isModelChange (the watcher filter)', () => {
  it('reacts to model files only: never to the manifest a sync writes, temp files or the cache', () => {
    expect(isModelChange('modules/main/pages/index.json')).toBe(true)
    expect(isModelChange('theme.json')).toBe(true)
    expect(isModelChange('manifest.json')).toBe(false)
    expect(isModelChange('manifest.json.tmp')).toBe(false)
    expect(isModelChange('modules/main/pages/index.json.tmp')).toBe(false)
    expect(isModelChange('.cache/health.json')).toBe(false)
    expect(isModelChange('.cache')).toBe(false)
    expect(isModelChange(undefined)).toBe(false)
  })
})
