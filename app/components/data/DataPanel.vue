<script setup lang="ts">
/** The Data view's right panel: the connection whose folder was clicked, else the shown collection and its fields, or the record picked in the table. */
const editor = useEditor()
const record = computed(() => (editor.recordId ? editor.records.find(r => r.id === editor.recordId) ?? null : null))
</script>

<template>
  <DataPanelConnection
    v-if="editor.connection"
    :key="editor.connection.id"
    :connection="editor.connection"
  />
  <template v-else-if="editor.collection">
    <DataPanelRecord
      v-if="record"
      :collection="editor.collection"
      :record="record"
    />
    <DataPanelCollection
      v-else
      :collection="editor.collection"
    />
  </template>
</template>
