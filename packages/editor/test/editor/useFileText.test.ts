import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { useFileText } from '../../src/editor/useFileText.ts'
import type { Json } from '../../src/types.ts'

/**
 * The text a file's editor shows (S3): it follows the file until it is typed on, then an outside change is a notice
 * (never applied over the edits), and what is saved is the file's again once it is read back.
 */

const A = '.bildr/modules/blog/pages/index.json'
const B = '.bildr/modules/blog/pages/about.json'
const text = (value: Json) => JSON.stringify(value, null, 2)

const scopes: Array<ReturnType<typeof effectScope>> = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})

/** A file text over files the test changes, as the editor's `model_get` reading would. */
const setup = (files: Record<string, Json>, path = A, invalid: Record<string, string> = {}) => {
  const state = { files: ref(files), invalid: ref(invalid), path: ref(path) }
  const scope = effectScope()
  scopes.push(scope)
  const file = scope.run(() => useFileText({ path: state.path, files: () => state.files.value, invalid: () => state.invalid.value }))!
  const outside = async (next: Record<string, Json>) => {
    state.files.value = next
    await nextTick()
  }
  const type = async (value: string) => {
    file.content.value = value
    await nextTick()
  }
  return { ...state, file, outside, type }
}

describe('the text of a file', () => {
  it('is the file as JSON, and not dirty', () => {
    const { file } = setup({ [A]: { id: 'pg_index', name: 'index' } })
    expect(file.content.value).toBe(text({ id: 'pg_index', name: 'index' }))
    expect(file.dirty.value).toBe(false)
    expect(file.external.value).toBeNull()
  })

  it('is empty for a path that is no file yet, which an edit would create (base null)', () => {
    const { file } = setup({}, B)
    expect(file.content.value).toBe('')
    expect(file.dirty.value).toBe(false)
    expect(file.base.value).toBeNull()
  })

  it('has the file as its base, its JSON, to say which file an edit started from', () => {
    const { file } = setup({ [A]: { id: 'pg_index' } })
    expect(file.base.value).toEqual({ id: 'pg_index' })
  })

  it('shows a file that is not valid JSON as it is on disk, says so, and has its text as the base', () => {
    const { file } = setup({}, A, { [A]: '{ "id": ' })
    expect(file.content.value).toBe('{ "id": ')
    expect(file.unreadable.value).toBe(true)
    expect(file.base.value).toBe('{ "id": ')
    expect(file.dirty.value).toBe(false)
  })

  it('follows the file when it changes elsewhere and has not been typed on', async () => {
    const { file, outside } = setup({ [A]: { id: 'pg_index', v: 1 } })
    await outside({ [A]: { id: 'pg_index', v: 2 } })
    expect(file.content.value).toBe(text({ id: 'pg_index', v: 2 }))
    expect(file.external.value).toBeNull()
    expect(file.base.value).toEqual({ id: 'pg_index', v: 2 })
  })

  it('is dirty once it is typed on', async () => {
    const { file, type } = setup({ [A]: { id: 'pg_index' } })
    await type('{ "id": "mine" }')
    expect(file.dirty.value).toBe(true)
    await type(text({ id: 'pg_index' }))
    expect(file.dirty.value).toBe(false)
  })
})

describe('the file changing elsewhere while it is typed on', () => {
  it('leaves what is typed alone and says the file changed, with the new text', async () => {
    const { file, type, outside } = setup({ [A]: { id: 'pg_index', v: 1 } })
    await type('{ "mine": true }')
    await outside({ [A]: { id: 'pg_index', v: 2 } })
    expect(file.content.value).toBe('{ "mine": true }')
    expect(file.external.value).toBe(text({ id: 'pg_index', v: 2 }))
    expect(file.dirty.value).toBe(true)
    // The base stays the file the edit started from, so a save is refused as stale, not applied over the new version.
    expect(file.base.value).toEqual({ id: 'pg_index', v: 1 })
  })

  it('shows the latest version when it changes again', async () => {
    const { file, type, outside } = setup({ [A]: { v: 1 } })
    await type('{ "mine": true }')
    await outside({ [A]: { v: 2 } })
    await outside({ [A]: { v: 3 } })
    expect(file.external.value).toBe(text({ v: 3 }))
  })

  it('loads the new version over the edits on request', async () => {
    const { file, type, outside } = setup({ [A]: { v: 1 } })
    await type('{ "mine": true }')
    await outside({ [A]: { v: 2 } })
    file.loadNew()
    expect(file.content.value).toBe(text({ v: 2 }))
    expect(file.external.value).toBeNull()
    expect(file.dirty.value).toBe(false)
    expect(file.base.value).toEqual({ v: 2 })
  })

  it('keeps the edits on request: the new version is the base now, so saving them replaces it on purpose', async () => {
    const { file, type, outside } = setup({ [A]: { v: 1 } })
    await type('{ "mine": true }')
    await outside({ [A]: { v: 2 } })
    file.keepMine()
    expect(file.content.value).toBe('{ "mine": true }')
    expect(file.external.value).toBeNull()
    expect(file.dirty.value).toBe(true)
    expect(file.base.value).toEqual({ v: 2 })
  })

  it('is no conflict when the file became what was typed', async () => {
    const { file, type, outside } = setup({ [A]: { v: 1 } })
    await type(text({ v: 2 }))
    await outside({ [A]: { v: 2 } })
    expect(file.external.value).toBeNull()
    expect(file.dirty.value).toBe(false)
  })

  it('goes away when the file comes back to what it was', async () => {
    const { file, type, outside } = setup({ [A]: { v: 1 } })
    await type('{ "mine": true }')
    await outside({ [A]: { v: 2 } })
    await outside({ [A]: { v: 1 } })
    expect(file.external.value).toBeNull()
  })

  it('also reports a file that became a different one that is not valid JSON', async () => {
    const { file, type, invalid, files } = setup({ [A]: { v: 1 } })
    await type('{ "mine": true }')
    files.value = {}
    invalid.value = { [A]: '{ nope' }
    await nextTick()
    expect(file.external.value).toBe('{ nope')
  })
})

describe('saving', () => {
  it('makes what was saved the file\'s text, so it is not dirty, and takes the file as the module read it back', async () => {
    const { file, type, outside } = setup({ [A]: { v: 1 } })
    await type('{"v":2}')
    file.saved()
    expect(file.dirty.value).toBe(false)
    // The module's canonical form of it comes back: it is the file's, not an outside change.
    await outside({ [A]: { v: 2, defaulted: true } })
    expect(file.content.value).toBe(text({ v: 2, defaulted: true }))
    expect(file.external.value).toBeNull()
    expect(file.base.value).toEqual({ v: 2, defaulted: true })
  })

  it('creates a file: the path has a file once it is read back', async () => {
    const { file, type, outside } = setup({}, B)
    await type('{"id":"pg_about"}')
    file.saved()
    await outside({ [B]: { id: 'pg_about' } })
    expect(file.content.value).toBe(text({ id: 'pg_about' }))
    expect(file.dirty.value).toBe(false)
    expect(file.base.value).toEqual({ id: 'pg_about' })
  })

  it('drops the edits on request (a file that was deleted)', async () => {
    const { file, type } = setup({ [A]: { v: 1 } })
    await type('{ "mine": true }')
    file.discard()
    expect(file.dirty.value).toBe(false)
  })
})

describe('the path changing', () => {
  it('shows the other file, with no notice and no edits', async () => {
    const { file, type, outside, path } = setup({ [A]: { v: 1 }, [B]: { v: 9 } })
    await type('{ "mine": true }')
    await outside({ [A]: { v: 2 }, [B]: { v: 9 } })
    expect(file.external.value).not.toBeNull()
    path.value = B
    await nextTick()
    expect(file.content.value).toBe(text({ v: 9 }))
    expect(file.external.value).toBeNull()
    expect(file.dirty.value).toBe(false)
    expect(file.base.value).toEqual({ v: 9 })
  })

  it('shows nothing for a path that has no file', async () => {
    const { file, path } = setup({ [A]: { v: 1 } })
    path.value = ''
    await nextTick()
    expect(file.content.value).toBe('')
    expect(file.dirty.value).toBe(false)
  })
})
