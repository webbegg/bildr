import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { StateFile } from '@bildr/codegen/model'
import { apisOf } from '../shared/simpleData.ts'
import type { SimpleApi } from '../shared/simpleData.ts'
import { stateById } from '../shared/stateModel.ts'
import { plainCopy } from './draftJson.ts'
import { dataLocationQuery, filesLocationQuery, migrationsLocationQuery } from './dataLocation.ts'
import { ADVANCED_PATH, needsAdvanced } from './dataRoutes.ts'
import type { Editor } from './useEditor.ts'
import { openView } from './views.ts'

/**
 * Which store or API the simple Data section (simple data, S2) shows, and how that lives with the URL and with the unsaved edits:
 *
 * - **One item at a time**, a store (`kind: 'state'`) or an API (`kind: 'api'`); `creating` shows the New store form instead of either.
 * - **The URL says it** (`/data?item=state:st_cart`, `item=api:ds_shop`): read once when the screen opens and again when it changes
 *   (Back, a link), written with `replace` once the model is loaded, since choosing is not a navigation.
 * - **Every move goes through the editor's `leaveData`**, so edits that are not saved are asked about first and the move is made only
 *   when the user discards them; a move declined puts the URL back.
 * - **What the model no longer has is not shown** (a store deleted here or elsewhere, a link older than the last change): nothing is,
 *   unless its form has edits that are not saved: then the form stays, on the store as it was (`removed`), so the edits are not
 *   dropped silently. It says so (`SimpleStoreForm`), and goes with the edits, when they are discarded or another choice is made.
 */

export interface SimpleChoice {
  kind: 'state' | 'api'
  id: string
}

const keyOf = (choice: SimpleChoice | null): string | undefined => choice ? `${choice.kind}:${choice.id}` : undefined

const ITEM = /^(state|api):(.+)$/

/** The store or API a `?item=` names; null for anything else (the simple section knows no other). */
export function parseSimpleItem(query: Record<string, unknown>): SimpleChoice | null {
  const found = typeof query.item === 'string' ? ITEM.exec(query.item) : null
  return found ? { kind: found[1] as SimpleChoice['kind'], id: found[2]! } : null
}

export function useSimpleData(editor: Editor) {
  const route = useRoute()
  const router = useRouter()

  const chosen = ref<SimpleChoice | null>(parseSimpleItem(route.query))
  const creating = ref(false)

  const stores = computed<StateFile[]>(() => editor.states.map(item => editor.model ? stateById(editor.model, item.id) : undefined).filter((state): state is StateFile => !!state))
  const apis = computed<SimpleApi[]>(() => editor.model ? apisOf(editor.model) : [])

  /** The store the model has, when a store is chosen. */
  const live = computed(() => chosen.value?.kind === 'state' && !creating.value ? stores.value.find(entry => entry.id === chosen.value!.id) ?? null : null)
  /** The chosen store, as it was, when the model lost it while its form had edits (`editor.dataDirty`): the form keeps them. */
  const gone = shallowRef<StateFile | null>(null)
  // Read as it goes, before the form that holds the edits is gone with the store.
  watch(live, (now, before) => {
    gone.value = !now && before && editor.dataDirty !== null ? plainCopy(before) : null
  }, { flush: 'sync' })
  // The edits were discarded: nothing is held any more.
  watch(() => editor.dataDirty, (dirty) => {
    if (dirty === null) gone.value = null
  })
  /** The store shown, when a store is chosen and the model has it, or had it and the form has edits. */
  const store = computed<StateFile | null>(() => live.value ?? (chosen.value?.kind === 'state' && !creating.value && gone.value?.id === chosen.value.id ? gone.value : null))
  /** Whether the store shown is one the model no longer has. */
  const removed = computed(() => !live.value && store.value !== null)
  /** The API shown, when an API is chosen and the model has it. */
  const api = computed(() => chosen.value?.kind === 'api' && !creating.value ? apis.value.find(entry => entry.id === chosen.value!.id) ?? null : null)
  /** The choice that is shown: what is chosen and the model has. */
  const shown = computed<SimpleChoice | null>(() => store.value ? { kind: 'state', id: store.value.id } : api.value ? { kind: 'api', id: api.value.id } : null)

  /** Shows `choice` (null: nothing), after asking about unsaved edits. Resolves whether it moved. */
  const choose = (choice: SimpleChoice | null): Promise<boolean> =>
    editor.leaveData(() => {
      chosen.value = choice
      creating.value = false
      gone.value = null
    }, keyOf(choice) !== keyOf(shown.value) || creating.value)

  /** Shows the New store form, after asking about unsaved edits. */
  const startCreate = (): Promise<boolean> =>
    editor.leaveData(() => {
      creating.value = true
      chosen.value = null
      gone.value = null
    }, !creating.value)

  /** Shows the store just made. */
  const created = (id: string) => {
    chosen.value = { kind: 'state', id }
    creating.value = false
  }

  // ── The URL ────────────────────────────────────────────────────────────

  const write = () => {
    // A model that is not loaded yet can't say a link is stale: the URL is kept until it is.
    if (route.name !== 'data' || !editor.model || creating.value) return
    const item = keyOf(shown.value)
    if (route.query.item === item) return
    const { item: _item, ...rest } = route.query
    void router.replace({ query: item ? { ...rest, item } : rest })
  }
  watch([shown, () => editor.model !== null, creating], write, { immediate: true })
  watch(() => route.fullPath, () => {
    if (route.name !== 'data') return
    // The route's own redirect (`router.ts`) runs when the screen is entered: an old link typed or followed while it is open (a change of query only) is sent to the workspace here.
    if (needsAdvanced(route.query)) {
      void router.replace({ path: ADVANCED_PATH, query: route.query, hash: route.hash })
      return
    }
    const next = parseSimpleItem(route.query)
    if (keyOf(next) === keyOf(chosen.value)) return
    // With edits that are not saved the move waits for the user: the URL follows once it moves, or goes back when it was declined.
    void choose(next)
  })
  watch(() => editor.leaveDeclined, write)

  return { chosen, creating, stores, apis, store, removed, api, shown, choose, startCreate, created }
}

/**
 * What the simple section does when something asks for an item only the workspace has (a "Used in" link to an action or a query, the
 * Checks screen's link to a collection): the editor chose it (`openItem`), and the simple section has no place to show it, so the
 * workspace is opened on it. Only a change of what is chosen is a request: the choices a new editor starts with are none (an item the
 * simple section is opened with is the router's to send, `dataRouteOf`). The same for a dialog only the workspace has, which ⌘K asks for
 * (New collection, Import from URL): the request goes with the screen, which opens it.
 */
export function useAdvancedHandoff(editor: Editor): void {
  const router = useRouter()
  watch(() => [editor.dataMigrations, editor.dataFiles, editor.collectionId, editor.connectionId, editor.queryId, editor.actionId], () => {
    const query = editor.dataMigrations
      ? migrationsLocationQuery()
      : editor.dataFiles
        ? filesLocationQuery(editor.dataFile)
        : editor.dataItem ? dataLocationQuery(editor.dataItem, editor.dataTab) : {}
    void router.push({ path: ADVANCED_PATH, query })
  })
  watch(() => editor.dataRequest, (request) => {
    if (request) openView('data', { dataRequest: request })
  })
}
