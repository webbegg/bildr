import { ProjectSchema } from '#shared/document/schema'
import type { Project, ProjectSummary } from '#shared/document/schema'

/** The subset of unstorage's `Storage` the stores use, so tests can pass a fake. */
export interface KeyValueStorage {
  getItem: <T = unknown>(key: string) => Promise<T | null>
  setItem: (key: string, value: unknown) => Promise<void>
  removeItem: (key: string) => Promise<void>
  getKeys: (base?: string) => Promise<string[]>
}

const PREFIX = 'projects:'

export function createProjectStore(storage: KeyValueStorage) {
  async function all(): Promise<Project[]> {
    const keys = await storage.getKeys(PREFIX)
    const projects = await Promise.all(keys.map(key => storage.getItem<Project>(key)))
    return projects.filter((p): p is Project => p !== null)
  }

  return {
    async list(): Promise<ProjectSummary[]> {
      return (await all())
        .map(({ id, name, slug, version, updatedAt }) => ({ id, name, slug, version, updatedAt }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async get(id: string): Promise<Project | undefined> {
      return (await storage.getItem<Project>(PREFIX + id)) ?? undefined
    },

    async getBySlug(slug: string): Promise<Project | undefined> {
      return (await all()).find(p => p.slug === slug)
    },

    /** Validates the whole document before writing; an invalid one throws. */
    async save(project: Project): Promise<void> {
      await storage.setItem(PREFIX + project.id, ProjectSchema.parse(project))
    },

    async remove(id: string): Promise<void> {
      await storage.removeItem(PREFIX + id)
    }
  }
}

export type ProjectStore = ReturnType<typeof createProjectStore>
