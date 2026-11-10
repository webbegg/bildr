import { LibraryThemeSchema } from '#shared/design/library'
import type { LibraryTheme } from '#shared/design/library'
import type { KeyValueStorage } from './projectStore'

const PREFIX = 'themes:'

/** One write queue per storage: library writes are checked against the whole library (names, the cap). */
const queues = new WeakMap<KeyValueStorage, Promise<unknown>>()

/**
 * The theme library, one storage item per theme (`themes:<id>`), outside
 * every project, its history and its change events. Read-modify-writes go
 * through `transaction`, since the dispatcher's lock is per project.
 */
export function createThemeStore(storage: KeyValueStorage) {
  return {
    /** Oldest first; items that no longer parse are left out. */
    async list(): Promise<LibraryTheme[]> {
      const keys = await storage.getKeys(PREFIX)
      const items = await Promise.all(keys.map(k => storage.getItem<LibraryTheme>(k)))
      return items
        .flatMap((item) => {
          const parsed = LibraryThemeSchema.safeParse(item)
          return parsed.success ? [parsed.data] : []
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
    },

    /** Validates the entry before writing; an invalid one throws. */
    async save(entry: LibraryTheme): Promise<void> {
      await storage.setItem(PREFIX + entry.id, LibraryThemeSchema.parse(entry))
    },

    async remove(id: string): Promise<void> {
      await storage.removeItem(PREFIX + id)
    },

    /** Runs `task` after every earlier library transaction on this storage has settled. */
    transaction<T>(task: () => Promise<T>): Promise<T> {
      const next = (queues.get(storage) ?? Promise.resolve()).catch(() => {}).then(task)
      queues.set(storage, next)
      return next
    }
  }
}

export type ThemeStore = ReturnType<typeof createThemeStore>
