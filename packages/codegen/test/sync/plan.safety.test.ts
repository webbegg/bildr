import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isSafeProjectPath, planSync } from '../../src/sync/plan'
import type { ManifestEntries } from '../../src/sync/plan'

const h = (content: string) => createHash('sha256').update(content).digest('hex')
const P = 'x/a.ts'
const OLD = 'old'
const NEW = 'new'
const USER = 'user'
const owners = ['none', 'managed', 'scaffold', 'detached', 'deleted', 'orphaned'] as const
const disks = ['missing', 'eqManifest', 'eqNew', 'other'] as const

// S6 / D1, from the T4 verification: the planner must never destroy hand-written code.
describe('planSync safety', () => {
  it('never writes or deletes a file the user changed, in every owner × disk × generated × reattach case', () => {
    for (const owner of owners) for (const state of disks) for (const generated of ['managed', 'scaffold', 'no'] as const) for (const reattach of [false, true]) {
      if (owner === 'none' && state === 'eqManifest') continue
      const disk = state === 'missing' ? undefined : state === 'eqManifest' ? h(OLD) : state === 'eqNew' ? h(NEW) : h(USER)
      const result = planSync({
        generated: generated === 'no' ? [] : [{ path: P, content: NEW, owner: generated }],
        manifest: owner === 'none' ? {} : { [P]: { owner, sha256: h(OLD) } },
        disk: { [P]: disk },
        hash: h,
        reattach: reattach ? [P] : []
      })
      const touched = result.writes.some(write => write.path === P) || result.deletes.includes(P)
      const allowed = disk === undefined || (owner === 'managed' && disk === h(OLD)) || reattach || disk === h(NEW)
      expect(touched && !allowed, `${owner}/${state}/${generated}/${reattach}`).toBe(false)
      if (generated === 'scaffold' && result.writes.length) expect(owner === 'none' && disk === undefined).toBe(true)
      if (owner === 'scaffold') expect(result.deletes).toEqual([])
    }
  })

  it('keeps an edited file out of writes and deletes on every later run', () => {
    let manifest: ManifestEntries = { [P]: { owner: 'managed', sha256: h(OLD) } }
    for (const content of ['G1', 'G2', null, 'G3', null, 'G4']) {
      const result = planSync({ generated: content ? [{ path: P, content, owner: 'managed' }] : [], manifest, disk: { [P]: h(USER) }, hash: h })
      expect(result.writes).toEqual([])
      expect(result.deletes).toEqual([])
      manifest = result.manifest
    }
  })

  it('never deletes unsafe or .bildr paths listed in the manifest, and drops them from it', () => {
    const bad = ['../outside.ts', '/etc/passwd', '.bildr/bildr.json', '.bildr/manifest.json', '.BILDR/x', 'C:/x', 'a/../../x', 'a\\..\\x', 'a\0b']
    const result = planSync({
      generated: [],
      hash: h,
      manifest: Object.fromEntries(bad.map(path => [path, { owner: 'managed' as const, sha256: h('X') }])),
      disk: Object.fromEntries(bad.map(path => [path, h('X')])),
      reattach: bad
    })
    expect(result.deletes).toEqual([])
    expect(result.writes).toEqual([])
    expect(result.manifest).toEqual({})
    expect(result.report.refused).toEqual([...bad].sort((a, b) => a < b ? -1 : a > b ? 1 : 0))
  })

  it('refuses .bildr in any letter case and NUL bytes in generated paths', () => {
    for (const path of ['.Bildr/manifest.json', '.BILDR', 'a\0b']) expect(isSafeProjectPath(path), path).toBe(false)
    expect(isSafeProjectPath('layers/blog/a.ts')).toBe(true)
  })

  it('orders writes the same way as manifest keys (code-unit order, locale independent)', () => {
    const paths = ['b.ts', 'B.ts', 'a.ts', 'A.ts', '_x.ts', 'ä.ts']
    const result = planSync({ generated: paths.map(path => ({ path, content: path, owner: 'managed' as const })), manifest: {}, disk: {}, hash: h })
    expect(result.writes.map(write => write.path)).toEqual(Object.keys(result.manifest))
    expect(result.writes.map(write => write.path)).toEqual(['A.ts', 'B.ts', '_x.ts', 'a.ts', 'b.ts', 'ä.ts'])
  })
})
