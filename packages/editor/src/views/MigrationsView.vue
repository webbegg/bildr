<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { callAction, errorMessage } from '../api.ts'
import ConfirmModal from '../components/ConfirmModal.vue'
import ProblemsList from '../components/ProblemsList.vue'
import { useStatus } from '../status.ts'
import type { MigrationResult } from '../types.ts'

/**
 * A destructive migration plan waits here until confirmed (S9): what it loses,
 * in the user's words, and its SQL. Confirm posts the plan's hash, so a plan
 * that changed since it was shown is refused.
 */

const status = useStatus()
const pending = status.pending

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

const confirm = async () => {
  if (!pending.value) return
  confirming.value = true
  error.value = null
  try {
    outcome.value = (await callAction<{ migration: MigrationResult }>('migration_confirm', { hash: pending.value.hash })).migration
    open.value = false
  } catch (caught) {
    error.value = errorMessage(caught)
    open.value = false
  } finally {
    confirming.value = false
  }
  await status.refreshPending()
}

onMounted(() => {
  void status.refreshPending()
})
</script>

<template>
  <div class="space-y-6 p-6">
    <h1 class="text-xl font-semibold">
      Migrations
    </h1>

    <UAlert
      v-if="outcome"
      data-testid="migration-outcome"
      :color="outcomeColor"
      variant="subtle"
      :title="outcomeText"
    >
      <template
        v-if="outcome.kind === 'written' || outcome.kind === 'failed'"
        #description
      >
        <pre class="mt-1 overflow-auto font-mono text-xs">{{ outcome.statements.join('\n') }}</pre>
      </template>
    </UAlert>
    <ProblemsList
      v-if="error"
      title="Not confirmed"
      :message="error"
    />
    <ProblemsList
      v-if="status.pendingError.value"
      title="Could not read the pending migration"
      :message="status.pendingError.value"
    />

    <template v-if="pending">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-error">
            Confirming loses
          </h2>
        </template>
        <ul
          data-testid="losing"
          class="list-disc space-y-1 pl-5 text-sm"
        >
          <li
            v-for="(loss, index) in pending.losing"
            :key="index"
          >
            {{ loss }}
          </li>
        </ul>
        <p class="mt-3 text-sm text-muted">
          Until you confirm, the parts that lose nothing are applied, and the app's code may run ahead of its database.
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            SQL
          </h2>
        </template>
        <pre
          data-testid="statements"
          class="overflow-auto rounded-md bg-elevated/50 p-3 font-mono text-xs"
        >{{ pending.statements.join('\n') }}</pre>
        <p class="mt-2 text-xs text-muted">
          Plan <code>{{ pending.hash }}</code>
        </p>
      </UCard>

      <UButton
        data-testid="confirm"
        color="error"
        icon="i-lucide-triangle-alert"
        label="Confirm migration…"
        @click="open = true"
      />
    </template>
    <p
      v-else-if="!outcome"
      class="text-sm text-muted"
    >
      No migration is waiting for confirmation.
    </p>

    <ConfirmModal
      v-model:open="open"
      title="Apply the destructive migration?"
      description="This drops data from the database. It cannot be undone from bildr."
      confirm-label="Confirm migration"
      confirm-test-id="confirm-migration"
      :loading="confirming"
      @confirm="confirm"
    >
      <ul
        v-if="pending"
        class="list-disc space-y-1 pl-5 text-sm"
      >
        <li
          v-for="(loss, index) in pending.losing"
          :key="index"
        >
          {{ loss }}
        </li>
      </ul>
    </ConfirmModal>
  </div>
</template>
