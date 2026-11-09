<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const editor = createEditor(String(route.params.projectId))
provide(EDITOR_KEY, editor)

const loadError = ref<string | null>(null)
onMounted(() => editor.reload().catch((error) => {
  loadError.value = actionErrorMessage(error)
}))

useHead(() => ({ title: editor.project ? `${editor.project.name} · bildr` : 'bildr' }))
</script>

<template>
  <UError
    v-if="loadError"
    :error="{ statusCode: 404, statusMessage: loadError }"
  />
  <div
    v-else-if="editor.project && editor.page"
    class="flex h-screen flex-col"
  >
    <EditorToolbar />
    <div class="flex min-h-0 flex-1">
      <aside class="flex w-64 shrink-0 flex-col border-r border-default">
        <EditorPages />
        <EditorLayers class="min-h-0 flex-1" />
      </aside>
      <main class="min-w-0 flex-1 bg-muted p-4">
        <EditorCanvas />
      </main>
      <aside class="w-80 shrink-0 overflow-y-auto border-l border-default">
        <EditorInspector />
      </aside>
    </div>
  </div>
  <div
    v-else
    class="flex h-screen items-center justify-center"
  >
    <UIcon
      name="i-lucide-loader-circle"
      class="size-6 animate-spin text-dimmed"
    />
  </div>
</template>
