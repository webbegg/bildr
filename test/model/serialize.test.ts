import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../shared/model/load'
import { serializeModel, stringifyModelFile } from '../../shared/model/serialize'
import { fixtureModelFiles, fixtureRoot } from './fixture'

const loaded = () => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}

describe('stringifyModelFile', () => {
  it('writes two-space JSON with a trailing newline', () => {
    expect(stringifyModelFile({ a: 1, b: [1] })).toBe('{\n  "a": 1,\n  "b": [\n    1\n  ]\n}\n')
  })
})

describe('serializeModel', () => {
  it('keeps every value of every fixture file (nothing is dropped by the schemas)', () => {
    const original = fixtureModelFiles()
    const written = serializeModel(loaded())
    expect(Object.keys(written)).toEqual(Object.keys(original).sort())
    const changed = Object.keys(written).filter(path => !isDeepStrictEqual(JSON.parse(written[path]!), JSON.parse(original[path]!)))
    expect(changed).toEqual([])
  })

  // Run with UPDATE_MODEL_FIXTURE=1 to rewrite the fixture's .bildr/ files in canonical form.
  it('writes the fixture back byte for byte (the fixture is in canonical form)', () => {
    const written = serializeModel(loaded())
    if (process.env.UPDATE_MODEL_FIXTURE) {
      for (const [path, text] of Object.entries(written)) writeFileSync(join(fixtureRoot, path), text)
    }
    expect(written).toEqual(fixtureModelFiles())
  })

  it('is stable: load → serialize → load → serialize gives the same files', () => {
    const once = serializeModel(loaded())
    const again = loadModel(once)
    expect(again.ok).toBe(true)
    if (again.ok) expect(serializeModel(again.model)).toEqual(once)
  })

  it('names files by kind and model name and sorts manifest entries', () => {
    const model = loaded()
    model.manifest!.files = { 'z.ts': { owner: 'managed', sha256: 'a'.repeat(64) }, 'a.ts': { owner: 'scaffold', sha256: 'b'.repeat(64) } }
    const files = serializeModel(model)
    expect(Object.keys(JSON.parse(files['.bildr/manifest.json']!).files)).toEqual(['a.ts', 'z.ts'])
    expect(files['.bildr/modules/blog/queries/post-by-slug.json']).toContain('"q_post_by_slug"')
  })
})
