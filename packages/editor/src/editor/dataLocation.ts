import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Editor } from './useEditor.ts'

/**
 * Where the Data workspace is (S2): the item selected in its tree and the tab shown for it. A
 * collection has Rows, Fields, Endpoints and JSON; a connection has Endpoints and JSON. The
 * location lives in the URL query (`/data?item=collection:ent_post&tab=fields`), so a deep link
 * or a reload opens the same item on the same tab.
 */
export type DataTab = 'rows' | 'fields' | 'endpoints' | 'json'
export type DataItemKind = 'collection' | 'connection'
export interface DataItem {
  kind: DataItemKind
  id: string
}

export const DATA_TAB_LABELS: Record<DataTab, string> = { rows: 'Rows', fields: 'Fields', endpoints: 'Endpoints', json: 'JSON' }

const TABS: Record<DataItemKind, DataTab[]> = {
  collection: ['rows', 'fields', 'endpoints', 'json'],
  connection: ['endpoints', 'json']
}

/** The tabs an item of this kind has, in order. */
export const tabsOf = (kind: DataItemKind): DataTab[] => TABS[kind]

const isTab = (value: unknown): value is DataTab => typeof value === 'string' && value in DATA_TAB_LABELS

/** What the URL query asks for: the parts that are well formed (anything else is left out, never an error). */
export function parseDataLocation(query: Record<string, unknown>): { item?: DataItem, tab?: DataTab } {
  const found: { item?: DataItem, tab?: DataTab } = {}
  const raw = query.item
  if (typeof raw === 'string') {
    const split = raw.indexOf(':')
    const kind = raw.slice(0, split)
    const id = raw.slice(split + 1)
    if (split > 0 && id && (kind === 'collection' || kind === 'connection')) found.item = { kind, id }
  }
  if (isTab(query.tab)) found.tab = query.tab
  return found
}

/** The URL query that shows `item` on `tab`. */
export const dataLocationQuery = (item: DataItem, tab: DataTab): { item: string, tab: string } => ({ item: `${item.kind}:${item.id}`, tab })

/**
 * Keeps `editor`'s selection and the route's query the same, both ways. The query is read once
 * when the screen opens and again when it changes (Back, Forward, a link); the selection is
 * written once the model is loaded, with `replace` since choosing an item is not a navigation.
 */
export function useDataLocation(editor: Editor): void {
  const route = useRoute()
  const router = useRouter()

  const apply = (query: Record<string, unknown>) => {
    const { item, tab } = parseDataLocation(query)
    if (item?.kind === 'collection') {
      editor.collectionId = item.id
      editor.connectionId = null
    } else if (item) {
      editor.connectionId = item.id
    }
    // The tab shown already (the URL echoes what this editor wrote) is not a choice: a connection's Endpoints must not become a collection's.
    if (tab && tab !== editor.dataTab) editor.dataTab = tab
  }

  const wanted = computed(() => editor.model && editor.dataItem ? dataLocationQuery(editor.dataItem, editor.dataTab) : null)

  const write = () => {
    const query = wanted.value
    if (!query || route.name !== 'data') return
    if (route.query.item === query.item && route.query.tab === query.tab) return
    void router.replace({ query: { ...route.query, ...query } })
  }

  apply(route.query)
  watch(wanted, write, { immediate: true })
  watch(() => route.fullPath, () => {
    if (route.name !== 'data') return
    apply(route.query)
    write()
  })
}
