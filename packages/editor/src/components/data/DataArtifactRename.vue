<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ARTIFACT_KINDS, attempt, composableOf } from '../../editor/dataArtifacts.ts'
import type { ArtifactKind } from '../../editor/dataArtifacts.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * The Rename dialog of a query or an action (S10, DW-7e): `query_rename` / `action_rename`. A rename changes the name, which
 * names the generated code (the `use<Name>` composable, the route file), and nothing else: the pages, forms and actions that
 * use it hold its id, so they need no change. Hand-written code that imports the generated name does, and the dialog says
 * so. What the module refuses is shown here and what was typed stays.
 */
const { target } = defineProps<{ target: { kind: ArtifactKind, id: string } | null }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditor()

/** The target last asked for, so the dialog keeps its words while it closes. */
const shown = ref(target)
const name = ref('')
const error = ref('')
const saving = ref(false)

const item = computed(() => shown.value ? (shown.value.kind === 'query' ? editor.queries : editor.actions).find(entry => entry.id === shown.value!.id) : undefined)
const words = computed(() => ARTIFACT_KINDS[shown.value?.kind ?? 'query'])

watch(() => target, (next) => {
  if (!next) return
  shown.value = next
  name.value = item.value?.name ?? ''
  error.value = ''
}, { immediate: true })
watch(name, () => {
  error.value = ''
})

const open = computed({
  get: () => target !== null,
  set: (value) => {
    if (!value) emit('close')
  }
})

async function submit() {
  const typed = name.value.trim()
  if (!typed || !shown.value || saving.value) return
  if (typed === item.value?.name) {
    emit('close')
    return
  }
  saving.value = true
  const done = await attempt(editor, words.value.rename, { [shown.value.kind]: shown.value.id, name: typed }, `Could not rename the ${words.value.label.toLowerCase()}`)
  saving.value = false
  if ('error' in done) error.value = done.error
  else emit('close')
}
</script>

<template>
  <EditorModal
    v-model:open="open"
    :title="`Rename ${words.label.toLowerCase()}`"
    :description="item ? `${item.label}` : undefined"
  >
    <div
      class="space-y-3"
      data-artifact-dialog="rename"
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
        Hand-written code that imports `{{ composableOf(item.name) }}` needs the same rename.
      </p>
      <p class="text-[12px] leading-4 text-dimmed">
        Pages, forms and actions that use it refer to it by id: they are updated with it.
      </p>
      <p
        v-if="error"
        class="flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
        role="alert"
        data-artifact-error
      >
        <UIcon
          name="i-lucide-circle-alert"
          class="size-4 shrink-0"
        />
        {{ error }}
      </p>
    </div>

    <template #footer>
      <EditorButton
        label="Cancel"
        @click="open = false"
      />
      <EditorButton
        variant="primary"
        label="Rename"
        :loading="saving"
        :disabled="!name.trim()"
        data-artifact-submit
        @click="submit"
      />
    </template>
  </EditorModal>
</template>
