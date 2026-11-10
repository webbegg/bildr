<script setup lang="ts">
/** The Data view's right panel: the shown collection and its fields, or the record picked in the table. */
const editor = useEditor()
const record = computed(() => (editor.recordId ? editor.records.find(r => r.id === editor.recordId) ?? null : null))
</script>

<template>
  <template v-if="editor.collection">
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
