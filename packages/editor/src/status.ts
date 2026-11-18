import { computed, inject, markRaw, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { Model } from '@bildr/codegen/model'
import { callAction, errorMessage, sessionEnded, subscribeEvents } from './api.ts'
import type { HealthReport, PendingMigration } from './types.ts'

/** How often health and the pending migration are re-read while the page is visible: the module regenerates on its own after a save. */
export const POLL_MS = 3000

/** The project status every screen shares: the Health report, the pending migration plan and, for the screens that need it, the model. */
export interface Status {
  health: Ref<HealthReport | null>
  /**
   * The model the project has now, when it loads (null while it is not read yet, or it does not load). Not read by the shell's polling: a screen that
   * needs it asks for it with `refreshModel` (the Checks screen does, each time the report changes). It is raw (`markRaw`: nothing watches inside it),
   * and only replaced when what the module answers is a different model, so what is computed from it (`findingTargets`) is computed once for it.
   */
  model: Ref<Model | null>
  /** Reads the model again. Answers that arrive out of order do not count: the one asked for last is the one kept. */
  refreshModel: () => Promise<void>
  healthError: Ref<string | null>
  pending: Ref<PendingMigration | null>
  pendingError: Ref<string | null>
  /** Whether the project has an app database (V7); false means no plan is offered (`plan` is null), whatever is on file. True until known. */
  database: Ref<boolean>
  /** The plan that waits for confirmation, when the project has a database to run it on (S6, V7): the one accessor of "the plan" (what the banners and the Data tree's Migrations entry are shown for). */
  plan: ComputedRef<PendingMigration | null>
  /** Whether the Data workspace shows the plan itself, a collection's banner or the Migrations item (`editor.planShown`): the global banner says nothing more then. False while no Data screen is open. */
  planShown: ComputedRef<boolean>
  /** The Data screen says where its `planShown` is, while it is open; returns the call that withdraws it. */
  showPlanFrom: (shown: Ref<boolean>) => () => void
  refreshHealth: () => Promise<void>
  refreshPending: () => Promise<void>
  refresh: () => Promise<void>
}

export const STATUS_KEY: InjectionKey<Status> = Symbol('bildr-status')

export const createStatus = (): Status => {
  const health = ref<HealthReport | null>(null)
  const model = shallowRef<Model | null>(null)
  const healthError = ref<string | null>(null)
  const pending = ref<PendingMigration | null>(null)
  const pendingError = ref<string | null>(null)
  const database = ref(true)
  const plan = computed(() => database.value ? pending.value : null)
  const shownBy = shallowRef<(() => boolean) | null>(null)
  const planShown = computed(() => shownBy.value?.() ?? false)
  const showPlanFrom = (shown: Ref<boolean>) => {
    const read = () => shown.value
    shownBy.value = read
    return () => {
      if (shownBy.value === read) shownBy.value = null
    }
  }

  const refreshHealth = async () => {
    try {
      health.value = await callAction<HealthReport>('health_get')
      healthError.value = null
    } catch (error) {
      healthError.value = errorMessage(error)
    }
  }
  let modelAsked = 0
  const refreshModel = async () => {
    const mine = ++modelAsked
    try {
      const result = await callAction<{ ok: true, model: Model } | { ok: false }>('model_get')
      if (mine !== modelAsked) return
      const next = result.ok ? result.model : null
      // The same model, read again, stays the object it was.
      if (next && model.value && JSON.stringify(next) === JSON.stringify(model.value)) return
      if (next) markRaw(next)
      model.value = next
    } catch {
      // The module could not be asked: what was known stays until it can be.
    }
  }
  const refreshPending = async () => {
    try {
      const result = await callAction<{ pending: PendingMigration | null, database?: boolean }>('migration_pending_get')
      pending.value = result.pending ?? null
      database.value = result.database !== false
      pendingError.value = null
    } catch (error) {
      pendingError.value = errorMessage(error)
    }
  }
  const refresh = async () => {
    await Promise.all([refreshHealth(), refreshPending()])
  }
  return { health, model, refreshModel, healthError, pending, pendingError, database, plan, planShown, showPlanFrom, refreshHealth, refreshPending, refresh }
}

export const useStatus = (): Status => {
  const status = inject(STATUS_KEY)
  if (!status) throw new Error('The bildr status is not provided (see App.vue / main.ts)')
  return status
}

/**
 * Calls `task` now, every `ms` while the document is visible, and as soon as the
 * module's event stream says the model changed or the app regenerated; stops on
 * unmount and once the session ended (a 401). The polling is the fallback, so the
 * stream itself doesn't poll the version too.
 */
export const usePolling = (task: () => Promise<void>, ms = POLL_MS) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let running = false
  let again = false
  let unsubscribe: (() => void) | undefined
  const schedule = () => {
    clearTimeout(timer)
    if (stopped || sessionEnded.value || document.visibilityState === 'hidden') return
    timer = setTimeout(tick, ms)
  }
  const tick = async () => {
    if (stopped || sessionEnded.value) return
    // One run at a time: an event during a run queues one more.
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await task()
    } finally {
      running = false
    }
    if (again) {
      again = false
      return tick()
    }
    schedule()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void tick()
    else clearTimeout(timer)
  }
  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility)
    void tick()
    unsubscribe = subscribeEvents((event) => {
      if (event.type === 'model' || event.type === 'regenerated' || event.type === 'version') void tick()
    }, { poll: false })
  })
  onBeforeUnmount(() => {
    stopped = true
    unsubscribe?.()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  })
}
