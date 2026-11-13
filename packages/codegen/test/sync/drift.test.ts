import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { driftReport, unifiedDiff } from '../../src/sync/index'
import type { GeneratedFile, ManifestEntries } from '../../src/sync/index'

const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const managed = (path: string, content: string): GeneratedFile => ({ path, content, owner: 'managed' })

describe('unifiedDiff', () => {
  it('is empty for equal texts', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n', 'x.ts')).toBe('')
  })

  it('shows a changed line with three lines of context, generated version first', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n') + '\n'
    const after = before.replace('5', 'five')
    expect(unifiedDiff(before, after, 'app/x.ts')).toBe([
      '--- app/x.ts (generated)',
      '+++ app/x.ts (on disk)',
      '@@ -2,7 +2,7 @@',
      ' 2',
      ' 3',
      ' 4',
      '-5',
      '+five',
      ' 6',
      ' 7',
      ' 8',
      ''
    ].join('\n'))
  })

  it('keeps distant changes in separate hunks and counts added and removed lines', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'
    const after = before.replace('line 2\n', '').replace('line 18\n', 'line 18\nextra\n')
    const diff = unifiedDiff(before, after, 'a.ts')
    expect(diff.split('\n').filter(line => line.startsWith('@@'))).toEqual(['@@ -1,5 +1,4 @@', '@@ -16,5 +15,6 @@'])
    expect(diff).toContain('-line 2\n')
    expect(diff).toContain('+extra\n')
  })

  it('marks a missing final newline', () => {
    expect(unifiedDiff('a\n', 'a', 'a.ts')).toContain('\\ No newline at end of file')
  })

  it('refuses to diff very large files instead of stalling', () => {
    const big = Array.from({ length: 5000 }, (_, index) => `${index}`).join('\n')
    const other = Array.from({ length: 5000 }, (_, index) => `${index * 2}`).join('\n')
    expect(unifiedDiff(big, other, 'big.ts')).toBe('--- big.ts (generated)\n+++ big.ts (on disk)\n(too large to show a line diff)\n')
  })
})

describe('driftReport', () => {
  const generated = [managed('app/a.ts', 'export const a = 1\n'), managed('app/b.ts', 'export const b = 1\n'), { path: 'app/s.ts', content: 's\n', owner: 'scaffold' as const }]
  const manifest: ManifestEntries = {
    'app/a.ts': { owner: 'managed', sha256: hash('export const a = 1\n') },
    'app/b.ts': { owner: 'managed', sha256: hash('export const b = 1\n') },
    'app/s.ts': { owner: 'scaffold', sha256: hash('s\n') }
  }

  it('is clean when every managed file is as generated, whatever the scaffold files hold', () => {
    const report = driftReport({ generated, manifest, disk: { 'app/a.ts': 'export const a = 1\n', 'app/b.ts': 'export const b = 1\n', 'app/s.ts': 'edited\n' }, hash })
    expect(report).toEqual({ files: [], missingManifest: false })
  })

  it('lists an edited file as detached with its diff against what bildr generates now', () => {
    const report = driftReport({ generated, manifest, disk: { 'app/a.ts': 'export const a = 2\n', 'app/b.ts': 'export const b = 1\n' }, hash })
    expect(report.files).toEqual([{
      path: 'app/a.ts',
      state: 'detached',
      diff: '--- app/a.ts (generated)\n+++ app/a.ts (on disk)\n@@ -1 +1 @@\n-export const a = 1\n+export const a = 2\n'
    }])
  })

  it('keeps reporting a detached file after a sync recorded it, and drops it once it matches again', () => {
    const recorded = { ...manifest, 'app/a.ts': { owner: 'detached' as const, sha256: hash('export const a = 2\n') } }
    expect(driftReport({ generated, manifest: recorded, disk: { 'app/a.ts': 'export const a = 2\n', 'app/b.ts': 'export const b = 1\n' }, hash }).files.map(file => file.state)).toEqual(['detached'])
    expect(driftReport({ generated, manifest: recorded, disk: { 'app/a.ts': 'export const a = 1\n', 'app/b.ts': 'export const b = 1\n' }, hash }).files).toEqual([])
  })

  it('lists deleted managed files and orphaned files (no longer generated, kept because edited)', () => {
    const withOrphan = { ...manifest, 'app/old.ts': { owner: 'orphaned' as const, sha256: hash('old\n') }, 'app/b.ts': { owner: 'deleted' as const, sha256: hash('export const b = 1\n') } }
    const report = driftReport({ generated, manifest: withOrphan, disk: { 'app/a.ts': 'export const a = 1\n', 'app/old.ts': 'old\n' }, hash })
    expect(report.files).toEqual([{ path: 'app/b.ts', state: 'deleted' }, { path: 'app/old.ts', state: 'orphaned' }])
  })

  it('treats a managed file missing from disk as deleted, and a generated file the manifest lacks as not yet written', () => {
    const report = driftReport({ generated: [...generated, managed('app/c.ts', 'c\n')], manifest, disk: { 'app/a.ts': 'export const a = 1\n' }, hash })
    expect(report.files).toEqual([{ path: 'app/b.ts', state: 'deleted' }, { path: 'app/c.ts', state: 'pending' }])
  })

  it('says when there is no manifest yet (the project was never synced)', () => {
    expect(driftReport({ generated, manifest: {}, disk: {}, hash })).toMatchObject({ missingManifest: true })
  })
})
