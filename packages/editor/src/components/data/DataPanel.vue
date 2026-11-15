<script setup lang="ts">
import { computed } from 'vue'
import { useEditor } from '../../editor/useEditor.ts'
import { rowId } from '../../shared/dataTable.ts'

/** The Data view's right panel: the connection whose folder was clicked, else the shown collection and its fields, or the row picked in the table. */
const editor = useEditor()
const row = computed(() => {
  if (editor.recordId === null) return null
  const index = editor.collectionRows.findIndex((entry, at) => rowId(entry, at) === editor.recordId)
  return index < 0 ? null : editor.collectionRows[index]!
})
</script>

<template>
  <DataPanelConnection
    v-if="editor.connection"
    :key="editor.connection.id"
    :connection="editor.connection"
  />
  <template v-else-if="editor.collection">
    <DataPanelRecord
      v-if="row && editor.recordId !== null"
      :collection="editor.collection"
      :row="row"
      :row-id="editor.recordId"
    />
    <DataPanelCollection
      v-else
      :collection="editor.collection"
    />
  </template>
</template>
