import { fileKind } from '@bildr/codegen/model'
import type { FileKind as CodegenFileKind } from '@bildr/codegen/model'
import type { Json, JsonObject } from './types.ts'

/**
 * The `.bildr/` model files as the Data screen's "All model files" (S3) and its JSON tab list them: what
 * kind a path holds, the files grouped by kind, and the files a collection is linked to. Everything is
 * read from the files `model_get` returns (path → parsed JSON, and the text of the ones that are not JSON), so it
 * holds while the model has problems. The kind of a path is `fileKind` of `@bildr/codegen/model`, the module's own.
 */

/** The kinds of model file the list names: the codegen's, but for the manifest, which bildr writes and the list leaves out. */
export type FileKind = Exclude<CodegenFileKind, 'manifest'>

/** The kinds in the order "All model files" lists them, with the name its heading uses ("Connections and storage" is the datasources: REST connections, sqlite and memory storage; "Sample data" is the Data workspace's word). */
const KIND_LABELS: Record<FileKind, string> = {
  project: 'Project',
  theme: 'Theme',
  datasource: 'Connections and storage',
  layout: 'Layouts',
  module: 'Modules',
  entity: 'Collections',
  repository: 'Repositories',
  query: 'Queries',
  action: 'Actions',
  state: 'State',
  component: 'Components',
  page: 'Pages',
  fixtures: 'Sample data'
}
const KIND_ORDER = Object.keys(KIND_LABELS) as FileKind[]

/** The kind of a `.bildr/` model file from its path, or none for the manifest, the cache and anything else (only normalized paths count). */
export const kindOfPath = (path: string): FileKind | undefined => {
  const kind = fileKind(path)
  // A name an object inherits (a folder called `constructor`) is not a kind.
  return KIND_ORDER.find(known => known === kind)
}

export const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A short label for a file in a list: its name, or for a query its label (people read it; the name is generated from it), or its id, or its file name. */
export const artifactLabel = (file: Json | undefined, path: string): string => {
  if (isObject(file)) {
    for (const key of kindOfPath(path) === 'query' ? ['label', 'name', 'id'] : ['name', 'label', 'id']) {
      const value = file[key]
      if (typeof value === 'string' && value) return value
    }
  }
  return path.split('/').at(-1)!.replace(/\.json$/, '')
}

export interface FileEntry {
  path: string
  label: string
  /** The file on disk is not valid JSON (listed so it can be opened and fixed). */
  invalid?: true
}

export interface FileGroup {
  kind: FileKind
  label: string
  files: FileEntry[]
}

/** The model files by kind (the kinds with no file are left out), each kind's files by path; `invalid` are the files that are not valid JSON (path → text), listed among them and marked. */
export const groupFiles = (files: Record<string, Json>, invalid: Record<string, string> = {}): FileGroup[] => {
  const paths = [...new Set([...Object.keys(files), ...Object.keys(invalid)])].sort()
  return KIND_ORDER.flatMap((kind) => {
    const listed = paths.filter(path => kindOfPath(path) === kind).map((path): FileEntry => Object.hasOwn(invalid, path) ? { path, label: artifactLabel(undefined, path), invalid: true } : { path, label: artifactLabel(files[path], path) })
    return listed.length ? [{ kind, label: KIND_LABELS[kind], files: listed }] : []
  })
}

const idOf = (file: Json | undefined) => isObject(file) && typeof file.id === 'string' ? file.id : undefined

/**
 * The files a collection (the entity file at `entityPath`) is linked to, its own first: the repository
 * that stores it, its sample data (fixtures) and the queries that read it. The links are the ones the
 * files state (`entity`, `from`), so a file that does not name the collection is not listed.
 */
export const entityFiles = (files: Record<string, Json>, entityPath: string): FileEntry[] => {
  const own: FileEntry = { path: entityPath, label: 'Collection' }
  const id = idOf(files[entityPath])
  if (!id) return [own]
  const linked = (kind: FileKind, field: 'entity' | 'from') => Object.keys(files).sort().filter((path) => {
    const file = files[path]
    return kindOfPath(path) === kind && isObject(file) && file[field] === id
  })
  return [
    own,
    ...linked('repository', 'entity').map(path => ({ path, label: 'Repository' })),
    ...linked('fixtures', 'entity').map(path => ({ path, label: 'Sample data' })),
    ...linked('query', 'from').map(path => ({ path, label: `Query ${artifactLabel(files[path], path)}` }))
  ]
}
