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

describe('generate refuses models that would collide in the database or the code', () => {
  it('two stored entities on one table (verification T8 A1)', () => {
    const model = fixtureModel()
    const blog = model.modules.blog!
    const post = blog.entities.find(entity => entity.id === 'ent_post')!
    const repository = blog.repositories.find(entry => entry.entity === 'ent_post')!
    blog.entities.push({ ...post, id: 'ent_copy', name: 'Copy', plural: 'copies' })
    blog.repositories.push({ ...repository, id: 'repo_copy', entity: 'ent_copy' })
    expect(() => generate(model)).toThrow('Copy and Post would share the table blog_posts: give one of them another table or plural')
  })

  it('two entities with the same plural in one module', () => {
    const model = fixtureModel()
    const post = model.modules.blog!.entities.find(entity => entity.id === 'ent_post')!
    model.modules.blog!.entities.push({ ...post, id: 'ent_copy', name: 'Copy' })
    expect(() => generate(model)).toThrow('Copy and Post both use the plural posts in module blog: plurals name code and tables, so they must differ')
  })
})

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
