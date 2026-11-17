import { computed, ref } from 'vue'
import { callAction, errorMessage } from '../api.ts'
import type { Status } from '../status.ts'
import type { MigrationResult, PendingMigration } from '../types.ts'

/**
 * Confirming the pending migration plan (S9, S6), the one way it is done wherever it is asked: the plan's Review in the Data
 * workspace (`DataMigrations.vue`, after its modal) and a collection's Apply (`DataMigrationBanner.vue`, when the plan loses
 * nothing). Confirm posts the plan's hash, so a plan that changed since it was shown is refused (`migration_confirm`).
 */

/** Whether confirming `plan` can lose data: what it says it loses, or any statement that can (the module's own `destructive`). */
export const planLosesData = (plan: Pick<PendingMigration, 'losing' | 'destructive'>): boolean => plan.losing.length > 0 || plan.destructive.length > 0

export function useMigrationConfirm(status: Status) {
  /** The confirmation modal of the review. */
  const open = ref(false)
  const confirming = ref(false)
  const error = ref<string | null>(null)
  const outcome = ref<MigrationResult | null>(null)

  const outcomeText = computed(() => {
    const result = outcome.value
    if (!result) return ''
    switch (result.kind) {
      case 'written': return `Migration ${result.tag} written${result.applied ? ' and applied' : ''}.`
      case 'none': return 'Nothing to migrate: the database already matches the model.'
      case 'pending': return 'The model changed since this plan was shown: review the new plan.'
      case 'failed': return `The migration failed: ${result.error}${result.tag ? ` (${result.tag} was reverted)` : ''}`
    }
    return ''
  })
  const outcomeColor = computed(() => outcome.value?.kind === 'failed' ? 'error' as const : outcome.value?.kind === 'pending' ? 'warning' as const : 'success' as const)

  /** Confirms the plan shown, and reads what is pending again. */
  const confirm = async () => {
    const plan = status.pending.value
    if (!plan) return
    confirming.value = true
    error.value = null
    try {
      outcome.value = (await callAction<{ migration: MigrationResult }>('migration_confirm', { hash: plan.hash })).migration
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      open.value = false
      confirming.value = false
    }
    await status.refreshPending()
  }

  return { open, confirming, error, outcome, outcomeText, outcomeColor, confirm }
}
