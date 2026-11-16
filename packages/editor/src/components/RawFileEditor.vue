<script setup lang="ts">
import { onBeforeUnmount, ref, toRef, watch } from 'vue'
import { ActionCallError, callAction, errorMessage } from '../api.ts'
import { jsonErrorMessage } from '../editor/jsonError.ts'
import { useEditor } from '../editor/useEditor.ts'
import { useFileText } from '../editor/useFileText.ts'
import type { Json, ModelProblem } from '../types.ts'
import ProblemsList from './ProblemsList.vue'

/**
 * One `.bildr/` model file as JSON (S3), over `model_file_put` and `model_file_delete`: the Data workspace's JSON tab and
 * its All model files, which is also the way out when the model does not load. The path is shown, not typed: the parent
 * chooses the file (the JSON tab's own, a click in the list, or a new path). `files` is every file as `model_get` returns
 * it and `invalid` the text of those that are not valid JSON, which are fixed here like any other.
 *
 * The text is the file's (`useFileText`): it follows the file when it changes elsewhere unless it has been typed on, and
 * then says so and waits for the user to take the new version or keep their edits, which Save waits for too. Save also
 * sends the file it started from (`base`), so the module refuses a write over a file that changed in the meantime. Edits
 * that are not saved are reported to the editor (`dataDirty`), which asks before the workspace moves away from them. The
 * module validates the model on a save and answers with the problems, shown here with the text kept.
 */
const props = withDefaults(defineProps<{
  files: Record<string, Json>
  invalid?: Record<string, string>
  /** The file shown (a path); empty when none is. */
  path?: string
  deletable?: boolean
  /** Asked before a delete; the delete is made when it answers true. */
  confirmDelete?: (path: string) => Promise<boolean>
}>(), { invalid: () => ({}), path: '', deletable: true, confirmDelete: undefined })
const emit = defineEmits<{
  /** The module took the file. */
  saved: [path: string]
  deleted: [path: string]
  /** The module refused a save because the file changed since it was opened: the parent reads the files again. */
  conflict: []
}>()

const editor = useEditor()
const file = useFileText({ path: toRef(props, 'path'), files: () => props.files, invalid: () => props.invalid })
const { content, external, unreadable } = file
const saving = ref(false)
const error = ref<{ message: string, problems: ModelProblem[] } | null>(null)
const done = ref<string | null>(null)
/** The editor's height follows the window: what is left under the chrome, never less than a dozen lines. */
const TEXT_HEIGHT = 'h-[max(12rem,calc(100dvh-24rem))]'

// The editor asks before it moves away from edits that are not saved.
watch([file.dirty, () => props.path], ([dirty, path]) => {
  editor.dataDirty = dirty ? path : null
}, { flush: 'sync', immediate: true })
onBeforeUnmount(() => {
  editor.dataDirty = null
})

/** The path of the file just deleted: the parent clears it, and "Deleted." stays. */
let deletedPath: string | null = null
watch(() => props.path, (next, previous) => {
  if (next === '' && previous === deletedPath) {
    deletedPath = null
    return
  }
  error.value = null
  done.value = null
})

const left = (problems: ModelProblem[] | undefined) => !problems?.length ? '' : problems.length === 1 ? ' 1 problem is left in other files.' : ` ${problems.length} problems are left in other files.`

const run = async (name: 'model_file_put' | 'model_file_delete') => {
  error.value = null
  done.value = null
  const path = props.path
  if (!path.startsWith('.bildr/')) {
    error.value = { message: 'Enter a path under .bildr/', problems: [] }
    return
  }
  let input: Record<string, unknown> = { path }
  if (name === 'model_file_put') {
    try {
      const parsed = JSON.parse(content.value) as Json
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a model file is a JSON object')
      // The file the edit started from; a file that is not an object is none the module can compare, so none is said.
      const base = file.base.value
      input = { ...input, content: parsed, ...(base === null || typeof base === 'string' || (typeof base === 'object' && !Array.isArray(base)) ? { base } : {}) }
    } catch (caught) {
      error.value = { message: caught instanceof SyntaxError ? jsonErrorMessage(content.value, caught) : `Invalid JSON: ${errorMessage(caught)}`, problems: [] }
      return
    }
  } else if (props.confirmDelete && !(await props.confirmDelete(path))) {
    return
  }
  saving.value = true
  try {
    const result = await callAction<{ problems?: ModelProblem[] } | undefined>(name, input)
    if (name === 'model_file_put') {
      done.value = `Saved.${left(result?.problems)}`
      file.saved()
      emit('saved', path)
    } else {
      done.value = 'Deleted.'
      deletedPath = path
      file.discard()
      emit('deleted', path)
    }
  } catch (caught) {
    error.value = { message: errorMessage(caught), problems: caught instanceof ActionCallError ? caught.problems ?? [] : [] }
    if (caught instanceof ActionCallError && caught.code === 'conflict') emit('conflict')
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
    <p
      v-if="path"
      class="text-[11px] text-dimmed"
    >
      <code data-file-path>{{ path }}</code>
    </p>
    <UAlert
      v-if="unreadable"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="This file is not valid JSON"
      description="Fix it and save: the model cannot load until every file is valid."
      data-file-invalid
    />
    <UAlert
      v-if="external !== null"
      color="warning"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      title="This file changed since you opened it"
      description="Your edits are still here. Load the new version to drop them, or keep them to replace the new version when you save."
      data-file-changed
    >
      <template #actions>
        <UButton
          label="Load the new version"
          color="warning"
          variant="soft"
          size="xs"
          data-testid="raw-load-new"
          @click="file.loadNew()"
        />
        <UButton
          label="Keep my edits"
          color="neutral"
          variant="outline"
          size="xs"
          data-testid="raw-keep-mine"
          @click="file.keepMine()"
        />
      </template>
    </UAlert>
    <UFormField label="Content (JSON)">
      <UTextarea
        v-model="content"
        data-testid="raw-content"
        :disabled="!path"
        placeholder="Choose a file in the list, or start one with New file…"
        :ui="{ base: TEXT_HEIGHT }"
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
        :disabled="!path || external !== null"
        @click="run('model_file_put')"
      />
      <UButton
        v-if="files[path] !== undefined || invalid[path] !== undefined"
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
        :disabled="saving || !path"
        @click="run('model_file_delete')"
      />
    </div>
  </div>
</template>
