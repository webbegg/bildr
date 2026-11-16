<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import RawFileEditor from '../RawFileEditor.vue'
import DataFilesError from './DataFilesError.vue'
import { useEditor } from '../../editor/useEditor.ts'
import { useModelFiles } from '../../editor/useModelFiles.ts'
import { groupFiles } from '../../model.ts'
import { FOCUS_RING, SELECTED_ITEM } from '../../editorUi.ts'

/**
 * The Data workspace's All model files (S3): every `.bildr/` file the module returns, grouped by kind, and the raw
 * editor for the one chosen: where the artifacts that have no collection or connection (pages, queries, actions, modules
 * and the rest) are reached. The file chosen is `editor.dataFile`, which the URL keeps, and the list scrolls it into view.
 * It needs no loaded model: the module returns the files while the model has problems, including the ones that are not
 * valid JSON (marked), so a broken file is fixed here.
 *
 * A new file is started with "New file…": its path is typed there, and until it is saved it is not a choice: the list has
 * none chosen and the URL does not name it, so a reload shows what the URL says.
 */
const editor = useEditor()
const { files, invalid, loaded, error, load, refresh } = useModelFiles()
const list = useTemplateRef<HTMLElement>('list')

const groups = computed(() => groupFiles(files.value, invalid.value))
const hasFile = (path: string) => Object.hasOwn(files.value, path) || Object.hasOwn(invalid.value, path)

/** The path of a new file being written: not a file yet, so not in `editor.dataFile`. */
const opened = ref<string | null>(null)
const shown = computed(() => editor.dataFile ?? opened.value ?? '')
const adding = ref(false)
const typed = ref('')
const pathError = ref('')

// A file that is gone (deleted, or a link to one the module does not have) is not a selection. A file that is not valid JSON is one.
watch([loaded, files, invalid], () => {
  if (loaded.value && editor.dataFile !== null && !hasFile(editor.dataFile)) editor.dataFile = null
})

// Choosing a file leaves the new one that was being written.
watch(() => editor.dataFile, (path) => {
  if (path !== null) opened.value = null
})

// The chosen file is in view in a long list.
watch([() => editor.dataFile, loaded, files, invalid], async () => {
  await nextTick()
  list.value?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' })
}, { immediate: true })

function openTyped() {
  const path = typed.value.trim()
  if (!path.startsWith('.bildr/')) {
    pathError.value = 'Enter a path under .bildr/'
    return
  }
  pathError.value = ''
  adding.value = false
  typed.value = ''
  // A path the module has is chosen; one it has not is a new file, until it is saved.
  if (hasFile(path)) editor.dataFile = path
  else void editor.leaveData(() => {
    editor.dataFile = null
    opened.value = path
  })
}

function cancelNew() {
  adding.value = false
  typed.value = ''
  pathError.value = ''
}

async function saved(path: string) {
  await refresh()
  if (hasFile(path)) editor.dataFile = path
}

const confirmDelete = (path: string) => editor.confirm({
  title: 'Delete this file?',
  description: `${path} is removed. The model must not get new problems without it, and Undo brings it back.`,
  confirmLabel: 'Delete file',
  danger: true
})
</script>

<template>
  <div
    class="flex size-full min-h-0 min-w-0"
    data-data-files
  >
    <nav
      ref="list"
      class="w-64 shrink-0 overflow-y-auto border-e border-default pb-3"
      aria-label="Model files"
    >
      <section
        v-for="group in groups"
        :key="group.kind"
        :data-files-group="group.kind"
      >
        <h3 class="ps-3.5 pe-2 pt-3 pb-1 text-xs font-medium text-dimmed">
          {{ group.label }}
        </h3>
        <button
          v-for="file in group.files"
          :key="file.path"
          type="button"
          class="mx-2 flex h-8 w-[calc(100%-1rem)] items-center gap-2 rounded-lg ps-3 pe-3 text-left text-[12px]"
          :class="[FOCUS_RING, editor.dataFile === file.path ? SELECTED_ITEM : 'text-toned hover:bg-white/4']"
          :title="file.path"
          :aria-current="editor.dataFile === file.path ? 'true' : undefined"
          :data-file="file.path"
          @click="editor.dataFile = file.path"
        >
          <span class="truncate">{{ file.label }}</span>
          <span
            v-if="file.invalid"
            class="ms-auto shrink-0 text-[10px] font-normal text-error"
          >not valid JSON</span>
        </button>
      </section>
      <p
        v-if="loaded && !groups.length"
        class="ps-3.5 pe-3 py-3 text-xs text-dimmed"
      >
        No model files.
      </p>
    </nav>
    <div class="min-w-0 flex-1 overflow-y-auto p-4">
      <div class="w-full max-w-3xl space-y-3">
        <DataFilesError
          v-if="error"
          :message="error"
          @retry="load"
        />
        <div class="flex items-center gap-2">
          <h2 class="flex-1 text-[13px] font-[550] text-highlighted">
            All model files
          </h2>
          <UButton
            v-if="loaded && !adding"
            label="New file…"
            icon="i-lucide-file-plus"
            color="neutral"
            variant="outline"
            size="xs"
            data-new-file
            @click="adding = true"
          />
        </div>
        <form
          v-if="adding"
          class="flex gap-2"
          data-new-file-form
          @submit.prevent="openTyped"
        >
          <UInput
            v-model="typed"
            data-testid="raw-path"
            aria-label="Path of the new file"
            placeholder=".bildr/modules/blog/pages/about.json"
            autofocus
            class="flex-1 font-mono"
          />
          <UButton
            type="button"
            label="Open"
            data-testid="raw-path-open"
            @click="openTyped"
          />
          <UButton
            type="button"
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="cancelNew"
          />
        </form>
        <p
          v-if="pathError"
          class="text-xs text-error"
          role="alert"
        >
          {{ pathError }}
        </p>
        <RawFileEditor
          v-if="loaded"
          :files="files"
          :invalid="invalid"
          :path="shown"
          :confirm-delete="confirmDelete"
          @saved="saved"
          @deleted="refresh"
          @conflict="refresh"
        />
      </div>
    </div>
  </div>
</template>
