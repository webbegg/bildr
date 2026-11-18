<script setup lang="ts">
import { ref, watch } from 'vue'
import { composableOf, stateComposableOf } from '../../shared/dataArtifacts.ts'
import { useArtifactDialog } from '../../editor/useArtifactDialog.ts'
import type { ArtifactTarget } from '../../editor/useArtifactDialog.ts'

/**
 * The Rename dialog of a query, an action or a state (S10, DW-7e, B2): `query_rename` / `action_rename` / `state_rename`. A rename
 * changes the name, which names the generated code (the `use<Name>` composable, the route file; a state's has its module's name first),
 * and nothing else: the pages, forms, actions and steps that use it hold its id, so they need no change. Hand-written code that imports the generated name does, and the dialog says
 * so. What the module refuses is shown here and what was typed stays.
 */
const { target } = defineProps<{ target: ArtifactTarget | null }>()
const emit = defineEmits<{ close: [] }>()

const name = ref('')
const { shown, open, words, item, error, saving, submit: run } = useArtifactDialog(() => target, () => emit('close'), (_next, current) => {
  // `current` and not `item`: this runs while `useArtifactDialog` is still being called, when `item` is not bound yet.
  name.value = current?.name ?? ''
})

watch(name, () => {
  error.value = ''
})

async function submit() {
  const typed = name.value.trim()
  if (!typed || !shown.value) return
  if (typed === item.value?.name) {
    emit('close')
    return
  }
  const done = await run(words.value.rename, { [shown.value.kind]: shown.value.id, name: typed }, `Could not rename the ${words.value.label.toLowerCase()}`)
  if (done) emit('close')
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    dialog="rename"
    :title="`Rename ${words.label.toLowerCase()}`"
    :description="item?.label"
    :error="error"
    :saving="saving"
    submit-label="Rename"
    :can-submit="!!name.trim()"
    @submit="submit"
  >
    <EditorFormRow label="Name">
      <EditorInput
        v-model="name"
        autofocus
        aria-label="Name"
        data-artifact-name
        @keydown.enter.prevent="submit"
      />
    </EditorFormRow>
    <p
      v-if="item"
      class="text-[12px] leading-4 text-muted"
      data-artifact-warning
    >
      Hand-written code that imports `{{ shown?.kind === 'state' ? stateComposableOf(item.module, item.name) : composableOf(item.name) }}` needs the same rename.
    </p>
    <p class="text-[12px] leading-4 text-dimmed">
      {{ shown?.kind === 'state' ? 'Pages and steps' : 'Pages, forms and actions' }} that use it refer to it by id: they are updated with it.
    </p>
  </DataArtifactDialog>
</template>
