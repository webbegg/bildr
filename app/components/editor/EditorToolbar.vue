<script setup lang="ts">
import type { DeviceId } from '#shared/editor/styleFields'
import { DEVICES } from '#shared/editor/styleFields'

const editor = useEditor()
const devices = DEVICES.map(d => ({ value: d.id, label: `${d.label} · ${d.width}px`, icon: d.icon }))
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
    <span class="text-sm text-dimmed">/ {{ editor.mode === 'data' ? editor.collection?.name ?? 'Data' : editor.page?.name }}</span>

    <EditorSegmented
      :items="[{ value: 'build', label: 'Build' }, { value: 'design', label: 'Design' }, { value: 'data', label: 'Data' }]"
      :model-value="editor.mode"
      class="ms-4 w-56"
      data-mode-toggle
      @update:model-value="editor.mode = $event as 'build' | 'design' | 'data'"
    />

    <UTooltip
      v-if="editor.mode !== 'data'"
      :text="`Active frame: ${editor.device.label} · ${editor.device.width}px; styles edit ${editor.device.breakpoint ? `${editor.device.breakpoint}:` : 'the base'}`"
    >
      <EditorSegmented
        :items="devices"
        :model-value="editor.deviceId"
        class="ms-2 w-28"
        data-device-toggle
        @update:model-value="editor.deviceId = $event as DeviceId"
      />
    </UTooltip>

    <div class="ms-auto flex items-center gap-2">
      <UTooltip
        :text="editor.history.undo ? `Undo ${editor.history.undo}` : 'Nothing to undo'"
        :kbds="['meta', 'z']"
      >
        <UButton
          icon="i-lucide-undo-2"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Undo"
          :disabled="!editor.history.undo"
          @click="editor.undo()"
        />
      </UTooltip>
      <UTooltip
        :text="editor.history.redo ? `Redo ${editor.history.redo}` : 'Nothing to redo'"
        :kbds="['meta', 'shift', 'z']"
      >
        <UButton
          icon="i-lucide-redo-2"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Redo"
          :disabled="!editor.history.redo"
          @click="editor.redo()"
        />
      </UTooltip>
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
