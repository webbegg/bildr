import { mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeAtomically } from '../src/node/sync'
import { watchModel } from '../src/node/watch'
import type { ModelWatcher } from '../src/node/watch'

let dir: string
let watcher: ModelWatcher | undefined
let seen: string[]
const errors: Error[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bildr-watch-'))
  mkdirSync(join(dir, 'modules/main/entities'), { recursive: true })
  writeFileSync(join(dir, 'modules/main/entities/note.json'), '{}')
  seen = []
  errors.length = 0
})
afterEach(() => {
  watcher?.close()
  watcher = undefined
  rmSync(dir, { recursive: true, force: true })
})

const start = async () => {
  watcher = watchModel(dir, { onChange: file => seen.push(file), onError: error => errors.push(error) })
  // Let the watches settle before the first change.
  await new Promise(resolve => setTimeout(resolve, 100))
}
/** Waits until `file` was reported, then forgets what was seen. */
const expectReported = async (file: string) => {
  await vi.waitFor(() => expect(seen).toContain(file), { timeout: 2000 })
  seen = []
}
const settle = () => new Promise(resolve => setTimeout(resolve, 300))

describe('watchModel (the .bildr/ watcher)', () => {
  it('reports every atomic save of the same file, not only the first (Node\'s recursive watch on Linux goes deaf after one)', async () => {
    await start()
    const note = join(dir, 'modules/main/entities/note.json')
    for (const content of ['{"a":1}', '{"a":2}', '{"a":3}']) {
      writeAtomically(note, content)
      await expectReported('modules/main/entities/note.json')
    }
    utimesSync(note, new Date(), new Date())
    await expectReported('modules/main/entities/note.json')
    expect(errors).toEqual([])
  })

  it('reports files in folders created after it started, and keeps reporting them', async () => {
    await start()
    mkdirSync(join(dir, 'modules/main/repositories'))
    await settle()
    writeAtomically(join(dir, 'modules/main/repositories/note.json'), '{}')
    await expectReported('modules/main/repositories/note.json')
    writeAtomically(join(dir, 'modules/main/repositories/note.json'), '{"b":1}')
    await expectReported('modules/main/repositories/note.json')
    // A whole folder moved in at once (a git checkout, a copy): the files in it count as changes.
    const outside = mkdtempSync(join(tmpdir(), 'bildr-watch-src-'))
    mkdirSync(join(outside, 'queries'))
    writeFileSync(join(outside, 'queries/all.json'), '{}')
    renameSync(join(outside, 'queries'), join(dir, 'modules/main/queries'))
    rmSync(outside, { recursive: true, force: true })
    await expectReported('modules/main/queries/all.json')
    await settle()
    writeAtomically(join(dir, 'modules/main/queries/all.json'), '{"c":1}')
    await expectReported('modules/main/queries/all.json')
  })

  it('keeps working when a watched folder is removed and created again', async () => {
    await start()
    rmSync(join(dir, 'modules/main/entities'), { recursive: true })
    await settle()
    mkdirSync(join(dir, 'modules/main/entities'))
    await settle()
    writeAtomically(join(dir, 'modules/main/entities/note.json'), '{}')
    await expectReported('modules/main/entities/note.json')
    writeAtomically(join(dir, 'modules/main/entities/note.json'), '{"d":1}')
    await expectReported('modules/main/entities/note.json')
    expect(errors).toEqual([])
  })

  it('never looks inside .cache/ and reports nothing after close', async () => {
    mkdirSync(join(dir, '.cache'))
    await start()
    writeAtomically(join(dir, '.cache/health.json'), '{}')
    await settle()
    expect(seen.filter(file => file.startsWith('.cache/'))).toEqual([])
    watcher!.close()
    writeAtomically(join(dir, 'modules/main/entities/note.json'), '{"e":1}')
    await settle()
    expect(seen).toEqual([])
  })
})
