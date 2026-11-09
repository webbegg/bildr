<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * The lean top bar, Framer's: back, the project menu and the views (Canvas,
 * Data, Settings) on the left; undo/redo, Preview (Cmd/Ctrl+P, the draft) and
 * Publish on the right. The canvas frames set the breakpoint, so there is no
 * device toggle. The project menu renames the project in place (Rename…
 * swaps the name for an input; Enter or blur saves, Esc cancels), opens the
 * published app, the settings or the project list.
 */
const editor = useEditor()
const publishing = ref(false)
const renaming = ref(false)
const nameDraft = ref('')
const nameInput = useTemplateRef<{ inputRef?: HTMLInputElement }>('nameInput')

const VIEWS = [{ value: 'build', label: 'Canvas' }, { value: 'data', label: 'Data' }, { value: 'settings', label: 'Settings' }]

const { data: published } = useAsyncData(
  `published-${editor.projectId}`,
  () => callAction<{ url: string, version: number, publishedAt: string } | null>('project_published_info', { projectId: editor.projectId })
)

async function startRename() {
  nameDraft.value = editor.project?.name ?? ''
  renaming.value = true
  await nextTick()
  nameInput.value?.inputRef?.select()
}

async function saveRename() {
  if (!renaming.value) return
  renaming.value = false
  await editor.renameProject(nameDraft.value)
}

const projectMenu = computed<DropdownMenuItem[][]>(() => [
  [{
    label: 'Rename…',
    icon: 'i-lucide-pencil',
    onSelect: () => void startRename()
  }],
  [{
    label: published.value ? `Open published app · v${published.value.version}` : 'Not published yet',
    icon: 'i-lucide-external-link',
    disabled: !published.value,
    to: published.value ? `${published.value.url}/${editor.page?.slug ?? ''}` : undefined,
    target: '_blank'
  }, {
    label: 'Project settings',
    icon: 'i-lucide-settings',
    onSelect: () => {
      editor.mode = 'settings'
    }
  }],
  [{ label: 'All projects', icon: 'i-lucide-layout-grid', to: '/' }]
])

async function publish() {
  publishing.value = true
  try {
    await editor.publish()
  } finally {
    publishing.value = false
  }
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
    <UInput
      v-if="renaming"
      ref="nameInput"
      v-model="nameDraft"
      size="sm"
      class="w-56"
      :maxlength="100"
      aria-label="Project name"
      data-project-rename
      @keydown.enter="saveRename"
      @keydown.esc="renaming = false"
      @blur="saveRename"
    />
    <UDropdownMenu
      v-else
      :items="projectMenu"
      :content="{ align: 'start' }"
    >
      <UButton
        :label="editor.project?.name"
        trailing-icon="i-lucide-chevron-down"
        color="neutral"
        variant="ghost"
        size="sm"
        class="max-w-56 font-semibold"
        data-project-menu
      />
    </UDropdownMenu>

    <EditorSegmented
      :items="VIEWS"
      :model-value="editor.mode"
      class="ms-2 w-52"
      data-mode-toggle
      @update:model-value="editor.mode = $event as 'build' | 'data' | 'settings'"
    />

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
      <UTooltip
        text="Preview the draft"
        :kbds="['meta', 'p']"
      >
        <UButton
          :to="editor.previewUrl"
          target="_blank"
          icon="i-lucide-play"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Preview"
          data-preview
        />
      </UTooltip>
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
