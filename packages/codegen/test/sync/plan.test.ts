import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { planSync } from '../../src/sync/plan'
import type { GeneratedFile, SyncInput } from '../../src/sync/plan'
import type { ManifestFile } from '../../src/model/schemas'

const hash = (content: string) => createHash('sha256').update(content).digest('hex')
type Entries = ManifestFile['files']

const managed = (path: string, content: string, source?: string): GeneratedFile => ({ path, content, owner: 'managed', ...(source ? { source } : {}) })
const scaffold = (path: string, content: string): GeneratedFile => ({ path, content, owner: 'scaffold' })
const entry = (owner: Entries[string]['owner'], content: string) => ({ owner, sha256: hash(content) })

/** Disk as path → content; the planner sees only hashes. */
const plan = (generated: GeneratedFile[], manifest: Entries, disk: Record<string, string>, extra: Partial<SyncInput> = {}) =>
  planSync({ generated, manifest, disk: Object.fromEntries(Object.entries(disk).map(([path, text]) => [path, hash(text)])), hash, ...extra })

describe('planSync: managed files', () => {
  it('writes new files and records them as managed with their source', () => {
    const result = plan([managed('a.ts', 'A', '.bildr/x.json')], {}, {})
    expect(result.writes).toEqual([{ path: 'a.ts', content: 'A' }])
    expect(result.manifest).toEqual({ 'a.ts': { owner: 'managed', sha256: hash('A'), source: '.bildr/x.json' } })
    expect(result.report.written).toEqual(['a.ts'])
  })

  it('overwrites untouched files and skips unchanged ones', () => {
    const result = plan([managed('a.ts', 'A2'), managed('b.ts', 'B')], { 'a.ts': entry('managed', 'A'), 'b.ts': entry('managed', 'B') }, { 'a.ts': 'A', 'b.ts': 'B' })
    expect(result.writes).toEqual([{ path: 'a.ts', content: 'A2' }])
    expect(result.manifest['a.ts']).toEqual({ owner: 'managed', sha256: hash('A2') })
    expect(result.report.unchanged).toEqual(['b.ts'])
  })

  it('detaches a file the user edited and never overwrites it', () => {
    const result = plan([managed('a.ts', 'A2')], { 'a.ts': entry('managed', 'A') }, { 'a.ts': 'mine' })
    expect(result.writes).toEqual([])
    // The manifest keeps the hash of what bildr would write now, so the editor can show the diff.
    expect(result.manifest['a.ts']).toEqual({ owner: 'detached', sha256: hash('A2') })
    expect(result.report.detached).toEqual(['a.ts'])
  })

  it('keeps a detached file detached, and reattaches it on request or when the user edit matches', () => {
    const manifest = { 'a.ts': entry('detached', 'A') }
    expect(plan([managed('a.ts', 'A2')], manifest, { 'a.ts': 'mine' }).report.detached).toEqual(['a.ts'])
    const reattached = plan([managed('a.ts', 'A2')], manifest, { 'a.ts': 'mine' }, { reattach: ['a.ts'] })
    expect(reattached.writes).toEqual([{ path: 'a.ts', content: 'A2' }])
    expect(reattached.manifest['a.ts']!.owner).toBe('managed')
    const matching = plan([managed('a.ts', 'A2')], manifest, { 'a.ts': 'A2' })
    expect(matching.writes).toEqual([])
    expect(matching.manifest['a.ts']!.owner).toBe('managed')
  })

  it('respects a file the user deleted, until reattached', () => {
    const result = plan([managed('a.ts', 'A')], { 'a.ts': entry('managed', 'A') }, {})
    expect(result.writes).toEqual([])
    expect(result.manifest['a.ts']!.owner).toBe('deleted')
    expect(result.report.deleted).toEqual(['a.ts'])
    expect(plan([managed('a.ts', 'A')], { 'a.ts': entry('deleted', 'A') }, {}).writes).toEqual([])
    // Deleting a detached file is also a decision to keep it gone.
    expect(plan([managed('a.ts', 'A')], { 'a.ts': entry('detached', 'A') }, {}).manifest['a.ts']!.owner).toBe('deleted')
    expect(plan([managed('a.ts', 'A')], { 'a.ts': entry('deleted', 'A') }, {}, { reattach: ['a.ts'] }).writes).toEqual([{ path: 'a.ts', content: 'A' }])
  })

  it('never overwrites a file it did not write', () => {
    const result = plan([managed('a.ts', 'A')], {}, { 'a.ts': 'user file' })
    expect(result.writes).toEqual([])
    expect(result.manifest['a.ts']!.owner).toBe('detached')
  })

  it('treats a file already holding the new content as managed (a sync that failed before writing the manifest)', () => {
    const result = plan([managed('a.ts', 'A2')], { 'a.ts': entry('managed', 'A') }, { 'a.ts': 'A2' })
    expect(result.writes).toEqual([])
    expect(result.manifest['a.ts']).toEqual({ owner: 'managed', sha256: hash('A2') })
  })
})

describe('planSync: files no longer generated', () => {
  it('deletes untouched ones, orphans edited ones, forgets missing ones', () => {
    const manifest = { 'gone.ts': entry('managed', 'G'), 'edited.ts': entry('managed', 'E'), 'missing.ts': entry('managed', 'M'), 'was-deleted.ts': entry('deleted', 'D') }
    const result = plan([], manifest, { 'gone.ts': 'G', 'edited.ts': 'mine' })
    expect(result.deletes).toEqual(['gone.ts'])
    expect(result.manifest).toEqual({ 'edited.ts': { owner: 'orphaned', sha256: hash('E') } })
    expect(result.report.orphaned).toEqual(['edited.ts'])
    expect(result.report.removed).toEqual(['gone.ts'])
  })

  it('brings an orphan back under management when it is generated again and untouched', () => {
    const result = plan([managed('a.ts', 'A')], { 'a.ts': entry('orphaned', 'old') }, {})
    expect(result.writes).toEqual([{ path: 'a.ts', content: 'A' }])
    expect(result.manifest['a.ts']!.owner).toBe('managed')
  })
})

describe('planSync: scaffold files', () => {
  it('writes a scaffold file only when absent, then leaves it to the user', () => {
    const first = plan([scaffold('nuxt.config.ts', 'S')], {}, {})
    expect(first.writes).toEqual([{ path: 'nuxt.config.ts', content: 'S' }])
    expect(first.manifest['nuxt.config.ts']).toEqual({ owner: 'scaffold', sha256: hash('S') })
    const later = plan([scaffold('nuxt.config.ts', 'S2')], first.manifest, { 'nuxt.config.ts': 'edited' })
    expect(later.writes).toEqual([])
    expect(later.manifest['nuxt.config.ts']).toEqual({ owner: 'scaffold', sha256: hash('S') })
    expect(plan([], first.manifest, { 'nuxt.config.ts': 'edited' }).deletes).toEqual([])
  })
})

describe('planSync: output', () => {
  it('sorts writes, deletes and manifest keys, and refuses duplicate or unsafe paths', () => {
    const result = plan([managed('b.ts', 'B'), managed('a.ts', 'A')], {}, {})
    expect(result.writes.map(write => write.path)).toEqual(['a.ts', 'b.ts'])
    expect(Object.keys(result.manifest)).toEqual(['a.ts', 'b.ts'])
    expect(() => plan([managed('a.ts', 'A'), managed('a.ts', 'B')], {}, {})).toThrow('Generated twice: a.ts')
    expect(() => plan([managed('../x.ts', 'A')], {}, {})).toThrow('Unsafe path: ../x.ts')
    expect(() => plan([managed('.bildr/bildr.json', 'A')], {}, {})).toThrow('Unsafe path: .bildr/bildr.json')
    expect(() => plan([managed('/etc/x', 'A')], {}, {})).toThrow('Unsafe path: /etc/x')
  })
})
