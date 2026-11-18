<script setup lang="ts">
import { computed } from 'vue'
import { useArtifactDialog } from '../../editor/useArtifactDialog.ts'
import type { ArtifactTarget } from '../../editor/useArtifactDialog.ts'
import { usesOfArtifact } from '../../shared/dataArtifacts.ts'
import type { UseEntry } from '../../shared/dataArtifacts.ts'
import { them, usedInWords } from '../../shared/dataUsage.ts'
import { useEditor } from '../../editor/useEditor.ts'
import DataUsageList from './DataUsageList.vue'

/**
 * The Delete dialog of a query, an action or a state (S10, DW-7e, B2): a confirm that calls `query_delete` / `action_delete` / `state_delete`. While the
 * item is used, Delete is disabled and the places that use it are listed as the reason (the same list as its Used in tab, each place a
 * link to the Canvas). The module refuses the same delete too, and that refusal is shown in the dialog when it is asked
 * anyway (the editor's list can be older than the model): it is the backstop, not the way the user learns of it.
 */
const { target } = defineProps<{ target: ArtifactTarget | null }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditor()
const { shown, open, words, item, error, saving, submit: run } = useArtifactDialog(() => target, () => emit('close'))

const uses = computed<UseEntry[]>(() => shown.value ? usesOfArtifact(editor.model, shown.value.id, shown.value.kind) : [])
const reason = computed(() => `${usedInWords(uses.value.length)}: change ${them(uses.value.length)} first`)

async function submit() {
  if (!shown.value || uses.value.length) return
  const done = await run(words.value.delete, { [shown.value.kind]: shown.value.id }, `Could not delete the ${words.value.label.toLowerCase()}`)
  if (done) emit('close')
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    dialog="delete"
    :title="`Delete ${words.label.toLowerCase()}`"
    :description="item ? `${item.label} (${item.name})` : undefined"
    :error="error"
    :saving="saving"
    :submit-label="`Delete ${words.label.toLowerCase()}`"
    submit-variant="danger"
    :can-submit="!uses.length"
    :submit-reason="reason"
    @submit="submit"
  >
    <div
      v-if="uses.length"
      class="space-y-2"
      data-artifact-uses
    >
      <p class="text-[12px] leading-4 text-muted">
        {{ usedInWords(uses.length) }}. It cannot be deleted while it is used: change {{ them(uses.length) }} first.
      </p>
      <DataUsageList
        :uses="uses"
        @open="emit('close')"
      />
    </div>
    <p
      v-else
      class="text-[12px] leading-4 text-muted"
    >
      Nothing uses it. Its file is deleted, and with it the generated code.
    </p>
  </DataArtifactDialog>
</template>
