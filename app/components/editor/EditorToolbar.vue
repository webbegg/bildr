<script setup lang="ts">
const editor = useEditor()
const toast = useToast()
const publishing = ref(false)

const { data: published, refresh } = useAsyncData(
  `published-${editor.projectId}`,
  () => callAction<{ url: string, version: number } | null>('project_published_info', { projectId: editor.projectId })
)

async function publish() {
  publishing.value = true
  const result = await editor.run<{ url: string, version: number }>('project_publish')
  publishing.value = false
  if (!result) return
  await refresh()
  toast.add({
    title: 'Published',
    description: `Version ${result.version} is live at ${result.url}`,
    color: 'success',
    icon: 'i-lucide-rocket',
    actions: [{ label: 'Open', to: result.url, target: '_blank', color: 'neutral', variant: 'outline' }]
  })
}
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default px-3">
    <UButton
      to="/"
      icon="i-lucide-arrow-left"
      color="neutral"
      variant="ghost"
      size="sm"
      aria-label="All projects"
    />
    <span class="font-semibold">{{ editor.project?.name }}</span>
    <span class="text-sm text-dimmed">/ {{ editor.page?.name }}</span>

    <div class="ms-auto flex items-center gap-2">
      <slot name="actions" />
      <UButton
        v-if="published"
        :to="`${published.url}/${editor.page?.slug ?? ''}`"
        target="_blank"
        icon="i-lucide-external-link"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="`Live v${published.version}`"
      />
      <UButton
        icon="i-lucide-rocket"
        label="Publish"
        size="sm"
        :loading="publishing"
        @click="publish"
      />
    </div>
  </header>
</template>
