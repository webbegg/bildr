import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { starterKit } from '../../src/starter/index'
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

// V7 (E2): the database layer follows the model. Removing the last sqlite data source removes its
// managed files through the sync (D1: a hand-edited one is kept, orphaned); adding one brings them back.
describe('generate adds or removes the database layer with the sqlite data source', () => {
  const DB_FILES = ['drizzle.config.ts', 'layers/core/server/plugins/migrate.ts', 'layers/core/server/utils/db.ts']
  const load = (files: Record<string, string>) => {
    const result = loadModel(files)
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    return result.model
  }
  const withDb = starterKit({ name: 'Acme' })
  const withoutDb = Object.fromEntries(Object.entries(withDb.model).filter(([path]) => path !== '.bildr/datasources/main.json'))

  it('generates the database files only while there is a sqlite data source', () => {
    const paths = (files: Record<string, string>) => generate(load(files)).map(file => file.path)
    expect(paths(withDb.model)).toEqual(expect.arrayContaining(DB_FILES))
    expect(paths(withoutDb).filter(path => DB_FILES.includes(path))).toEqual([])
  })

  it('the sync deletes the untouched database files and keeps a hand-edited one', () => {
    const sync = planSync({ generated: withDb.files, manifest: {}, disk: {}, hash })
    const disk = Object.fromEntries(withDb.files.map(file => [file.path, hash(file.content)]))
    disk['layers/core/server/utils/db.ts'] = hash('// my own database client')
    const after = planSync({ generated: generate(load(withoutDb)), manifest: sync.manifest, disk, hash })
    expect(after.deletes.sort()).toEqual(['drizzle.config.ts', 'layers/core/server/plugins/migrate.ts'])
    expect(after.report.orphaned).toEqual(['layers/core/server/utils/db.ts'])
    // Scaffold files (package.json, the user's) are never deleted.
    expect(after.deletes).not.toContain('package.json')
  })

  it('adding a sqlite data source back brings the database layer', () => {
    const manifest = planSync({ generated: generate(load(withoutDb)), manifest: {}, disk: {}, hash }).manifest
    const after = planSync({ generated: generate(load(withDb.model)), manifest, disk: {}, hash })
    expect(after.writes.map(file => file.path)).toEqual(expect.arrayContaining(DB_FILES))
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
