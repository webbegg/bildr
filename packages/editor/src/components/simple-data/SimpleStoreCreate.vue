<script setup lang="ts">
import { ref, watch } from 'vue'
import DataInlineError from '../data/DataInlineError.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { KEEPS_VALUES, PERSISTENCE } from '../../shared/dataArtifacts.ts'
import type { StatePersist } from '../../shared/dataArtifacts.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * The New store form of the simple Data section (simple data, S3): a name, how long the store keeps its values (the choices of the
 * Data workspace, in the same words) and what shape it has, which is one set of values: the module makes a store with several sets
 * only later, so the form says what it makes and does not ask. `state_create` makes it with one text field, `value`, which its form
 * then edits. The words are the section's (`plainWords`). What the module refuses is shown here and what was typed stays; what was made is shown instead of this form.
 */
const emit = defineEmits<{ created: [id: string], cancel: [] }>()
const editor = useEditor()

const name = ref('')
const persist = ref<StatePersist>('memory')
const error = ref('')
const saving = ref(false)
watch([name, persist], () => {
  error.value = ''
})

async function submit() {
  const typed = name.value.trim()
  if (!typed || saving.value) return
  saving.value = true
  const done = await attempt<{ stateId: string }>(editor, 'state_create', { name: typed, persist: persist.value }, 'Could not create the store')
  saving.value = false
  if ('error' in done) {
    error.value = plainWords(done.error)
    return
  }
  emit('created', done.result.stateId)
}
</script>

<template>
  <form
    class="mx-auto w-full max-w-xl space-y-5 overflow-y-auto px-6 py-8"
    data-simple-create
    @submit.prevent="submit"
  >
    <header>
      <h2 class="text-base font-[550] text-highlighted">
        New store
      </h2>
      <p class="mt-1 text-[12px] text-muted">
        A store keeps values your pages share while the app runs, like a filter or a toggle.
      </p>
    </header>
    <EditorFormRow
      label="Name"
      help="Any words, like “Cart filter”"
      stacked
    >
      <EditorInput
        v-model="name"
        placeholder="Cart filter"
        autofocus
        aria-label="Name"
        data-simple-name
        @keydown.enter.prevent="submit"
      />
    </EditorFormRow>
    <EditorFormRow
      :label="KEEPS_VALUES"
      stacked
    >
      <EditorChoiceCards
        :model-value="persist"
        :items="PERSISTENCE"
        :label="KEEPS_VALUES"
        hook="data-simple-persist"
        @update:model-value="persist = $event as StatePersist"
      />
    </EditorFormRow>
    <p
      class="flex items-start gap-2 rounded-lg bg-white/4 px-3 py-2 text-[12px] leading-4 text-muted"
      data-simple-shape
    >
      <UIcon
        name="i-lucide-info"
        class="size-4 shrink-0"
      />
      <span>One set of values: each field holds one value at a time. It starts with one text field, “value”, which you can rename, and you add the others next.</span>
    </p>
    <DataInlineError
      v-if="error"
      icon
      data-simple-create-error
    >
      {{ error }}
    </DataInlineError>
    <div class="flex items-center justify-end gap-2">
      <EditorButton
        label="Cancel"
        :disabled="saving"
        data-simple-create-cancel
        @click="emit('cancel')"
      />
      <EditorButton
        variant="primary"
        label="Create store"
        :loading="saving"
        :disabled="!name.trim()"
        data-simple-create-submit
        @click="submit"
      />
    </div>
  </form>
</template>
