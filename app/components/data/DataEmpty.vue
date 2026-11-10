<script setup lang="ts">
import { uniqueCollectionName } from '#shared/data/collections'

/** The Data view with no collections yet: start one, or import one from an API. */
const editor = useEditor()
const creating = ref(false)

async function newCollection() {
  creating.value = true
  const result = await editor.run<{ collectionId: string }>('collection_create', { name: uniqueCollectionName('Untitled', editor.project?.collections ?? []) })
  creating.value = false
  if (result) editor.collectionId = result.collectionId
}
</script>

<template>
  <div
    class="flex size-full items-center justify-center p-6"
    data-data-empty
  >
    <div class="flex max-w-sm flex-col items-center text-center">
      <div class="mb-4 flex size-12 items-center justify-center rounded-xl bg-white/6">
        <UIcon
          name="i-lucide-database"
          class="size-6 text-toned"
        />
      </div>
      <h2 class="text-base font-semibold text-highlighted">
        Add your first collection
      </h2>
      <p class="mt-1.5 text-sm text-muted">
        Collections hold your app's data, like a menu or contact messages. Agents can use them too.
      </p>
      <div class="mt-5 flex items-center gap-2">
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
      </div>
    </div>
  </div>
</template>
