import type { KeyValueStorage } from './projectStore'

/**
 * Nitro's fs driver writes files in place (truncate, then write), so a read
 * racing a write of the same key sees no value: open editors and published
 * apps then get a spurious "not found". This wrapper keeps the last value
 * this process wrote or read for each key and answers reads from it, while
 * writes still reach disk in per-key order. bildr runs as one process, so
 * the copy is always current. Values are cloned in and out, like a driver.
 * A failed disk write rolls the copy back, so a failed action has no effect.
 * Edits made to `.data` by hand need a server restart to be seen.
 */
export function createConsistentStorage(inner: KeyValueStorage): KeyValueStorage {
  // A null value marks a key known to be absent (removed, or missing on disk).
  const known = new Map<string, unknown>()
  const writes = new Map<string, Promise<unknown>>()

  function queue(key: string, task: () => Promise<void>): Promise<void> {
    const next = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
    writes.set(key, next)
    void next.catch(() => {}).finally(() => {
      if (writes.get(key) === next) writes.delete(key)
    })
    return next
  }

  /** Records `value` for `key` now, persists it in order, and undoes the record if persisting fails. */
  function remember(key: string, value: unknown, persist: () => Promise<void>): Promise<void> {
    const had = known.has(key)
    const previous = known.get(key)
    known.set(key, value)
    return queue(key, persist).catch((error) => {
      // Only roll back if no later write has replaced this one.
      if (known.get(key) === value) {
        if (had) known.set(key, previous)
        else known.delete(key)
      }
      throw error
    })
  }

  return {
    async getItem<T = unknown>(key: string): Promise<T | null> {
      if (!known.has(key)) {
        const value = await inner.getItem(key)
        // A write may have landed while we were reading; it wins.
        if (!known.has(key)) known.set(key, value ?? null)
      }
      const value = known.get(key)
      return value === null || value === undefined ? null : structuredClone(value) as T
    },

    setItem(key: string, value: unknown): Promise<void> {
      // unstorage treats an undefined value as a removal.
      if (value === undefined) return remember(key, null, () => inner.removeItem(key))
      const copy = structuredClone(value)
      return remember(key, copy, () => inner.setItem(key, copy))
    },

    removeItem(key: string): Promise<void> {
      return remember(key, null, () => inner.removeItem(key))
    },

    async getKeys(base?: string): Promise<string[]> {
      const keys = new Set(await inner.getKeys(base))
      for (const [key, value] of known) {
        if (base && !key.startsWith(base)) continue
        if (value === null) keys.delete(key)
        else keys.add(key)
      }
      return [...keys]
    }
  }
}
