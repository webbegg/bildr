<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditor } from '../../editor/useEditor.ts'
import { rowId } from '../../shared/dataTable.ts'

/**
 * The Data workspace's side panel, beside the tab's main surface: the row opened in Rows, or the
 * collection's settings in Fields. No other tab has one. It is as wide as the Canvas view's right
 * panel (280–480px, remembered across reloads).
 */
const editor = useEditor()
const PANEL_KEY = 'bildr:panel-width'
const width = ref(Math.min(480, Math.max(280, Math.round(Number(localStorage.getItem(PANEL_KEY)) || 320))))

const row = computed(() => {
  if (editor.recordId === null) return null
  const index = editor.collectionRows.findIndex((entry, at) => rowId(entry, at) === editor.recordId)
  return index < 0 ? null : editor.collectionRows[index]!
})
const collection = computed(() => editor.dataItem?.kind === 'collection' ? editor.collection : null)
const showRecord = computed(() => editor.dataTab === 'rows' && !!collection.value && !!row.value && editor.recordId !== null)
const showCollection = computed(() => editor.dataTab === 'fields' && !!collection.value)
</script>

<template>
  <aside
    v-if="collection && (showRecord || showCollection)"
    class="shrink-0 overflow-y-auto border-l border-default"
    :style="{ width: `${width}px` }"
    data-data-panel
  >
    <DataPanelRecord
      v-if="showRecord"
      :collection="collection"
      :row="row!"
      :row-id="editor.recordId!"
    />
    <DataPanelCollection
      v-else
      :collection="collection"
    />
  </aside>
</template>
