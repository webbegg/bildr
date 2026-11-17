<script setup lang="ts">
import { onMounted } from 'vue'
import { useMigrationConfirm } from '../../editor/migrationConfirm.ts'
import { useStatus } from '../../status.ts'
import ConfirmModal from '../ConfirmModal.vue'
import ProblemsList from '../ProblemsList.vue'

/**
 * The pending migration plan (S9, S6), shown in the Data workspace when the tree's Migrations entry is chosen (`?item=migrations`),
 * or a collection's Review: what confirming loses, in the user's words, and the SQL. A destructive plan waits here until it is
 * confirmed; Confirm posts the plan's hash, so a plan that changed since it was shown is refused. With no plan it says so, and after
 * a confirmation it says what was written. Without a database it says there are no migrations.
 */

const status = useStatus()
const pending = status.pending
const { open, confirming, error, outcome, outcomeText, outcomeColor, confirm } = useMigrationConfirm(status)

onMounted(() => {
  void status.refreshPending()
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

    <UAlert
      v-if="!status.database.value"
      data-testid="no-database"
      color="neutral"
      variant="subtle"
      icon="i-lucide-database"
      title="This project has no database, so it has no migrations. Add a sqlite data source in All model files to turn the database on."
    />
    <template v-else-if="pending">
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
