<script setup lang="ts">
import { ref, watch } from 'vue'
import { ActionCallError, callAction, errorMessage } from '../api.ts'
import type { Json, ModelProblem } from '../types.ts'
import ProblemsList from './ProblemsList.vue'

/** Any `.bildr/` file as JSON, by path: the way out when the model doesn't load and the forms can't be built. */
const props = defineProps<{ files: Record<string, Json> }>()
const emit = defineEmits<{ saved: [path: string] }>()

const path = ref('')
const content = ref('')
const saving = ref(false)
const error = ref<{ message: string, problems: ModelProblem[] } | null>(null)
const done = ref<string | null>(null)

watch(path, (next) => {
  const file = props.files[next]
  if (file !== undefined) content.value = JSON.stringify(file, null, 2)
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
  }
  saving.value = true
  try {
    await callAction(name, input)
    done.value = name === 'model_file_put' ? 'Saved.' : 'Deleted.'
    emit('saved', path.value)
  } catch (caught) {
    error.value = { message: errorMessage(caught), problems: caught instanceof ActionCallError ? caught.problems ?? [] : [] }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <h2 class="text-lg font-semibold">
      Edit a model file
    </h2>
    <UFormField
      label="Path"
      help="Pick a file to load it, or type a new .bildr/ path"
    >
      <UInput
        v-model="path"
        data-testid="raw-path"
        list="bildr-model-files"
        placeholder=".bildr/modules/blog/entities/post.json"
        class="w-full font-mono"
      />
      <datalist id="bildr-model-files">
        <option
          v-for="file in Object.keys(files)"
          :key="file"
          :value="file"
        />
      </datalist>
    </UFormField>
    <UFormField label="Content (JSON)">
      <UTextarea
        v-model="content"
        data-testid="raw-content"
        :rows="16"
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
