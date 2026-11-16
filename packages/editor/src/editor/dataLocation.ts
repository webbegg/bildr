import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dataItemKey, isDataTab } from './dataTabs.ts'
import type { DataItem, DataTab } from './dataTabs.ts'
import type { Editor } from './useEditor.ts'

/**
 * Where the Data workspace is (S2) in the URL query (`/data?item=collection:ent_post&tab=fields`): the
 * item selected in its tree and the tab shown for it, so a deep link or a reload opens the same item on
 * the same tab. The tab model (which tabs an item has) is `editor/dataTabs.ts`.
 */

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
  if (isDataTab(query.tab)) found.tab = query.tab
  return found
}

/** The URL query that shows `item` on `tab`. */
export const dataLocationQuery = (item: DataItem, tab: DataTab): { item: string, tab: string } => ({ item: dataItemKey(item), tab })

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
