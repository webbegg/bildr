<script setup lang="ts">
import { useEditor } from '../../editor/useEditor.ts'

/** The Data view with no collections yet: start one (the New collection dialog asks where its rows live), or import one from a URL. */
const editor = useEditor()
</script>

<template>
  <DataEmptyState
    icon="i-lucide-database"
    title="Add your first collection"
    heading="h2"
    data-data-empty
  >
    Collections hold your app's data, like a menu or contact messages. Agents can use them too.
    <template #actions>
      <EditorButton
        variant="primary"
        label="New collection"
        icon="i-lucide-plus"
        data-empty-new
        @click="editor.requestData('new-collection')"
      />
      <EditorButton
        label="Import from URL"
        icon="i-lucide-globe"
        data-empty-import
        @click="editor.requestData('import')"
      />
    </template>
  </DataEmptyState>
</template>
