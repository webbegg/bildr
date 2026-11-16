<script setup lang="ts">
import { computed, watch } from 'vue'
import ProblemsList from '../ProblemsList.vue'
import RawFileEditor from '../RawFileEditor.vue'
import { useEditor } from '../../editor/useEditor.ts'
import { useModelFiles } from '../../editor/useModelFiles.ts'
import { groupFiles } from '../../model.ts'
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * The Data workspace's All model files (S3): every `.bildr/` file the module returns, grouped by kind, and the raw
 * editor for the one chosen (or for a path typed): where the artifacts that have no collection or connection (pages,
 * queries, actions, modules and the rest) are reached. The file chosen is `editor.dataFile`, which the URL keeps. It
 * needs no loaded model: the module returns the files while the model has problems, so a broken file is fixed here.
 */
const editor = useEditor()
const { files, loaded, error, load } = useModelFiles()

const groups = computed(() => groupFiles(files.value))

// A file that is gone (deleted, or a link to one the model never had) is not a selection.
watch([loaded, files], () => {
  if (loaded.value && editor.dataFile !== null && files.value[editor.dataFile] === undefined) editor.dataFile = null
})

async function saved(path: string) {
  await Promise.all([load(), editor.reload()])
  if (files.value[path] !== undefined) editor.dataFile = path
}

async function deleted() {
  await Promise.all([load(), editor.reload()])
}

const confirmDelete = (path: string) => editor.confirm({
  title: 'Delete this file?',
  description: `${path} is removed. The model must stay valid without it, and Undo brings it back.`,
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
          class="mx-2 flex h-8 w-[calc(100%-1rem)] items-center rounded-lg ps-3 pe-3 text-left text-[12px]"
          :class="[FOCUS_RING, editor.dataFile === file.path ? 'bg-white/8 font-medium text-highlighted' : 'text-toned hover:bg-white/4']"
          :title="file.path"
          :aria-current="editor.dataFile === file.path ? 'true' : undefined"
          :data-file="file.path"
          @click="editor.dataFile = file.path"
        >
          <span class="truncate">{{ file.label }}</span>
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
        <ProblemsList
          v-if="error"
          title="Could not read the model files"
          :message="error"
        />
        <h2 class="text-[13px] font-[550] text-highlighted">
          All model files
        </h2>
        <RawFileEditor
          v-if="loaded"
          :files="files"
          :path="editor.dataFile ?? ''"
          :confirm-delete="confirmDelete"
          @update:path="editor.dataFile = $event"
          @saved="saved"
          @deleted="deleted"
        />
      </div>
    </div>
  </div>
</template>
