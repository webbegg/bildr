import type { InjectionKey, Ref } from 'vue'
import { dataItemKey } from './dataTabs.ts'
import type { DataArtifact, DataCollection, DataConnection } from '../shared/dataModel.ts'

/**
 * The Data tree's model: which items it lists, in order, for the keys that move along it
 * (`components/data/DataTree.vue`). An item is named by its key (`dataItemKey`), the one the URL uses;
 * All model files (S3), the tree's last entry, is `files`.
 */

/** The key of the "All model files" entry. */
export const FILES_KEY = 'files'

/** The last Import from API request each editor's Data tree answered, so a request made before it mounts (⌘K from the Canvas) still opens the dialog. */
export const answeredImports = new WeakMap<object, number>()

/** A section of Queries or Actions with more items than this has a filter box (S10). */
export const FILTER_FROM = 8

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

/**
 * The items the tree lists, top to bottom: the collections the app stores, then each connection followed by
 * the collections read through it (none while it is collapsed: `collapsed` holds the connection ids), then the
 * queries and the actions (each section as far as its filter lets it), then All model files.
 */
export function treeItems(
  collections: readonly DataCollection[],
  connections: readonly DataConnection[],
  collapsed: ReadonlySet<string>,
  artifacts: { queries: readonly DataArtifact[], actions: readonly DataArtifact[] } = { queries: [], actions: [] },
  filters: ArtifactFilters = { queries: '', actions: '' }
): TreeItem[] {
  const stored = collections.filter(entry => entry.kind !== 'rest').map(entry => ({ key: dataItemKey({ kind: 'collection', id: entry.id }), expandable: false, open: false }))
  const folders = connections.flatMap((connection) => {
    const key = dataItemKey({ kind: 'connection', id: connection.id })
    const open = !collapsed.has(connection.id)
    const read = open ? collections.filter(entry => entry.datasource === connection.id).map(entry => ({ key: dataItemKey({ kind: 'collection', id: entry.id }), parent: key, expandable: false, open: false })) : []
    return [{ key, expandable: true, open }, ...read]
  })
  const section = (kind: 'query' | 'action', items: readonly DataArtifact[], filter: string) =>
    filterArtifacts(items, filter).map(item => ({ key: dataItemKey({ kind, id: item.id }), expandable: false, open: false }))
  return [
    ...stored,
    ...folders,
    ...section('query', artifacts.queries, filters.queries),
    ...section('action', artifacts.actions, filters.actions),
    { key: FILES_KEY, expandable: false, open: false }
  ]
}

/** The key of the one item that is a tab stop (`tabindex="0"`), given to the tree's items. */
export const TREE_STOP: InjectionKey<Ref<string>> = Symbol('data-tree-stop')
