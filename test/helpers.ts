import type { KeyValueStorage } from '../server/utils/projectStore'

/** An in-memory stand-in for unstorage that copies values like a real driver. */
export function memoryStorage(): KeyValueStorage {
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
