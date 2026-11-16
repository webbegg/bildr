<script setup lang="ts">
import { computed, ref } from 'vue'
import { storedPanelWidth } from '../../editor/panelWidth.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { rowId } from '../../shared/dataTable.ts'

/**
 * The Data workspace's side panel, beside the tab's main surface: the row opened in Rows, or the
 * collection's settings in Fields. No other tab has one. It is as wide as the Canvas view's right
 * panel (`editor/panelWidth.ts`, remembered across reloads).
 */
const editor = useEditor()
const width = ref(storedPanelWidth())

const collection = computed(() => editor.dataCollection)
/** The row opened in Rows, with its id; null when none is open or it is not among the rows shown. */
const record = computed(() => {
  if (editor.dataTab !== 'rows' || editor.recordId === null) return null
  const id = editor.recordId
  const row = editor.collectionRows.find((entry, at) => rowId(entry, at) === id)
  return row ? { id, row } : null
})
const showCollection = computed(() => editor.dataTab === 'fields')
</script>

<template>
  <aside
    v-if="collection && (record || showCollection)"
    class="shrink-0 overflow-y-auto border-l border-default"
    :style="{ width: `${width}px` }"
    data-data-panel
  >
    <DataPanelRecord
      v-if="record"
      :collection="collection"
      :row="record.row"
      :row-id="record.id"
    />
    <DataPanelCollection
      v-else
      :collection="collection"
    />
  </aside>
</template>
