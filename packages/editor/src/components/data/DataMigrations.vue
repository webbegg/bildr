<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { planLosesData, useMigrationConfirm } from '../../editor/migrationConfirm.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { useStatus } from '../../status.ts'
import ConfirmModal from '../ConfirmModal.vue'
import ProblemsList from '../ProblemsList.vue'

/**
 * The pending migration plan (S9, S6), shown in the Data workspace when the tree's Migrations entry is chosen (`?item=migrations`),
 * or a collection's Review: which collections it changes, what applying it loses, in the collections' words ("Post · body"), and the
 * changes themselves (the statements). A plan that loses data waits here until it is applied after a confirmation; Apply posts the
 * plan's hash, so a plan that changed since it was shown is refused. A plan that loses nothing is applied at once. With no plan it
 * says so, and after an apply it says what was written. Without a database it says there is nothing to migrate.
 */

const editor = useEditor()
const status = useStatus()
const plan = status.plan
const { open, confirming, error, outcome, outcomeText, outcomeColor, note, confirm } = useMigrationConfirm(status)

/** Said when nothing in the plan lists what it loses though it can lose data (the statements say so): applying is never silent. */
const UNLISTED_LOSS = 'Some data may be lost: see the changes below.'

const loses = computed(() => plan.value !== null && planLosesData(plan.value))
const losing = computed(() => editor.dataPlan?.losing.length ? editor.dataPlan.losing : loses.value ? [UNLISTED_LOSS] : [])
/** The plan's reach in words: the collections it changes, and the changes no collection owns. */
const summary = computed(() => {
  const targets = editor.dataPlan
  if (!targets) return ''
  const names = Object.values(targets.collections).map(change => change.name)
  return [
    names.length ? `Collections changed: ${names.join(', ')}.` : '',
    targets.other ? `Other database changes: ${targets.other}.` : ''
  ].filter(Boolean).join(' ')
})

/** A plan that loses data asks first; one that loses nothing is applied. */
function apply() {
  if (loses.value) open.value = true
  else void confirm()
}

onMounted(() => {
  void status.refreshPending()
})
onBeforeUnmount(() => {
  note.value = null
})
</script>

<template>
  <div
    class="space-y-6 p-6"
    data-data-migrations
  >
    <h1 class="text-xl font-semibold">
      Migrations
    </h1>

    <UAlert
      v-if="note"
      data-testid="migration-note"
      color="warning"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      :title="note"
    />
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
      title="Not applied"
      :message="error"
    />
    <ProblemsList
      v-if="status.pendingError.value"
      title="Could not read the pending migration"
      :message="status.pendingError.value"
    />

    <UAlert
      v-if="!status.database.value"
      data-testid="no-database"
      color="neutral"
      variant="subtle"
      icon="i-lucide-database"
      title="This project has no database yet, so there is nothing to migrate. A collection stored in a database gets changes to review here. A database is added in All model files, under Connections and storage."
    />
    <template v-else-if="plan">
      <p
        v-if="summary"
        class="text-sm"
        data-testid="plan-summary"
      >
        {{ summary }}
      </p>

      <UCard v-if="loses">
        <template #header>
          <h2 class="font-semibold text-error">
            Applying loses
          </h2>
        </template>
        <ul
          data-testid="losing"
          class="list-disc space-y-1 pl-5 text-sm"
        >
          <li
            v-for="(loss, index) in losing"
            :key="index"
          >
            {{ loss }}
          </li>
        </ul>
        <p class="mt-3 text-sm text-muted">
          Changes that lose nothing are already applied. Until you apply these, the app's code may run ahead of its database.
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Changes
          </h2>
        </template>
        <pre
          data-testid="statements"
          class="overflow-auto rounded-md bg-elevated/50 p-3 font-mono text-xs"
        >{{ plan.statements.join('\n') }}</pre>
        <p class="mt-2 text-xs text-dimmed">
          Version {{ plan.hash }}
        </p>
      </UCard>

      <UButton
        data-testid="confirm"
        :color="loses ? 'error' : 'primary'"
        :icon="loses ? 'i-lucide-triangle-alert' : undefined"
        :label="loses ? 'Apply…' : 'Apply'"
        :loading="confirming"
        @click="apply"
      />
    </template>
    <p
      v-else-if="!outcome"
      class="text-sm text-muted"
    >
      No migration is waiting.
    </p>

    <ConfirmModal
      v-model:open="open"
      title="Apply these changes? Some data will be lost"
      description="This drops data from the database. It cannot be undone from bildr."
      confirm-label="Apply"
      confirm-test-id="confirm-migration"
      :loading="confirming"
      @confirm="confirm()"
    >
      <ul
        v-if="plan"
        class="list-disc space-y-1 pl-5 text-sm"
      >
        <li
          v-for="(loss, index) in losing"
          :key="index"
        >
          {{ loss }}
        </li>
      </ul>
    </ConfirmModal>
  </div>
</template>
