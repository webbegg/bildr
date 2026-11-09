<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const editor = createEditor(String(route.params.projectId))
provide(EDITOR_KEY, editor)
useProjectSync(editor)

const sidebarTabs = [
  { label: 'Layers', icon: 'i-lucide-layers', slot: 'layers' as const },
  { label: 'Components', icon: 'i-lucide-blocks', slot: 'components' as const }
]

const loadError = ref<string | null>(null)
onMounted(() => editor.reload().catch((error) => {
  loadError.value = actionErrorMessage(error)
}))

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

function onKeyDown(event: KeyboardEvent) {
  if (isEditable(event.target)) return
  if (editor.shortcut(event.key, event.metaKey || event.ctrlKey, event.shiftKey)) event.preventDefault()
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

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
        <UTabs
          :items="sidebarTabs"
          variant="link"
          size="sm"
          class="min-h-0 flex-1 gap-0"
          :ui="{ list: 'px-3', content: 'min-h-0 flex-1' }"
        >
          <template #layers>
            <EditorLayers class="h-full" />
          </template>
          <template #components>
            <EditorPalette class="h-full" />
          </template>
        </UTabs>
      </aside>
      <main class="min-w-0 flex-1 bg-muted p-4">
        <EditorCanvas @key="message => editor.shortcut(message.key, message.meta, message.shift)" />
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
