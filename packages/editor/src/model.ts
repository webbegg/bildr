import type { Json, JsonObject } from './types.ts'

/**
 * The `.bildr/` model files as the Data screen's "All model files" (S3) and its JSON tab list them: what
 * kind a path holds, the files grouped by kind, and the files a collection is linked to. Everything is
 * read from the files `model_get` returns (path → parsed JSON), so it holds while the model has problems.
 * The kinds and paths mirror `fileKind` in `@bildr/codegen/model` (`load.ts`), which the package does not export.
 */

export type FileKind = 'project' | 'theme' | 'datasource' | 'layout' | 'module' | 'entity' | 'repository' | 'query' | 'action' | 'state' | 'component' | 'page' | 'fixtures'

/** The kinds in the order "All model files" lists them, with the name its heading uses ("Connections" and "Sample data" are the Data workspace's words). */
const KIND_LABELS: Record<FileKind, string> = {
  project: 'Project',
  theme: 'Theme',
  datasource: 'Connections',
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

const FOLDER_KINDS: Record<string, FileKind> = { entities: 'entity', repositories: 'repository', queries: 'query', actions: 'action', state: 'state', components: 'component', pages: 'page', fixtures: 'fixtures' }

/** The kind of a `.bildr/` model file from its path, or none for the manifest, the cache and anything else (only normalized paths count). */
export const kindOfPath = (path: string): FileKind | undefined => {
  if (path.split('/').some(part => part === '' || part === '.' || part === '..')) return undefined
  if (path === '.bildr/bildr.json') return 'project'
  if (path === '.bildr/theme.json') return 'theme'
  if (/^\.bildr\/datasources\/[^/]+\.json$/.test(path)) return 'datasource'
  if (/^\.bildr\/layouts\/[^/]+\.json$/.test(path)) return 'layout'
  if (/^\.bildr\/modules\/[^/]+\/module\.json$/.test(path)) return 'module'
  const folder = /^\.bildr\/modules\/[^/]+\/([^/]+)\/[^/]+\.json$/.exec(path)?.[1]
  return folder !== undefined && Object.hasOwn(FOLDER_KINDS, folder) ? FOLDER_KINDS[folder] : undefined
}

export const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A short label for a file in a list. */
export const artifactLabel = (file: Json | undefined, path: string): string => {
  if (isObject(file)) {
    for (const key of ['name', 'label', 'id']) {
      const value = file[key]
      if (typeof value === 'string' && value) return value
    }
  }
  return path.split('/').at(-1)!.replace(/\.json$/, '')
}

export interface FileEntry {
  path: string
  label: string
}

export interface FileGroup {
  kind: FileKind
  label: string
  files: FileEntry[]
}

/** The model files by kind (the kinds with no file are left out), each kind's files by path. */
export const groupFiles = (files: Record<string, Json>): FileGroup[] => {
  const paths = Object.keys(files).sort()
  return KIND_ORDER.flatMap((kind) => {
    const listed = paths.filter(path => kindOfPath(path) === kind).map(path => ({ path, label: artifactLabel(files[path], path) }))
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
