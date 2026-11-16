/**
 * The Data workspace's tab model (S2): what can be shown (`DataItem`: a collection or a connection)
 * and the tabs each kind has. A collection has Rows, Fields, Endpoints and JSON; a connection has
 * Endpoints and JSON. The state is `editor/dataView.ts`'s and the URL's is `editor/dataLocation.ts`'s.
 */
export const DATA_TABS = ['rows', 'fields', 'endpoints', 'json'] as const
export type DataTab = typeof DATA_TABS[number]
export type DataItemKind = 'collection' | 'connection'
export interface DataItem {
  kind: DataItemKind
  id: string
}

/** The item's key, `collection:<id>` or `connection:<id>`: the tree's item and the URL's `item` are named by it. */
export const dataItemKey = (item: DataItem): string => `${item.kind}:${item.id}`

export const DATA_TAB_LABELS: Record<DataTab, string> = { rows: 'Rows', fields: 'Fields', endpoints: 'Endpoints', json: 'JSON' }

const TABS: Record<DataItemKind, DataTab[]> = {
  collection: ['rows', 'fields', 'endpoints', 'json'],
  connection: ['endpoints', 'json']
}

/** The tabs an item of this kind has, in order. */
export const tabsOf = (kind: DataItemKind): DataTab[] => TABS[kind]

/** Whether `value` names a tab (a list lookup: `constructor` and the other names objects inherit are not tabs). */
export const isDataTab = (value: unknown): value is DataTab => DATA_TABS.some(tab => tab === value)
