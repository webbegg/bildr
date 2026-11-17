<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { PLAN_UPDATED, planLosesData, useMigrationConfirm } from '../../editor/migrationConfirm.ts'
import type { CollectionChange } from '../../editor/migrationTargets.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { useStatus } from '../../status.ts'

/**
 * The banner of a collection a pending migration plan changes (S6), above its tabs: "This collection has a database change", and
 * "that loses data: Post · body" when this collection's part of the plan can. **Review** opens the plan in the workspace.
 * **Apply** is offered only when the plan loses nothing: a plan that loses data is never applied without the review. The plan is
 * one: Apply confirms all of it, not this collection's part, so it is the whole plan that decides, and it says "Apply all changes"
 * when the plan changes more than this collection. Apply confirms the plan this banner was rendered with (its hash, taken when the
 * banner appeared, and again once the note of a stale Apply is acknowledged): if the plan is another by the time of the click, nothing is
 * confirmed and Review opens with a note.
 * `change` is what the plan does to the collection shown (`editor.dataMigration`).
 */
const { change } = defineProps<{ change: CollectionChange }>()
const editor = useEditor()
const status = useStatus()
const toast = useToast()
const { confirming, error, outcome, outcomeText, outcomeColor, note, confirm } = useMigrationConfirm(status)

/** The plan this banner was rendered for (its hash, required by `confirm`). It is taken again once the note a stale Apply left is gone: the user has seen the new plan. */
const rendered = ref(status.plan.value?.hash ?? '')
watch(note, (now, before) => {
  if (before && !now) rendered.value = status.plan.value?.hash ?? ''
})

/** Whether confirming the plan can lose data, whichever collection it is on. */
const loses = computed(() => status.plan.value !== null && planLosesData(status.plan.value))
/** Whether the plan changes more than this collection. */
const wider = computed(() => !!editor.dataPlan && (Object.keys(editor.dataPlan.collections).length > 1 || editor.dataPlan.other > 0))

const title = computed(() => change.losesData
  ? `This collection has a database change that loses data${change.losing.length ? `: ${change.losing.join(', ')}` : ''}`
  : 'This collection has a database change')

function review(why: string | null = null) {
  note.value = why
  editor.dataMigrations = true
}

async function apply() {
  const result = await confirm(rendered.value)
  if (result === 'nothing') return
  if (result === 'stale') review(PLAN_UPDATED)
  else if (error.value) toast.add({ title: 'Not applied', description: error.value, color: 'error' })
  else if (outcome.value) toast.add({ title: outcomeText.value, color: outcomeColor.value })
}
</script>

<template>
  <div class="shrink-0 px-3 pt-3">
    <UAlert
      data-testid="collection-migration-banner"
      color="warning"
      variant="subtle"
      icon="i-lucide-database-zap"
      :ui="{ root: 'rounded-lg' }"
      :title="title"
      :description="loses && !change.losesData ? 'Other changes in the same plan lose data: review them before applying.' : undefined"
    >
      <template #actions>
        <UButton
          label="Review"
          color="warning"
          variant="solid"
          size="xs"
          data-testid="collection-migration-review"
          @click="review()"
        />
        <UButton
          v-if="!loses"
          :label="wider ? 'Apply all changes' : 'Apply'"
          color="warning"
          variant="soft"
          size="xs"
          :loading="confirming"
          data-testid="collection-migration-apply"
          @click="apply"
        />
      </template>
    </UAlert>
  </div>
</template>
