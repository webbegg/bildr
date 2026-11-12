import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { starterKit } from '@bildr/codegen/starter'
import type { SyncPlan } from '@bildr/codegen/sync'
import { createProject } from '../../create-bildr/src/create'
import { applySync, nodeIo, readManifest, syncProject } from '../src/node/sync'

/** What the generator produced for this project: the starter kit (until the generators exist). */
const generated = () => starterKit({ name: 'App' }).files
const emptyReport = { written: [], unchanged: [], detached: [], deleted: [], orphaned: [], removed: [], refused: [] }

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-sync-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const page = 'layers/main/app/pages/index.vue'

describe('syncProject', () => {
  it('rewrites untouched managed files and records the new hash', () => {
    const before = readManifest(dir)
    expect(syncProject(dir, generated()).writes).toEqual([])
    const result = syncProject(dir, generated().map(file => file.path === page ? { ...file, content: '<template>v2</template>\n' } : file))
    expect(result.report.written).toEqual([page])
    expect(readFileSync(join(dir, page), 'utf8')).toBe('<template>v2</template>\n')
    expect(readManifest(dir)[page]!.sha256).not.toBe(before[page]!.sha256)
  })

  it('never overwrites a hand-edited file and marks it detached', () => {
    writeFileSync(join(dir, page), 'mine')
    const result = syncProject(dir, generated().map(file => file.path === page ? { ...file, content: 'v2' } : file))
    expect(result.report.detached).toEqual([page])
    expect(readFileSync(join(dir, page), 'utf8')).toBe('mine')
    expect(readManifest(dir)[page]!.owner).toBe('detached')
  })

  it('deletes untouched files that are no longer generated', () => {
    const result = syncProject(dir, generated().filter(file => file.path !== page))
    expect(result.report.removed).toEqual([page])
    expect(existsSync(join(dir, page))).toBe(false)
    expect(readManifest(dir)[page]).toBeUndefined()
  })
})

describe('applySync', () => {
  it('writes the manifest last: a failure partway leaves the previous manifest', () => {
    const before = readFileSync(join(dir, '.bildr/manifest.json'), 'utf8')
    const failing = { ...nodeIo, writeFile: (path: string, content: string) => {
      if (path.endsWith('b.ts')) throw new Error('EACCES: permission denied')
      nodeIo.writeFile(path, content)
    } }
    const plan: SyncPlan = { writes: [{ path: 'a.ts', content: 'A' }, { path: 'b.ts', content: 'B' }], deletes: [], manifest: {}, report: emptyReport }
    expect(() => applySync(dir, plan, failing)).toThrow('EACCES')
    expect(readFileSync(join(dir, '.bildr/manifest.json'), 'utf8')).toBe(before)
  })

  it('never writes through a symlinked folder that points outside the project', () => {
    mkdirSync(join(root, 'outside'))
    rmSync(join(dir, 'layers/main/app/pages'), { recursive: true })
    symlinkSync(join(root, 'outside'), join(dir, 'layers/main/app/pages'))
    const plan: SyncPlan = { writes: [{ path: 'layers/main/app/pages/index.vue', content: 'x' }], deletes: [], manifest: {}, report: emptyReport }
    expect(() => applySync(dir, plan)).toThrow('Unsafe path: layers/main/app/pages/index.vue (resolves outside the project)')
    expect(readdirSync(join(root, 'outside'))).toEqual([])
  })

  it('refuses to write or delete outside the project', () => {
    const plan: SyncPlan = { writes: [{ path: '../escape.ts', content: 'x' }], deletes: [], manifest: {}, report: emptyReport }
    expect(() => applySync(dir, plan)).toThrow('Unsafe path: ../escape.ts')
    expect(existsSync(join(root, 'escape.ts'))).toBe(false)
    expect(() => applySync(dir, { ...plan, writes: [], deletes: ['.bildr/bildr.json'] })).toThrow('Unsafe path: .bildr/bildr.json')
  })
})
