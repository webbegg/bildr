<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { StateFile } from '@bildr/codegen/model'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { KEEPS_VALUES, PERSISTENCE } from '../../shared/dataArtifacts.ts'
import type { StatePersist } from '../../shared/dataArtifacts.ts'

/**
 * A state's header (B2, S1), under the workspace's title and tabs: how long it keeps its values, one choice of three (Forgotten on
 * reload, Kept for this tab, Kept in this browser) saved at once with `state_update` `persist`, since it is one choice and not a
 * draft. What the module refuses is shown beside it, and the choice goes back to what is saved; an answer that comes after another
 * state was chosen is not shown under it. A state that holds several sets of values (not generated yet) can't be changed: the choice
 * is off.
 */
const { state } = defineProps<{ state: StateFile }>()
const editor = useEditor()

const error = ref('')
const saving = ref(false)
watch(() => state.id, () => {
  error.value = ''
})

const description = computed(() => PERSISTENCE.find(choice => choice.value === state.persist)?.description ?? '')
const editable = computed(() => state.shape === 'single')

async function choose(persist: StatePersist) {
  if (persist === state.persist || saving.value) return
  error.value = ''
  saving.value = true
  const asked = state.id
  const done = await attempt(editor, 'state_update', { state: asked, persist }, 'Could not save the state')
  saving.value = false
  // The refusal is about the state that was asked: if another is shown now, it is not that one's.
  if ('error' in done && state.id === asked) error.value = done.error
}
</script>

<template>
  <div
    class="shrink-0 border-b border-default px-4 py-2"
    data-state-header
  >
    <div class="flex min-h-[30px] items-center gap-3">
      <span class="shrink-0 text-[12px] text-muted">{{ KEEPS_VALUES }}</span>
      <EditorSelect
        :model-value="state.persist"
        :items="PERSISTENCE"
        :disabled="!editable || saving"
        :aria-label="KEEPS_VALUES"
        class="!w-56 shrink-0"
        data-state-persist
        @update:model-value="choose($event as StatePersist)"
      />
      <span
        class="min-w-0 truncate text-[12px] text-dimmed"
        data-state-persist-note
      >{{ description }}</span>
    </div>
    <DataInlineError
      v-if="error"
      class="mt-2"
      data-state-persist-error
    >
      {{ error }}
    </DataInlineError>
  </div>
</template>
