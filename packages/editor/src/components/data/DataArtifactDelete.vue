<script setup lang="ts">
import { computed } from 'vue'
import { useArtifactDialog } from '../../editor/useArtifactDialog.ts'
import type { ArtifactTarget } from '../../editor/useArtifactDialog.ts'
import { usesOfArtifact } from '../../shared/dataArtifacts.ts'
import type { UseEntry } from '../../shared/dataArtifacts.ts'
import { them, usedInWords } from '../../shared/dataUsage.ts'
import { plainWords } from '../../shared/simpleData.ts'
import { useEditor } from '../../editor/useEditor.ts'
import DataUsageList from './DataUsageList.vue'

/**
 * The Delete dialog of a query, an action or a state (S10, DW-7e, B2): a confirm that calls `query_delete` / `action_delete` / `state_delete`. While the
 * item is used, Delete is disabled and the places that use it are listed as the reason (the same list as its Used in tab, each place a
 * link to the Canvas). The module refuses the same delete too, and that refusal is shown in the dialog when it is asked
 * anyway (the editor's list can be older than the model): it is the backstop, not the way the user learns of it.
 *
 * `plain` is the simple Data section's wording (a store, not a state; no file names, no ids): the workspace's text is as it was.
 */
const { target, plain = false } = defineProps<{ target: ArtifactTarget | null, plain?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditor()
const { shown, open, words, item, error, saving, submit: run } = useArtifactDialog(() => target, () => emit('close'))

/** What the dialog calls the item: the workspace's word, or the simple section's (a state is a store there). */
const noun = computed(() => plain ? 'store' : words.value.label.toLowerCase())
const uses = computed<UseEntry[]>(() => shown.value ? usesOfArtifact(editor.model, shown.value.id, shown.value.kind) : [])
const reason = computed(() => `${usedInWords(uses.value.length)}: change ${them(uses.value.length)} first`)

async function submit() {
  if (!shown.value || uses.value.length) return
  const done = await run(words.value.delete, { [shown.value.kind]: shown.value.id }, `Could not delete the ${noun.value}`)
  if (done) emit('close')
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    dialog="delete"
    :title="`Delete ${noun}`"
    :description="item ? (plain ? item.label : `${item.label} (${item.name})`) : undefined"
    :error="plain ? plainWords(error) : error"
    :saving="saving"
    :submit-label="`Delete ${noun}`"
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
      <template v-if="plain">
        Nothing uses it, so it can be deleted.
      </template>
      <template v-else>
        Nothing uses it. Its file is deleted, and with it the generated code.
      </template>
    </p>
  </DataArtifactDialog>
</template>
