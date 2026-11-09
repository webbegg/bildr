import type { DataRecord } from '#shared/data/records'
import type { KeyValueStorage } from './projectStore'

/**
 * Collection records, one storage item per collection
 * (`records:<projectId>:<collectionId>`), in creation order. Callers hold
 * the project lock (the dispatcher's) around a read-modify-write.
 */
export function createRecordStore(storage: KeyValueStorage) {
  const key = (projectId: string, collectionId: string) => `records:${projectId}:${collectionId}`

  return {
    async list(projectId: string, collectionId: string): Promise<DataRecord[]> {
      return await storage.getItem<DataRecord[]>(key(projectId, collectionId)) ?? []
    },

    async save(projectId: string, collectionId: string, records: DataRecord[]): Promise<void> {
      await storage.setItem(key(projectId, collectionId), records)
    }
  }
}

export type RecordStore = ReturnType<typeof createRecordStore>
