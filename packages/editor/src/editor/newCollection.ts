import type { DataSourceFile, Model } from '@bildr/codegen/model'

/**
 * What the New collection dialog (S7) offers and what each choice does, apart from the dialog: where a collection's rows can live
 * in this project, the data source each choice means, and, for the one chosen, whether the collection is made now or a connection
 * dialog finishes it. Nothing is chosen for the user: there is no silent memory source.
 */

export type StorageKind = 'sample' | 'database' | 'rest'

/** Where the rows of a collection made now live: the app's database, or Sample data (a memory source). */
export type CollectionStorage = { kind: 'sample' } | { kind: 'database' }

export const DEFAULT_STORAGE: StorageKind = 'sample'

/** The name of the memory source made for Sample data when the project has none. */
export const SAMPLE_SOURCE_NAME = 'sample'

export interface StorageOption {
  kind: StorageKind
  label: string
  description: string
}

/** What the app does with a memory source: it starts with the rows edited here and keeps its own changes only while the server runs. */
const OPTIONS: readonly StorageOption[] = [
  { kind: 'sample', label: 'Sample data', description: 'Rows you edit here. The app starts with them and keeps its own changes only until it restarts.' },
  { kind: 'database', label: 'Database', description: 'Rows live in your app\'s database.' },
  { kind: 'rest', label: 'REST API', description: 'Rows are read from an API you connect to.' }
]

/** The choices the project has: a Database only when it has one. */
export function storageOptionsOf(model: Model | null): StorageOption[] {
  return OPTIONS.filter(option => option.kind !== 'database' || (model !== null && storedIn(model, 'database') !== undefined))
}

/** The data source a choice stores in, when the project has it: the database, or a memory source (none yet: Sample data makes one). */
export function storedIn(model: Model, kind: 'sample' | 'database'): DataSourceFile | undefined {
  return model.datasources.find(source => source.kind === (kind === 'database' ? 'sqlite' : 'memory'))
}

/** What Create does with the choice: makes the collection now, or hands the name to the dialog that finishes it. */
export type NextStep = { kind: 'create', name: string, storage: CollectionStorage }
  | { kind: 'connection', connection: string, name: string }
  | { kind: 'import', name: string }

/** `connection` is the one chosen on REST API, null for a new connection. */
export const nextStep = ({ storage, connection, name }: { storage: StorageKind, connection: string | null, name: string }): NextStep => {
  const typed = name.trim()
  if (storage !== 'rest') return { kind: 'create', name: typed, storage: { kind: storage } }
  return connection ? { kind: 'connection', connection, name: typed } : { kind: 'import', name: typed }
}
