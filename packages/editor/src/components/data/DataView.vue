<script setup lang="ts">
import { useEditor } from '../../editor/useEditor.ts'

/** The Data view centre: the shown collection's rows table, or the empty start. */
const editor = useEditor()
</script>

<template>
  <div>
    <DataRecords v-if="editor.collection" />
    <DataEmpty v-else />
  </div>
</template>
