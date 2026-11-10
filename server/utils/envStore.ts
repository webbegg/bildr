import { EnvVarsSchema } from '#shared/env/variables'
import type { EnvVar } from '#shared/env/variables'
import type { KeyValueStorage } from './projectStore'

/**
 * A project's environment variables, one storage item per project
 * (`env:<projectId>`), outside the document and its history. Secret values
 * are stored as given; only the server reads them. Callers hold the project
 * lock (the dispatcher's) around a read-modify-write.
 */
export function createEnvStore(storage: KeyValueStorage) {
  const key = (projectId: string) => `env:${projectId}`

  return {
    async list(projectId: string): Promise<EnvVar[]> {
      return await storage.getItem<EnvVar[]>(key(projectId)) ?? []
    },

    /** Validates names, values and the count before writing; invalid variables throw. */
    async save(projectId: string, vars: EnvVar[]): Promise<void> {
      await storage.setItem(key(projectId), EnvVarsSchema.parse(vars))
    },

    async remove(projectId: string): Promise<void> {
      await storage.removeItem(key(projectId))
    }
  }
}

export type EnvStore = ReturnType<typeof createEnvStore>
