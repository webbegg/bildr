import { isDestructive } from '@bildr/codegen/migrate'
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { callAction, errorMessage } from '../api.ts'
import type { Status } from '../status.ts'
import type { MigrationResult, PendingMigration } from '../types.ts'

/**
 * Confirming the pending migration plan (S9, S6), the one way it is done wherever it is asked: the plan's Review in the Data
 * workspace (`DataMigrations.vue`, after its modal) and a collection's Apply (`DataMigrationBanner.vue`, when the plan loses
 * nothing). Confirm posts the plan's hash, so a plan that changed since it was shown is refused (`migration_confirm`); the
 * caller that showed the plan says which one it showed (`confirm(hash)`), and a plan that is not that one is not confirmed at all.
 */

/** Said where the plan is reviewed when what was shown is no longer the plan: nothing was applied, and the user looks again. */
export const PLAN_UPDATED = 'The changes were updated: review them'

/** Whether confirming `plan` can lose data: what it says it loses, its `destructive` statements, or any statement the module's own rule (`isDestructive`) calls destructive. Fails closed: a plan is safe only when nothing in it says otherwise. */
export const planLosesData = (plan: Pick<PendingMigration, 'losing' | 'destructive' | 'statements'>): boolean =>
  plan.losing.length > 0 || plan.destructive.length > 0 || plan.statements.some(isDestructive)

/** What `confirm` did: it `confirmed` (the module answered, whatever it said), found the plan `stale` (nothing was applied; review the changes), or did `nothing` (no plan, or a confirmation already under way). */
export type ConfirmResult = 'confirmed' | 'stale' | 'nothing'

/** The note each status's Review shows (see `PLAN_UPDATED`), shared by the banner that leaves it and the review that shows it. */
const notes = new WeakMap<Status, Ref<string | null>>()

export function useMigrationConfirm(status: Status) {
  /** The confirmation modal of the review. */
  const open = ref(false)
  const confirming = ref(false)
  const error = ref<string | null>(null)
  const outcome = ref<MigrationResult | null>(null)
  /** What the review says before the plan: why the user is looking at it again. Shared, so the banner can leave it for the review. */
  const note = notes.get(status) ?? ref<string | null>(null)
  notes.set(status, note)

  const outcomeText = computed(() => {
    const result = outcome.value
    if (!result) return ''
    switch (result.kind) {
      case 'written': return `Migration ${result.tag} written${result.applied ? ' and applied' : ''}.`
      case 'none': return 'Nothing to migrate: the database already matches the model.'
      case 'pending': return PLAN_UPDATED
      case 'failed': return `The migration failed: ${result.error}${result.tag ? ` (${result.tag} was reverted)` : ''}`
    }
  })
  const outcomeColor = computed(() => outcome.value?.kind === 'failed' ? 'error' as const : outcome.value?.kind === 'pending' ? 'warning' as const : 'success' as const)

  /**
   * Confirms the plan, and reads what is pending again. `hash` is the plan the caller showed: when the plan now is another, nothing
   * is confirmed (`stale`); without it, the plan now is confirmed. A confirmation under way is not asked twice.
   */
  const confirm = async (hash?: string): Promise<ConfirmResult> => {
    if (confirming.value) return 'nothing'
    const plan = status.plan.value
    if (!plan) return 'nothing'
    if (hash !== undefined && plan.hash !== hash) return 'stale'
    confirming.value = true
    error.value = null
    outcome.value = null
    note.value = null
    try {
      outcome.value = (await callAction<{ migration: MigrationResult }>('migration_confirm', { hash: plan.hash })).migration
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      open.value = false
      confirming.value = false
    }
    await status.refreshPending()
    return outcome.value?.kind === 'pending' ? 'stale' : 'confirmed'
  }

  return { open, confirming, error, outcome, outcomeText, outcomeColor, note, confirm }
}
