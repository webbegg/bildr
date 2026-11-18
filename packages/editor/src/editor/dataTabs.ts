/**
 * The Data workspace's tab model (S2, S10): what can be shown (`DataItem`: a collection, a connection, a query or
 * an action) and the tabs each kind has. A collection has Rows, Fields, Endpoints, Used in and JSON; a connection has
 * Endpoints and JSON; a query has Results, Definition, Used in and JSON; an action has Overview, Steps, Used in and JSON; a state
 * (B2) has Fields, Used in and JSON.
 * The state is `editor/dataView.ts`'s and the URL's is `editor/dataLocation.ts`'s.
 */
export const DATA_TABS = ['rows', 'fields', 'endpoints', 'results', 'definition', 'overview', 'steps', 'used', 'json'] as const
export type DataTab = typeof DATA_TABS[number]
export type DataItemKind = 'collection' | 'connection' | 'query' | 'action' | 'state'
export interface DataItem {
  kind: DataItemKind
  id: string
}

/** What the workspace shows in place of the item (S3, S6): All model files, or the pending migration; null when it shows the item. The names are the tree's keys of those entries (`FILES_KEY`, `MIGRATIONS_KEY`). */
export type DataSpecial = 'files' | 'migrations'

/** The item's key, `collection:<id>`, `connection:<id>`, `query:<id>`, `action:<id>` or `state:<id>`: the tree's item and the URL's `item` are named by it. */
export const dataItemKey = (item: { kind: string, id: string }): string => `${item.kind}:${item.id}`

/** Whether `value` names a kind of item (a list lookup: `constructor` and the other names objects inherit are not kinds). */
export const isDataItemKind = (value: unknown): value is DataItemKind => value === 'collection' || value === 'connection' || value === 'query' || value === 'action' || value === 'state'

export const DATA_TAB_LABELS: Record<DataTab, string> = {
  rows: 'Rows',
  fields: 'Fields',
  endpoints: 'Endpoints',
  results: 'Results',
  definition: 'Definition',
  overview: 'Overview',
  steps: 'Steps',
  used: 'Used in',
  json: 'JSON'
}

const TABS: Record<DataItemKind, DataTab[]> = {
  collection: ['rows', 'fields', 'endpoints', 'used', 'json'],
  connection: ['endpoints', 'json'],
  query: ['results', 'definition', 'used', 'json'],
  action: ['overview', 'steps', 'used', 'json'],
  state: ['fields', 'used', 'json']
}

/** The tabs an item of this kind has, in order. */
export const tabsOf = (kind: DataItemKind): DataTab[] => TABS[kind]

/** Whether `value` names a tab (a list lookup: `constructor` and the other names objects inherit are not tabs). */
export const isDataTab = (value: unknown): value is DataTab => DATA_TABS.some(tab => tab === value)
