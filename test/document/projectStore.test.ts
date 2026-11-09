import { describe, expect, it } from 'vitest'
import { createProjectStore } from '../../server/utils/projectStore'
import type { KeyValueStorage } from '../../server/utils/projectStore'
import { createProject } from '#shared/document/factory'

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, unknown>()
  return {
    getItem: async key => structuredClone(data.get(key) ?? null) as never,
    setItem: async (key, value) => {
      data.set(key, structuredClone(value))
    },
    removeItem: async (key) => {
      data.delete(key)
    },
    getKeys: async base => [...data.keys()].filter(k => !base || k.startsWith(base))
  }
}

describe('project store', () => {
  it('round-trips projects and lists summaries', async () => {
    const store = createProjectStore(memoryStorage())
    const project = createProject('Shop')
    await store.save(project)

    expect(await store.get(project.id)).toEqual(project)
    expect(await store.list()).toEqual([
      { id: project.id, name: 'Shop', slug: 'shop', version: 0, updatedAt: project.updatedAt }
    ])
  })

  it('finds a project by slug and returns undefined for unknown ids', async () => {
    const store = createProjectStore(memoryStorage())
    const project = createProject('Shop')
    await store.save(project)
    expect((await store.getBySlug('shop'))?.id).toBe(project.id)
    expect(await store.get('nope')).toBeUndefined()
  })

  it('refuses to save an invalid document', async () => {
    const store = createProjectStore(memoryStorage())
    const project = createProject('Shop')
    project.pages = []
    await expect(store.save(project)).rejects.toThrow()
  })
})
