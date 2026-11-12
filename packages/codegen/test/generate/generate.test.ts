import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { planSync } from '../../src/sync/plan'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

const fixtureModel = () => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}

const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const manifest = () => JSON.parse(readFileSync(join(fixtureRoot, '.bildr/manifest.json'), 'utf8'))

// T7d: the whole generator. Only a complete one may drive a sync (see planSync).
describe('generate on the golden fixture', () => {
  const files = generate(fixtureModel())
  const managed = Object.entries(manifest().files as Record<string, { owner: string }>).filter(([, entry]) => entry.owner === 'managed').map(([path]) => path).sort()

  it('emits exactly the managed files of the fixture manifest, sorted', () => {
    expect(files.map(file => file.path)).toEqual(managed)
  })

  it('matches every managed file byte for byte', () => {
    const different = files.filter(file => file.content !== readFileSync(join(fixtureRoot, file.path), 'utf8')).map(file => file.path)
    expect(different).toEqual([])
  })

  it('is a no-op sync on the fixture: nothing to write, delete or detach', () => {
    const current = manifest()
    const disk = Object.fromEntries(Object.keys(current.files).map(path => [path, hash(readFileSync(join(fixtureRoot, path), 'utf8'))]))
    const { report } = planSync({ generated: files, manifest: current.files, disk, hash })
    expect({ written: report.written, deleted: report.deleted, detached: report.detached, orphaned: report.orphaned }).toEqual({ written: [], deleted: [], detached: [], orphaned: [] })
  })
})
