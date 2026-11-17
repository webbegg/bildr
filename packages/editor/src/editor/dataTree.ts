import type { InjectionKey, Ref } from 'vue'
import { dataItemKey } from './dataTabs.ts'
import type { DataSpecial } from './dataTabs.ts'
import type { ArtifactKind } from '../shared/dataArtifacts.ts'
import type { DataArtifact, DataCollection, DataConnection } from '../shared/dataModel.ts'

/**
 * The Data tree's model: which items it lists, in order, for the keys that move along it
 * (`components/data/DataTree.vue`). An item is named by its key (`dataItemKey`), the one the URL uses;
 * All model files (S3), the tree's last entry, is `files`.
 */

/** The key of the "All model files" entry. */
export const FILES_KEY = 'files' satisfies DataSpecial

/** The key of the Migrations entry (S6), which the tree lists only while a plan is pending. */
export const MIGRATIONS_KEY = 'migrations' satisfies DataSpecial

/** The `seq` of the last dialog request (`editor.dataRequest`) each editor's Data tree answered, so a request made before it mounts (⌘K from the Canvas) still opens its dialog, once. */
export const answeredDataRequests = new WeakMap<object, number>()

/** A section of Queries or Actions with more items than this has a filter box (S10). */
export const FILTER_FROM = 8

/** The localStorage key of the sections the user folded (Queries, Actions): a preference of the editor, kept across reloads. */
export const FOLDED_KEY = 'bildr:data-folded-sections'

/** The sections remembered as folded; none when nothing was remembered or what was is not a list of sections. */
export function storedFolded(): Set<ArtifactKind> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.filter((kind): kind is ArtifactKind => kind === 'query' || kind === 'action') : [])
  } catch {
    return new Set()
  }
}

export const storeFolded = (folded: ReadonlySet<ArtifactKind>): void => localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]))

export interface TreeItem {
  key: string
  /** The key of the connection a collection is listed under. */
  parent?: string
  /** A connection: it folds its collections. */
  expandable: boolean
  /** An expandable item's state. */
  open: boolean
}

/** The text each Queries and Actions section is filtered by (`''`: all of it). */
export interface ArtifactFilters {
  queries: string
  actions: string
}

/** The items whose label, name or collection contain `filter`, ignoring case; an empty filter keeps them all. */
export function filterArtifacts(items: readonly DataArtifact[], filter: string): DataArtifact[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return [...items]
  return items.filter(item => [item.label, item.name, item.id, item.collectionName].some(text => text.toLowerCase().includes(needle)))
}

/** What the tree lists its items from (`treeItems`). */
export interface TreeSource {
  collections: readonly DataCollection[]
  connections: readonly DataConnection[]
  /** The ids of the connections folded. */
  collapsed: ReadonlySet<string>
  artifacts?: { queries: readonly DataArtifact[], actions: readonly DataArtifact[] }
  filters?: ArtifactFilters
  /** The sections folded (Queries, Actions). */
  folded?: ReadonlySet<ArtifactKind>
  /** Whether a migration plan is pending (S6): Migrations is listed. */
  migrations?: boolean
}

/**
 * The items the tree lists, top to bottom: the collections the app stores, then each connection followed by
 * the collections read through it (none while it is collapsed), then the queries and the actions (each section as far as its
 * filter lets it, and none of a section that is folded), then Migrations when a plan is pending (S6), then All model files.
 */
export function treeItems({ collections, connections, collapsed, artifacts = { queries: [], actions: [] }, filters = { queries: '', actions: '' }, folded = new Set(), migrations = false }: TreeSource): TreeItem[] {
  const stored = collections.filter(entry => entry.kind !== 'rest').map(entry => ({ key: dataItemKey({ kind: 'collection', id: entry.id }), expandable: false, open: false }))
  const folders = connections.flatMap((connection) => {
    const key = dataItemKey({ kind: 'connection', id: connection.id })
    const open = !collapsed.has(connection.id)
    const read = open ? collections.filter(entry => entry.datasource === connection.id).map(entry => ({ key: dataItemKey({ kind: 'collection', id: entry.id }), parent: key, expandable: false, open: false })) : []
    return [{ key, expandable: true, open }, ...read]
  })
  const section = (kind: ArtifactKind, items: readonly DataArtifact[], filter: string) =>
    (folded.has(kind) ? [] : filterArtifacts(items, filter)).map(item => ({ key: dataItemKey({ kind, id: item.id }), expandable: false, open: false }))
  return [
    ...stored,
    ...folders,
    ...section('query', artifacts.queries, filters.queries),
    ...section('action', artifacts.actions, filters.actions),
    ...(migrations ? [{ key: MIGRATIONS_KEY, expandable: false, open: false }] : []),
    { key: FILES_KEY, expandable: false, open: false }
  ]
}

/** The key of the one item that is a tab stop (`tabindex="0"`), given to the tree's items. */
export const TREE_STOP: InjectionKey<Ref<string>> = Symbol('data-tree-stop')
