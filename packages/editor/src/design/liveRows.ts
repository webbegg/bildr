import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import type { Model as ProjectModel } from '@bildr/codegen/model'
import { listRoute } from '@bildr/codegen/query'
import type { Row } from '@bildr/codegen/query'

/**
 * The app's rows for the canvas (P5, V4, Q12). For each entity a page's queries
 * read, the rows come from the app's generated list route (`listRoute`, paged
 * the way its client collection reads it); when the app can't answer (not
 * running, no exposed list, an error) that entity falls back to the model's
 * fixtures. `badge` says which one the canvas shows. Rows stay until refreshed:
 * a regenerate, the Refresh button, or a form submitted in preview.
 */

const PAGE = 500
/** The most rows read per entity: the canvas shows a sample, not the table. */
const MAX_PAGES = 4

export type DataState = 'live' | 'fixtures' | 'partial'

const isRows = (value: unknown): value is { items: Row[], total?: number } =>
  typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)

/** Every row of a list route (up to `MAX_PAGES` pages), or throws when the app can't answer. */
export const fetchRows = async (route: string): Promise<Row[]> => {
  const rows: Row[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(`${route}?limit=${PAGE}&offset=${rows.length}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`)
    const body = await response.json() as unknown
    if (!isRows(body)) throw new Error(`${route}: not a page of rows`)
    rows.push(...body.items)
    if (!body.items.length || rows.length >= (body.total ?? 0)) break
  }
  return rows
}

export const createLiveRows = (model: Ref<ProjectModel | null>, needed: Ref<string[]>) => {
  /** Rows read from the app, by entity id. */
  const rows = shallowRef<Record<string, Row[]>>({})
  const failed = ref<string[]>([])
  const loading = ref(false)
  let generation = 0

  const read = async (entities: string[]) => {
    const current = model.value
    if (!current || !entities.length) return
    const mine = ++generation
    loading.value = true
    const results = await Promise.all(entities.map(async (id) => {
      const route = listRoute(current, id)
      if (!route) return [id, undefined] as const
      try {
        return [id, await fetchRows(route)] as const
      } catch {
        return [id, undefined] as const
      }
    }))
    // A newer read supersedes this one (a refresh while the first was still waiting).
    if (mine !== generation) return
    const next = { ...rows.value }
    for (const [id, found] of results) {
      if (found) next[id] = found
      else Reflect.deleteProperty(next, id)
    }
    rows.value = next
    failed.value = results.filter(([, found]) => !found).map(([id]) => id)
    loading.value = false
  }

  /** Reads what the canvas needs again. */
  const refresh = () => read(needed.value)

  // Entities the canvas starts to need are read once; rows already read stay until a refresh.
  watch(needed, (now, before = []) => {
    const added = now.filter(id => !before.includes(id) && !(id in rows.value))
    if (added.length) void read(added)
  }, { immediate: true })

  const state = computed<DataState | null>(() => {
    if (!needed.value.length) return null
    const live = needed.value.filter(id => id in rows.value).length
    return live === 0 ? 'fixtures' : live === needed.value.length ? 'live' : 'partial'
  })
  const fixtureEntities = computed(() => needed.value.filter(id => !(id in rows.value)))

  return { rows, failed, loading, refresh, state, fixtureEntities }
}
