<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RawFileEditor from '../RawFileEditor.vue'
import DataEmptyState from './DataEmptyState.vue'
import DataFilesError from './DataFilesError.vue'
import { useEditor } from '../../editor/useEditor.ts'
import { useModelFiles } from '../../editor/useModelFiles.ts'
import { entityFiles, kindOfPath } from '../../model.ts'
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * The Data workspace's JSON tab (S3): the shown item's own `.bildr/` file (a collection's entity, a connection's data
 * source) in the raw editor, which shows what the module refuses inline and keeps the text. A collection also has a
 * switcher for the files it is linked to (its repository, its sample data, the queries that read it), one file at a
 * time, its own first. The text is the file's: choosing another file asks first when what was typed is not saved. More
 * than three queries are one select, so the strip does not wrap. A save refreshes the model, so Fields and Endpoints show
 * the change.
 */
const { path, name, linked = false } = defineProps<{
  /** The item's own file. */
  path: string | undefined
  /** The item's name: its unsaved edits are asked about as `<name> (JSON)`. */
  name: string
  /** The item is a collection: it has linked files. */
  linked?: boolean
}>()
const editor = useEditor()
const { files, invalid, loaded, error, load, refresh } = useModelFiles()

const current = ref(path ?? '')
watch(() => path, (next) => {
  current.value = next ?? ''
})

const entries = computed(() => path && linked ? entityFiles(files.value, path) : [])
/** Up to this many queries are buttons in the strip; more are one select. */
const QUERY_BUTTONS = 3
const queries = computed(() => entries.value.filter(entry => kindOfPath(entry.path) === 'query'))
const buttons = computed(() => entries.value.filter(entry => queries.value.length <= QUERY_BUTTONS || !queries.value.includes(entry)))
const queryOptions = computed(() => queries.value.map(entry => ({ label: entry.label, value: entry.path })))

/** Shows another of the item's files, once the edits that are not saved are given up. */
function choose(next: string) {
  void editor.leaveData(() => {
    current.value = next
  }, next !== current.value)
}
</script>

<template>
  <div
    class="size-full overflow-y-auto"
    data-data-json
  >
    <div class="w-full max-w-3xl space-y-3 px-0.5 py-3">
      <DataFilesError
        v-if="error"
        :message="error"
        @retry="load"
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
          class="flex items-center gap-1 overflow-x-auto"
          role="group"
          aria-label="Files of this collection"
          data-file-switcher
        >
          <button
            v-for="entry in buttons"
            :key="entry.path"
            type="button"
            class="h-7 shrink-0 rounded-lg px-2.5 text-[12px] font-[550] transition-colors"
            :class="[FOCUS_RING, current === entry.path ? 'bg-white/8 text-highlighted' : 'text-muted hover:text-default']"
            :title="entry.path"
            :aria-pressed="current === entry.path"
            :data-file-switch="entry.path"
            @click="choose(entry.path)"
          >
            {{ entry.label }}
          </button>
          <EditorSelect
            v-if="queries.length > QUERY_BUTTONS"
            :items="queryOptions"
            :model-value="queries.some(entry => entry.path === current) ? current : undefined"
            placeholder="Queries"
            aria-label="Queries of this collection"
            class="!w-48 shrink-0"
            data-queries-select
            @update:model-value="choose"
          />
        </div>
        <RawFileEditor
          :files="files"
          :invalid="invalid"
          :path="current"
          :label="`${name} (JSON)`"
          :deletable="false"
          @saved="refresh"
          @conflict="refresh"
        />
      </template>
    </div>
  </div>
</template>
