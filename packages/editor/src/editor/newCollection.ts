import type { DataSourceFile, Model } from '@bildr/codegen/model'

/**
 * What the New collection dialog (S7) offers and what each choice does, apart from the dialog: where a collection's rows can live
 * in this project, the data source each choice means, and, for the one chosen, whether the collection is made now or a connection
 * dialog finishes it. Nothing is chosen for the user: there is no silent memory source.
 */

export type StorageKind = 'sample' | 'database' | 'rest'

/** The choices a collection is made for now: its rows live in the app's database, or in Sample data (a memory source). REST API needs an endpoint first. */
export type CollectionStorage = { kind: Exclude<StorageKind, 'rest'> }

export const DEFAULT_STORAGE: StorageKind = 'sample'

/** The value of the connection list's "New connection…" entry. */
export const NEW_CONNECTION = '__new__'

export interface StorageOption {
  kind: StorageKind
  label: string
  description: string
}

/** The choices in the order they are shown, each described in one line in the Data words (S2). */
const OPTIONS: readonly StorageOption[] = [
  { kind: 'sample', label: 'Sample data', description: 'Example rows you edit here. The app starts with them; anything it adds while running is lost when it restarts.' },
  { kind: 'database', label: 'Database', description: 'Rows live in your app\'s database. Sample data can still seed them.' },
  { kind: 'rest', label: 'REST API', description: 'Rows are read from an API you connect to.' }
]

/** The data source a choice stores in, when the project has it: the database, or a memory source (none yet: Sample data makes one). */
export function sourceFor(model: Model, kind: CollectionStorage['kind']): DataSourceFile | undefined {
  return model.datasources.find(source => source.kind === (kind === 'database' ? 'sqlite' : 'memory'))
}

/** The choices the project has: a Database only when it has one. */
export function storageOptionsOf(model: Model | null): StorageOption[] {
  return OPTIONS.filter(option => option.kind !== 'database' || (model !== null && sourceFor(model, 'database') !== undefined))
}

/** `kind` while the project still offers it, else the default: a Database chosen in a dialog left open while the database went away. */
export function settleStorage(model: Model | null, kind: StorageKind): StorageKind {
  return storageOptionsOf(model).some(option => option.kind === kind) ? kind : DEFAULT_STORAGE
}

/** The words of a name, as codegen's `camel` and `kebab` read them (`edit/core.ts`). */
const words = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** The `runtimeConfig.datasources.<key>` a source name becomes: two names with one key would share their settings. */
const runtimeKey = (name: string) => words(name).map((word, at) => at ? word[0]!.toUpperCase() + word.slice(1) : word).join('')

/**
 * The name of the memory source made for Sample data when the project has none: "sample", else "sample-2", "sample-3"…
 * The first that is free by the rule of `datasource_create` (`sourceName` in `codegen/src/edit/datasources.ts`): no data source
 * of any kind has the name, and none has the runtime key it makes.
 */
export function sampleSourceName(model: Model): string {
  const free = (name: string) => !model.datasources.some(source => source.name === name || runtimeKey(source.name) === runtimeKey(name))
  let name = 'sample'
  for (let n = 2; !free(name); n++) name = `sample-${n}`
  return name
}

/** The connections to choose from on REST API, and the entry that makes a new one. */
export const connectionChoices = (connections: readonly { id: string, name: string }[]) => [
  ...connections.map(entry => ({ label: entry.name, value: entry.id })),
  { label: 'New connection…', value: NEW_CONNECTION }
]

/** Whether Create can run: it needs a name, except on REST API, where the connection dialog proposes one from the endpoint. */
export const canSubmit = (storage: StorageKind, name: string): boolean => storage === 'rest' || !!name.trim()

/** What Create does with the choice: makes the collection now, or hands the name to the dialog that finishes it. */
export type SubmitOutcome = { kind: 'create', name: string, storage: CollectionStorage }
  | { kind: 'connection', connection: string, name: string }
  | { kind: 'import', name: string }

/** `connection` is the one chosen on REST API: its id, or `NEW_CONNECTION`. */
export const submitOutcome = ({ storage, connection, name }: { storage: StorageKind, connection: string, name: string }): SubmitOutcome => {
  const typed = name.trim()
  if (storage !== 'rest') return { kind: 'create', name: typed, storage: { kind: storage } }
  return connection === NEW_CONNECTION ? { kind: 'import', name: typed } : { kind: 'connection', connection, name: typed }
}
