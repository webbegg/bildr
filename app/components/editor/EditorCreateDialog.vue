<script setup lang="ts">
import { nameProblem } from '#shared/editor/names'

/**
 * Framer's "New component" / "New layout" dialog (`editor.createRequest`):
 * a name field, pre-filled (from the selection for a component) and
 * selected for typing, one line of help, and Cancel / Create. Create is
 * disabled while the name is empty or already used (ignoring case, as the
 * server checks); Enter submits. After Create the editor opens the new
 * component or layout.
 */
const editor = useEditor()
const formId = useId()
const name = ref('')
const creating = ref(false)
const field = useTemplateRef<{ select: () => void }>('field')

const request = computed(() => editor.createRequest)
const open = computed({
  get: () => !!request.value,
  set: (value) => {
    if (!value) editor.createRequest = null
  }
})
const isLayout = computed(() => request.value?.kind === 'layout')
const taken = computed(() => (isLayout.value ? editor.project?.layouts : editor.project?.components) ?? [])
const problem = computed(() => nameProblem(name.value, taken.value, isLayout.value ? 'layout' : 'component'))
/** The empty name only disables Create; a used one says why. */
const error = computed(() => (name.value.trim() ? problem.value : ''))
const help = computed(() => {
  if (!isLayout.value) return 'Edit it once and every instance updates. Use / for folders, e.g. Cards/Product.'
  return request.value?.nodeIds.length
    ? 'The selected layers become the layout; the rest of the page shows in its content slot.'
    : 'A shared frame around the pages that use it, such as a nav and a footer.'
})

watch(request, async (value) => {
  if (!value) return
  name.value = value.name
  await nextTick()
  // After the modal has moved the focus into itself.
  requestAnimationFrame(() => field.value?.select())
}, { immediate: true })

async function submit() {
  if (problem.value || creating.value) return
  creating.value = true
  try {
    await editor.confirmCreate(name.value)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <EditorModal
    v-model:open="open"
    :title="isLayout ? 'New layout' : 'New component'"
    :ui="{ content: 'sm:max-w-[320px]' }"
  >
    <form
      :id="formId"
      :data-create-dialog="request?.kind"
      @submit.prevent="submit"
    >
      <EditorFormRow
        label="Name"
        :help="help"
        :error="error"
        stacked
      >
        <EditorInput
          ref="field"
          v-model="name"
          :invalid="!!error"
          :maxlength="100"
          autocomplete="off"
          :aria-label="isLayout ? 'New layout name' : 'New component name'"
          data-create-name
        />
      </EditorFormRow>
    </form>
    <template #footer>
      <EditorButton
        label="Cancel"
        variant="ghost"
        @click="open = false"
      />
      <EditorButton
        type="submit"
        :form="formId"
        label="Create"
        variant="primary"
        :disabled="!!problem"
        :loading="creating"
        data-create-submit
      />
    </template>
  </EditorModal>
</template>
