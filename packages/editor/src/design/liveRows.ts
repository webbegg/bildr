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
 * fixtures. The badge says which one the canvas shows, and why when it is the fixtures
 * (a read gives up after `liveRows.timeoutMs`; at most `MAX_ROWS` rows an entity). Rows stay until refreshed:
 * a regenerate, the Refresh button, or a form submitted in preview.
 */

/** The most rows read per entity, whatever page size the route answers with: the canvas shows a sample, not the table. */
export const MAX_ROWS = 500
/** A guard on the requests for one entity (a route that answers a few rows a page would otherwise take hundreds). */
const MAX_REQUESTS = 25

/** Tunables of the read (`timeoutMs`: how long the app has to answer for one entity before the canvas shows its fixtures). */
export const liveRows = { timeoutMs: 8000 }

/** Why the app's rows could not be read for an entity. */
export class ReadFailure extends Error {}

export type DataState = 'live' | 'fixtures' | 'partial'

const isRows = (value: unknown): value is { items: Row[], total?: number } =>
  typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)

/**
 * The rows of a list route (at most `MAX_ROWS`, in as many requests as the route's page size needs), or throws a
 * `ReadFailure` saying why the app can't answer; the whole read has `liveRows.timeoutMs`.
 */
export const fetchRows = async (route: string): Promise<Row[]> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), liveRows.timeoutMs)
  try {
    const rows: Row[] = []
    for (let request = 0; request < MAX_REQUESTS && rows.length < MAX_ROWS; request++) {
      const response = await fetch(`${route}?limit=${MAX_ROWS - rows.length}&offset=${rows.length}`, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: controller.signal })
      if (!response.ok) throw new ReadFailure(`HTTP ${response.status}`)
      const body = await response.json() as unknown
      if (!isRows(body)) throw new ReadFailure('not a page of rows')
      rows.push(...body.items)
      if (!body.items.length || rows.length >= (body.total ?? 0)) break
    }
    return rows.slice(0, MAX_ROWS)
  } catch (error) {
    if (error instanceof ReadFailure) throw error
    throw new ReadFailure(controller.signal.aborted ? `did not answer in time (${Math.round(liveRows.timeoutMs / 1000)} s)` : 'could not be reached')
  } finally {
    clearTimeout(timer)
  }
}

export const createLiveRows = (model: Ref<ProjectModel | null>, needed: Ref<string[]>) => {
  /** Rows read from the app, by entity id. */
  const rows = shallowRef<Record<string, Row[]>>({})
  const failed = ref<string[]>([])
  /** Why each entity in `failed` shows its fixtures. */
  const reasons = ref<Record<string, string>>({})
  const loading = ref(false)
  let generation = 0

  const read = async (entities: string[]) => {
    const current = model.value
    if (!current || !entities.length) return
    const mine = ++generation
    loading.value = true
    const why: Record<string, string> = {}
    const results = await Promise.all(entities.map(async (id) => {
      const route = listRoute(current, id)
      if (!route) {
        why[id] = 'has no list route the app answers'
        return [id, undefined] as const
      }
      try {
        return [id, await fetchRows(route)] as const
      } catch (error) {
        why[id] = error instanceof ReadFailure ? error.message : 'could not be reached'
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
    reasons.value = why
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

  return { rows, failed, reasons, loading, refresh, state, fixtureEntities }
}
