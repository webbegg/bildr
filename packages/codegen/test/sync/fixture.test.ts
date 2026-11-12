import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ManifestFileSchema } from '../../src/model/schemas'
import { planSync } from '../../src/sync/plan'
import { fixtureRoot } from '../model/fixture'

const hash = (content: string) => createHash('sha256').update(content).digest('hex')

describe('planSync on the golden fixture', () => {
  const manifest = ManifestFileSchema.parse(JSON.parse(readFileSync(join(fixtureRoot, '.bildr/manifest.json'), 'utf8'))).files
  const current = Object.fromEntries(Object.keys(manifest).map(path => [path, readFileSync(join(fixtureRoot, path), 'utf8')]))
  // Stand-in for the generator until T5–T7: it would produce exactly the fixture's files.
  const generated = Object.entries(manifest).map(([path, entry]) => ({
    path, content: current[path]!, owner: entry.owner === 'scaffold' ? 'scaffold' as const : 'managed' as const, ...(entry.source ? { source: entry.source } : {})
  }))
  const disk = Object.fromEntries(Object.entries(current).map(([path, text]) => [path, hash(text)]))

  it('is a no-op when nothing changed', () => {
    const result = planSync({ generated, manifest, disk, hash })
    expect(result.writes).toEqual([])
    expect(result.deletes).toEqual([])
    expect(result.manifest).toEqual(manifest)
  })

  it('detaches a hand-edited file and keeps every other file managed', () => {
    const path = 'layers/blog/app/components/blog/PostCard.vue'
    const result = planSync({ generated, manifest, disk: { ...disk, [path]: hash('edited by hand') }, hash })
    expect(result.writes).toEqual([])
    expect(result.report.detached).toEqual([path])
    expect(Object.values(result.manifest).filter(entry => entry.owner === 'detached')).toHaveLength(1)
  })
})
