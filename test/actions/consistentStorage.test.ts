import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { createConsistentStorage } from '../../server/utils/consistentStorage'
import type { KeyValueStorage } from '../../server/utils/projectStore'
import type { Project } from '#shared/document/schema'

/** Like unstorage's fs driver: a write truncates first, so a concurrent read sees nothing. */
function nonAtomicStorage(): KeyValueStorage & { reads: number } {
  const data = new Map<string, unknown>()
  const tick = () => new Promise(resolve => setTimeout(resolve, 1))
  const storage = {
    reads: 0,
    getItem: async (key: string) => {
      storage.reads++
      await tick()
      return structuredClone(data.get(key) ?? null) as never
    },
    setItem: async (key: string, value: unknown) => {
      data.delete(key)
      await tick()
      await tick()
      data.set(key, structuredClone(value))
    },
    removeItem: async (key: string) => {
      data.delete(key)
    },
    getKeys: async (base?: string) => [...data.keys()].filter(k => !base || k.startsWith(base))
  }
  return storage
}

describe('createConsistentStorage', () => {
  it('reproduces the bug: the raw storage misses a key while it is being rewritten', async () => {
    const raw = nonAtomicStorage()
    await raw.setItem('projects:a', { v: 1 })
    const [, read] = await Promise.all([raw.setItem('projects:a', { v: 2 }), raw.getItem('projects:a')])
    expect(read).toBeNull()
  })

  it('never misses a key that is being rewritten', async () => {
    const storage = createConsistentStorage(nonAtomicStorage())
    await storage.setItem('projects:a', { v: 1 })
    const results = await Promise.all([
      storage.setItem('projects:a', { v: 2 }),
      ...Array.from({ length: 20 }, () => storage.getItem<{ v: number }>('projects:a'))
    ])
    for (const read of results.slice(1)) expect(read).not.toBeNull()
    expect(await storage.getItem('projects:a')).toEqual({ v: 2 })
  })

  it('reads keys this process never wrote from the underlying storage, once', async () => {
    const raw = nonAtomicStorage()
    await raw.setItem('projects:old', { v: 'disk' })
    const storage = createConsistentStorage(raw)
    expect(await storage.getItem('projects:old')).toEqual({ v: 'disk' })
    const before = raw.reads
    expect(await storage.getItem('projects:old')).toEqual({ v: 'disk' })
    expect(raw.reads).toBe(before)
    expect(await storage.getItem('projects:missing')).toBeNull()
  })

  it('hands out copies, so callers mutating a value never change the stored one', async () => {
    const storage = createConsistentStorage(nonAtomicStorage())
    const value = { list: [1] }
    await storage.setItem('k', value)
    value.list.push(2)
    const read = await storage.getItem<{ list: number[] }>('k')
    read!.list.push(3)
    expect(await storage.getItem('k')).toEqual({ list: [1] })
  })

  it('persists writes and removals to the underlying storage, and lists keys consistently', async () => {
    const raw = nonAtomicStorage()
    const storage = createConsistentStorage(raw)
    await storage.setItem('projects:a', { v: 1 })
    await storage.setItem('projects:b', { v: 2 })
    await storage.removeItem('projects:b')
    expect(await raw.getItem('projects:a')).toEqual({ v: 1 })
    expect(await raw.getItem('projects:b')).toBeNull()
    expect((await storage.getKeys('projects:')).sort()).toEqual(['projects:a'])
    expect(await storage.getItem('projects:b')).toBeNull()
  })

  it('keeps per-key write order, so the last write wins on disk', async () => {
    const raw = nonAtomicStorage()
    const storage = createConsistentStorage(raw)
    await Promise.all([1, 2, 3, 4, 5].map(v => storage.setItem('k', { v })))
    expect(await raw.getItem('k')).toEqual({ v: 5 })
  })

  it('lets a write that lands during a first read win over the disk value', async () => {
    const raw = nonAtomicStorage()
    await raw.setItem('projects:a', { v: 1 })
    const storage = createConsistentStorage(raw)
    const cold = storage.getItem<{ v: number }>('projects:a')
    const write = storage.setItem('projects:a', { v: 2 })
    expect(await cold).toEqual({ v: 2 })
    await write
    expect(await storage.getItem('projects:a')).toEqual({ v: 2 })
  })

  it('writes to disk in call order even when an earlier write is slower', async () => {
    const data = new Map<string, unknown>()
    const raw: KeyValueStorage = {
      getItem: async key => (data.get(key) ?? null) as never,
      setItem: async (key, value) => {
        await new Promise(resolve => setTimeout(resolve, (value as { v: number }).v === 1 ? 20 : 1))
        data.set(key, value)
      },
      removeItem: async (key) => {
        data.delete(key)
      },
      getKeys: async () => [...data.keys()]
    }
    const storage = createConsistentStorage(raw)
    await Promise.all([storage.setItem('k', { v: 1 }), storage.setItem('k', { v: 2 })])
    expect(data.get('k')).toEqual({ v: 2 })
    await Promise.all([storage.removeItem('k'), storage.setItem('k', { v: 3 })])
    expect(data.get('k')).toEqual({ v: 3 })
  })

  it('lists a key being written and hides one being removed', async () => {
    const raw = nonAtomicStorage()
    await raw.setItem('projects:old', { v: 1 })
    const storage = createConsistentStorage(raw)
    const write = storage.setItem('projects:new', { v: 1 })
    const remove = storage.removeItem('projects:old')
    expect(await storage.getKeys('projects:')).toEqual(['projects:new'])
    await Promise.all([write, remove])
  })

  it('keeps project_get answering while the dispatcher saves the same project', async () => {
    const http = { caller: 'http' as const }
    const bildr = createBildr(createConsistentStorage(nonAtomicStorage()))
    const project = await bildr.call<Project>('project_create', { name: 'Race' }, http)
    const pageId = project.pages[0]!.id
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => bildr.call('node_insert', { projectId: project.id, pageId, type: 'Text', props: { text: `t${i}` } }, http)),
      ...Array.from({ length: 30 }, () => bildr.call('project_get', { projectId: project.id }, http))
    ])
    expect((await bildr.call<Project>('project_get', { projectId: project.id }, http)).version).toBe(10)
  })

  it('keeps the previous value when the disk write fails, and reports the failure', async () => {
    const raw = nonAtomicStorage()
    const storage = createConsistentStorage({ ...raw, setItem: async (key, value) => {
      if ((value as { v: number }).v === 2) throw new Error('ENOSPC')
      await raw.setItem(key, value)
    } })
    await storage.setItem('k', { v: 1 })
    await expect(storage.setItem('k', { v: 2 })).rejects.toThrow('ENOSPC')
    expect(await storage.getItem('k')).toEqual({ v: 1 })
  })

  it('treats writing undefined as a removal, like unstorage', async () => {
    const raw = nonAtomicStorage()
    const storage = createConsistentStorage(raw)
    await storage.setItem('k', { v: 1 })
    await storage.setItem('k', undefined)
    expect(await storage.getItem('k')).toBeNull()
    expect(await storage.getKeys()).toEqual([])
  })
})
