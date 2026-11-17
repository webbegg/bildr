<script setup lang="ts">
import { computed } from 'vue'
import { openUse } from '../../editor/dataArtifactActions.ts'
import { useArtifactDialog } from '../../editor/useArtifactDialog.ts'
import type { ArtifactTarget } from '../../editor/useArtifactDialog.ts'
import { usageKey, usageKindLabel, usesOfArtifact } from '../../shared/dataArtifacts.ts'
import type { UseEntry } from '../../shared/dataArtifacts.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * The Delete dialog of a query or an action (S10, DW-7e): a confirm that calls `query_delete` / `action_delete`. While the
 * item is used, Delete is disabled and the places that use it are listed as the reason (the same list as its Used in tab, each place a
 * link to the Canvas). The module refuses the same delete too, and that refusal is shown in the dialog when it is asked
 * anyway (the editor's list can be older than the model): it is the backstop, not the way the user learns of it.
 */
const { target } = defineProps<{ target: ArtifactTarget | null }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditor()
const { shown, open, words, item, error, saving, submit: run } = useArtifactDialog(() => target, () => emit('close'))

const uses = computed<UseEntry[]>(() => shown.value ? usesOfArtifact(editor.model, shown.value.id, shown.value.kind) : [])
const reason = computed(() => `Used in ${uses.value.length} ${uses.value.length === 1 ? 'place' : 'places'}: change ${uses.value.length === 1 ? 'it' : 'them'} first`)

function go(use: UseEntry) {
  emit('close')
  openUse(editor, use)
}

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
        Used in {{ uses.length }} {{ uses.length === 1 ? 'place' : 'places' }}. It cannot be deleted while it is used: change {{ uses.length === 1 ? 'it' : 'them' }} first.
      </p>
      <div class="space-y-0.5">
        <button
          v-for="use in uses"
          :key="usageKey(use)"
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-toned hover:bg-white/4"
          :title="use.what.join('; ')"
          :data-use-open="usageKey(use)"
          @click="go(use)"
        >
          <span class="truncate">{{ use.name }}</span>
          <span class="text-[11px] text-dimmed">{{ usageKindLabel(use.kind) }}</span>
          <UIcon
            name="i-lucide-arrow-up-right"
            class="ms-auto size-3.5 shrink-0 text-dimmed"
          />
        </button>
      </div>
    </div>
    <p
      v-else
      class="text-[12px] leading-4 text-muted"
    >
      Nothing uses it. Its file is deleted, and with it the generated code.
    </p>
  </DataArtifactDialog>
</template>
