<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { composableOf, stateComposableOf } from '../../shared/dataArtifacts.ts'
import { plainWords } from '../../shared/simpleData.ts'
import { useArtifactDialog } from '../../editor/useArtifactDialog.ts'
import type { ArtifactTarget } from '../../editor/useArtifactDialog.ts'

/**
 * The Rename dialog of a query, an action or a state (S10, DW-7e, B2): `query_rename` / `action_rename` / `state_rename`. A rename
 * changes the name, which names the generated code (the `use<Name>` composable, the route file; a state's has its module's name first),
 * and nothing else: the pages, forms, actions and steps that use it hold its id, so they need no change. Code the user wrote
 * themselves that uses the item does, and the dialog says so, with the generated name as a hint of what to look for. The editor can't
 * tell whether such code exists, so the warning stays, below what the rename does for them. What the module refuses is shown here and
 * what was typed stays.
 *
 * `plain` is the simple Data section's wording (a store, not a state; no generated name, no ids): the workspace's text is as it was.
 */
const { target, plain = false } = defineProps<{ target: ArtifactTarget | null, plain?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const name = ref('')
/** What the dialog calls the item: the workspace's word, or the simple section's (a state is a store there). */
const noun = computed(() => plain ? 'store' : words.value.label.toLowerCase())
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
  const done = await run(words.value.rename, { [shown.value.kind]: shown.value.id, name: typed }, `Could not rename the ${noun.value}`)
  if (done) emit('close')
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    dialog="rename"
    :title="`Rename ${noun}`"
    :description="item?.label"
    :error="plain ? plainWords(error) : error"
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
    <p class="text-[12px] leading-4 text-muted">
      <template v-if="plain">
        Pages and steps that use it keep working: they follow the new name.
      </template>
      <template v-else>
        {{ shown?.kind === 'state' ? 'Pages and steps' : 'Pages, forms and actions' }} that use it refer to it by id: they are updated with it.
      </template>
    </p>
    <template v-if="item">
      <p
        class="text-[12px] leading-4 text-dimmed"
        data-artifact-warning
      >
        Code you wrote yourself that uses this {{ noun }} needs the same rename.
      </p>
      <p
        v-if="!plain"
        class="text-[12px] leading-4 text-dimmed"
        data-artifact-hint
      >
        It is generated as `{{ shown?.kind === 'state' ? stateComposableOf(item.module, item.name) : composableOf(item.name) }}`.
      </p>
    </template>
  </DataArtifactDialog>
</template>
