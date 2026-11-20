import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dataItemKey, isDataItemKind, isDataTab } from './dataTabs.ts'
import type { DataItem, DataTab } from './dataTabs.ts'
import type { Editor } from './useEditor.ts'

/**
 * Where the Data workspace is (S2) in the URL query (`/data/advanced?item=collection:ent_post&tab=fields`, or `item=query:q_x`,
 * `item=action:act_x`, `item=state:st_x`): the item selected in its tree and the tab shown for it, so a deep link or a reload opens the same item on
 * the same tab. All model files (S3) is `?item=files`, with the file chosen in it as `&file=<path>` (a path that
 * is typed is in it once the file is saved, so a reload shows what the URL says). The pending migration (S6) is `?item=migrations`:
 * the plan is shown in the workspace (`/migrations` redirects there, as an old `/data` link to any of these does: `dataRoutes.ts`). The
 * tab model (which tabs an item has) is `editor/dataTabs.ts`.
 */

/** What the URL query asks for. */
export interface DataLocation {
  item?: DataItem
  tab?: DataTab
  files?: true
  file?: string
  migrations?: true
}

/** The parts of `query` that are well formed (anything else is left out, never an error). */
export function parseDataLocation(query: Record<string, unknown>): DataLocation {
  const found: DataLocation = {}
  const raw = query.item
  if (raw === 'migrations') return { migrations: true }
  if (raw === 'files') {
    found.files = true
    if (typeof query.file === 'string' && query.file.startsWith('.bildr/')) found.file = query.file
    return found
  }
  if (typeof raw === 'string') {
    const split = raw.indexOf(':')
    const kind = raw.slice(0, split)
    const id = raw.slice(split + 1)
    if (split > 0 && id && isDataItemKind(kind)) found.item = { kind, id }
  }
  if (isDataTab(query.tab)) found.tab = query.tab
  return found
}

/** The URL query that shows `item` on `tab`. */
export const dataLocationQuery = (item: DataItem, tab: DataTab): { item: string, tab: string } => ({ item: dataItemKey(item), tab })

/** The URL query that shows All model files, on `file` when one is chosen. */
export const filesLocationQuery = (file: string | null): { item: 'files', file?: string } => file ? { item: 'files', file } : { item: 'files' }

/** The URL query that shows the pending migration. */
export const migrationsLocationQuery = (): { item: 'migrations' } => ({ item: 'migrations' })

/**
 * Keeps `editor`'s selection and the route's query the same, both ways. The query is read once
 * when the screen opens and again when it changes (Back, Forward, a link); the selection is
 * written once the model is loaded (All model files needs no model: it is how a broken one is fixed),
 * with `replace` since choosing an item is not a navigation.
 */
export function useDataLocation(editor: Editor): void {
  const route = useRoute()
  const router = useRouter()

  const apply = (query: Record<string, unknown>) => {
    const { item, tab, files, file, migrations } = parseDataLocation(query)
    if (migrations) {
      editor.dataMigrations = true
      return
    }
    if (files) {
      editor.dataFiles = true
      editor.dataFile = file ?? null
      return
    }
    if (item?.kind === 'collection') {
      editor.collectionId = item.id
      editor.connectionId = null
    } else if (item?.kind === 'connection') {
      editor.connectionId = item.id
    } else if (item?.kind === 'query') {
      editor.queryId = item.id
    } else if (item?.kind === 'action') {
      editor.actionId = item.id
    } else if (item) {
      editor.stateId = item.id
    }
    // The tab shown already (the URL echoes what this editor wrote) is not a choice: a connection's Endpoints must not become a collection's.
    if (tab && tab !== editor.dataTab) editor.dataTab = tab
  }

  const wanted = computed<Record<string, string> | null>(() => editor.dataMigrations
    ? migrationsLocationQuery()
    : editor.dataFiles
      ? filesLocationQuery(editor.dataFile)
      : editor.model && editor.dataItem ? dataLocationQuery(editor.dataItem, editor.dataTab) : null)

  const write = () => {
    const query = wanted.value
    if (!query || route.name !== 'data-advanced') return
    if (route.query.item === query.item && route.query.tab === query.tab && route.query.file === query.file) return
    // A tab and a file belong to the item the query names: the other's are dropped.
    const { tab: _tab, file: _file, ...rest } = route.query
    void router.replace({ query: { ...rest, ...query } })
  }

  apply(route.query)
  watch(wanted, write, { immediate: true })
  watch(() => route.fullPath, () => {
    if (route.name !== 'data-advanced') return
    apply(route.query)
    // With edits that are not saved the move waits for the user: the URL follows the screen once it moves (`wanted`), or goes back when it was declined.
    if (editor.dataDirty === null) write()
  })
  watch(() => editor.leaveDeclined, write)
}
