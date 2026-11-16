<script setup lang="ts">
import { ref } from 'vue'
import { useEditor } from '../../editor/useEditor.ts'
import { uniqueEntityName } from '../../shared/dataModel.ts'

/** The Data view with no collections yet: start one, or import one from an API. */
const editor = useEditor()
const creating = ref(false)

async function newCollection() {
  creating.value = true
  await editor.createCollection(uniqueEntityName('Untitled', editor.collections))
  creating.value = false
}
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
        :loading="creating"
        data-empty-new
        @click="newCollection"
      />
      <EditorButton
        label="Import from API"
        icon="i-lucide-globe"
        data-empty-import
        @click="editor.importRequest++"
      />
    </template>
  </DataEmptyState>
</template>
