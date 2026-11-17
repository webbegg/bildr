<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables/useToast'
import { useMigrationConfirm, planLosesData } from '../../editor/migrationConfirm.ts'
import type { CollectionChange } from '../../editor/migrationTargets.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { useStatus } from '../../status.ts'

/**
 * The banner of a collection a pending migration plan changes (S6), above its tabs: "This collection has a pending database change"
 * (and "and it loses data" when this collection's part of the plan can). **Review** opens the plan in the workspace. **Apply**
 * confirms the plan by its hash at once when the plan loses no data; when it does, Apply opens Review instead: a plan that loses data is
 * never applied without the review. The plan is one: Apply confirms all of it, not this collection's part, so it is the whole plan's
 * loss that decides, not this collection's. `change` is what the plan does to the collection shown (`DataWorkspace.vue` finds it).
 */
const { change } = defineProps<{ change: CollectionChange }>()
const editor = useEditor()
const status = useStatus()
const toast = useToast()
const { confirming, error, outcome, outcomeText, outcomeColor, confirm } = useMigrationConfirm(status)

async function apply() {
  const plan = status.plan.value
  if (!plan) return
  if (planLosesData(plan)) {
    editor.dataMigrations = true
    return
  }
  await confirm()
  if (error.value) toast.add({ title: 'Not applied', description: error.value, color: 'error' })
  else if (outcome.value) toast.add({ title: outcomeText.value, color: outcomeColor.value })
}
</script>

<template>
  <UAlert
    data-testid="collection-migration-banner"
    color="warning"
    variant="subtle"
    icon="i-lucide-database-zap"
    :ui="{ root: 'rounded-none' }"
    :title="`This collection has a pending database change${change.losesData ? ' and it loses data' : ''}`"
  >
    <template #actions>
      <UButton
        label="Review"
        color="warning"
        variant="solid"
        size="xs"
        data-testid="collection-migration-review"
        @click="editor.dataMigrations = true"
      />
      <UButton
        label="Apply"
        color="warning"
        variant="soft"
        size="xs"
        :loading="confirming"
        data-testid="collection-migration-apply"
        @click="apply"
      />
    </template>
  </UAlert>
</template>
