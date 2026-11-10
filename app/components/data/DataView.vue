<script setup lang="ts">
/** The Data view centre: the shown collection's records table, or the empty start. */
const editor = useEditor()
</script>

<template>
  <div>
    <DataRecords v-if="editor.collection" />
    <DataEmpty v-else />
  </div>
</template>
