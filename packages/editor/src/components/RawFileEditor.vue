<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ActionCallError, callAction, errorMessage } from '../api.ts'
import type { Json, ModelProblem } from '../types.ts'
import ProblemsList from './ProblemsList.vue'

/**
 * A `.bildr/` model file as JSON (S3), over `model_file_put` and `model_file_delete`: the Data workspace's JSON tab
 * (one file, `fixed`) and its All model files (any path, typed or chosen), which is also the way out when the model
 * does not load. The module validates the whole model on a save and answers with the problems, shown here with the
 * text kept. `files` is every file as `model_get` returns it: the text follows the file when it changes elsewhere
 * (or is saved), unless it has been typed on.
 */
const props = withDefaults(defineProps<{
  files: Record<string, Json>
  /** The file shown (a path, as `v-model:path`); it is typed when the editor is not `fixed`. */
  path?: string
  /** The path is not asked for: the file is the one chosen by the parent. */
  fixed?: boolean
  deletable?: boolean
  /** Asked before a delete; the delete is made when it answers true. */
  confirmDelete?: (path: string) => Promise<boolean>
}>(), { path: '', fixed: false, deletable: true, confirmDelete: undefined })
const emit = defineEmits<{ 'saved': [path: string], 'deleted': [path: string], 'update:path': [path: string] }>()

const path = ref(props.path)
const content = ref('')
const saving = ref(false)
const error = ref<{ message: string, problems: ModelProblem[] } | null>(null)
const done = ref<string | null>(null)

const textOf = (file: Json | undefined) => file === undefined ? undefined : JSON.stringify(file, null, 2)
const fileText = computed(() => textOf(props.files[path.value]))
/** The text the file last gave: the text is untouched while it is still that. */
let loaded = fileText.value ?? ''
content.value = loaded

watch(() => props.path, (next) => {
  path.value = next
  if (props.files[next] === undefined) {
    content.value = ''
    loaded = ''
  }
})

watch(path, (next) => {
  error.value = null
  done.value = null
  const text = textOf(props.files[next])
  if (text !== undefined) {
    content.value = text
    loaded = text
  }
  // A path chosen from the files is the parent's to keep; one that is typed is not (it may not be a file yet).
  if (next !== props.path && text !== undefined) emit('update:path', next)
})

watch(fileText, (text) => {
  if (text === undefined) return
  if (content.value === loaded) content.value = text
  loaded = text
})

const run = async (name: 'model_file_put' | 'model_file_delete') => {
  error.value = null
  done.value = null
  if (!path.value.startsWith('.bildr/')) {
    error.value = { message: 'Enter a path under .bildr/', problems: [] }
    return
  }
  let input: Record<string, unknown> = { path: path.value }
  if (name === 'model_file_put') {
    try {
      const parsed = JSON.parse(content.value) as Json
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a model file is a JSON object')
      input = { ...input, content: parsed }
    } catch (caught) {
      error.value = { message: `Invalid JSON: ${errorMessage(caught)}`, problems: [] }
      return
    }
  } else if (props.confirmDelete && !(await props.confirmDelete(path.value))) {
    return
  }
  saving.value = true
  try {
    await callAction(name, input)
    if (name === 'model_file_put') {
      done.value = 'Saved.'
      // What was saved is what the file holds now: the text follows the file's canonical form once it is read back.
      loaded = content.value
      emit('saved', path.value)
    } else {
      done.value = 'Deleted.'
      emit('deleted', path.value)
    }
  } catch (caught) {
    error.value = { message: errorMessage(caught), problems: caught instanceof ActionCallError ? caught.problems ?? [] : [] }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    class="space-y-3"
    data-raw-editor
  >
    <UFormField
      v-if="!fixed"
      label="Path"
      help="Choose a file from the list, or type a .bildr/ path to open or create one"
    >
      <UInput
        v-model="path"
        data-testid="raw-path"
        placeholder=".bildr/modules/blog/entities/post.json"
        class="w-full font-mono"
      />
    </UFormField>
    <UFormField label="Content (JSON)">
      <UTextarea
        v-model="content"
        data-testid="raw-content"
        :rows="18"
        class="w-full font-mono text-xs"
      />
    </UFormField>
    <ProblemsList
      v-if="error"
      title="Not saved"
      :message="error.message"
      :problems="error.problems"
    />
    <UAlert
      v-else-if="done"
      color="success"
      variant="subtle"
      :title="done"
    />
    <div class="flex gap-2">
      <UButton
        data-testid="raw-save"
        icon="i-lucide-save"
        label="Save file"
        :loading="saving"
        @click="run('model_file_put')"
      />
      <UButton
        v-if="files[path] !== undefined"
        :to="{ path: '/code', query: { path } }"
        color="neutral"
        variant="outline"
        icon="i-lucide-file-code"
        label="Open in Code"
        data-open-in-code
      />
      <UButton
        v-if="deletable"
        data-testid="raw-delete"
        color="error"
        variant="outline"
        icon="i-lucide-trash-2"
        label="Delete file"
        :disabled="saving"
        @click="run('model_file_delete')"
      />
    </div>
  </div>
</template>
