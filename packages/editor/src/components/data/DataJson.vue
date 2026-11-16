<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ProblemsList from '../ProblemsList.vue'
import RawFileEditor from '../RawFileEditor.vue'
import DataEmptyState from './DataEmptyState.vue'
import { useEditor } from '../../editor/useEditor.ts'
import { useModelFiles } from '../../editor/useModelFiles.ts'
import { entityFiles } from '../../model.ts'
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * The Data workspace's JSON tab (S3): the shown item's own `.bildr/` file (a collection's entity, a connection's data
 * source) in the raw editor, which shows what the module refuses inline and keeps the text. A collection also has a
 * switcher for the files it is linked to (its repository, its sample data, the queries that read it), one file at a
 * time, its own first; the text is the file's, so a switch drops what was typed and not saved. A save refreshes the
 * model, so Fields and Endpoints show the change.
 */
const { path, linked = false } = defineProps<{
  /** The item's own file. */
  path: string | undefined
  /** The item is a collection: it has linked files. */
  linked?: boolean
}>()
const editor = useEditor()
const { files, loaded, error, load } = useModelFiles()

const current = ref(path ?? '')
watch(() => path, (next) => {
  current.value = next ?? ''
})

const entries = computed(() => path && linked ? entityFiles(files.value, path) : [])

async function saved() {
  await Promise.all([load(), editor.reload()])
}
</script>

<template>
  <div
    class="size-full overflow-y-auto"
    data-data-json
  >
    <div class="w-full max-w-3xl space-y-3 px-0.5 py-3">
      <ProblemsList
        v-if="error"
        title="Could not read the model files"
        :message="error"
      />
      <DataEmptyState
        v-else-if="!path"
        icon="i-lucide-file-json"
        title="No file"
      >
        This item has no file in the model.
      </DataEmptyState>
      <template v-else-if="loaded">
        <div
          v-if="entries.length > 1"
          class="flex flex-wrap gap-1"
          role="group"
          aria-label="Files of this collection"
          data-file-switcher
        >
          <button
            v-for="entry in entries"
            :key="entry.path"
            type="button"
            class="h-7 rounded-lg px-2.5 text-[12px] font-[550] transition-colors"
            :class="[FOCUS_RING, current === entry.path ? 'bg-white/8 text-highlighted' : 'text-muted hover:text-default']"
            :aria-pressed="current === entry.path"
            :data-file-switch="entry.path"
            @click="current = entry.path"
          >
            {{ entry.label }}
          </button>
        </div>
        <p class="text-[11px] text-dimmed">
          <code data-file-path>{{ current }}</code>
        </p>
        <RawFileEditor
          :files="files"
          :path="current"
          fixed
          :deletable="false"
          @saved="saved"
        />
      </template>
    </div>
  </div>
</template>
