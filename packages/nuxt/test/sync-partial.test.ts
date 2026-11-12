import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { nodeIo, readManifest, syncProject } from '../src/node/sync'

const files = (a: string, b: string) => [
  { path: 'a.txt', content: a, owner: 'managed' as const },
  { path: 'b.txt', content: b, owner: 'managed' as const }
]
const failOn = (suffix: string) => ({
  ...nodeIo,
  writeFile: (path: string, content: string) => {
    if (path.endsWith(suffix)) throw new Error('EACCES')
    nodeIo.writeFile(path, content)
  }
})

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-partial-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

// T7d verification blocker: in nuxt dev the next sync follows the next model change, not a retry.
it('a write failing mid-sync does not detach files already written when the model changes again', () => {
  syncProject(root, files('a0', 'b0'))
  expect(() => syncProject(root, files('a1', 'b1'), { io: failOn('b.txt') })).toThrow('EACCES')
  const plan = syncProject(root, files('a2', 'b1'))
  expect(plan.report.detached).toEqual([])
  expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a2')
  expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('b1')
})

it('rolls back the writes that landed, so disk matches the unchanged manifest (S6)', () => {
  syncProject(root, files('a0', 'b0'))
  const before = readManifest(root)
  expect(() => syncProject(root, files('a1', 'b1'), { io: failOn('b.txt') })).toThrow('EACCES')
  expect(readManifest(root)).toEqual(before)
  expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a0')
  expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('b0')
})

it('removes a new file again when a later write fails', () => {
  syncProject(root, files('a0', 'b0'))
  // `a-new.txt` sorts before `b.txt`, so it lands before the failure.
  const withNew = [{ path: 'a-new.txt', content: 'n', owner: 'managed' as const }, ...files('a1', 'b1')]
  expect(() => syncProject(root, withNew, { io: failOn('b.txt') })).toThrow('EACCES')
  expect(existsSync(join(root, 'a-new.txt'))).toBe(false)
})

it('restores a deleted file when the manifest write fails', () => {
  syncProject(root, files('a0', 'b0'))
  expect(() => syncProject(root, files('a0', 'b0').slice(0, 1), { io: failOn('manifest.json.tmp') })).toThrow('EACCES')
  expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('b0')
})
