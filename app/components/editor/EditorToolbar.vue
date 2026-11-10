<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { EditorView } from '#shared/editor/commands'
import { MOVE_TOOL } from '#shared/editor/insertTools'

/**
 * The top bar, Framer's. Left: the "Canvas ▾" view menu (Canvas, Data,
 * Design, Settings, back to the projects, the published app), named after the
 * current view, then the insert icons: + opens the Insert panel (`I`),
 * Frame and Text arm their tools (`F`, `T`). Centre: the project name and
 * slug with the project menu, which renames in place (Rename… swaps the name
 * for an input; Enter or blur saves, Esc cancels). Right: undo/redo, Preview
 * (Cmd/Ctrl+P, the draft) and Publish. The canvas frames set the breakpoint.
 */
const editor = useEditor()
const publishing = ref(false)
const renaming = ref(false)
const nameDraft = ref('')
const nameInput = useTemplateRef<{ select: () => void }>('nameInput')

const VIEWS: { value: EditorView, label: string, icon: string }[] = [
  { value: 'build', label: 'Canvas', icon: 'i-lucide-pen-tool' },
  { value: 'data', label: 'Data', icon: 'i-lucide-database' },
  { value: 'design', label: 'Design', icon: 'i-lucide-palette' },
  { value: 'settings', label: 'Settings', icon: 'i-lucide-settings' }
]
const viewLabel = computed(() => VIEWS.find(view => view.value === editor.mode)?.label)

const TOOLS = [
  { id: 'Container', label: 'Frame', icon: 'i-lucide-frame', kbd: 'f' },
  { id: 'Text', label: 'Text', icon: 'i-lucide-type', kbd: 't' }
]

const { data: published } = useAsyncData(
  `published-${editor.projectId}`,
  () => callAction<{ url: string, version: number, publishedAt: string } | null>('project_published_info', { projectId: editor.projectId })
)

const openPublished = computed<DropdownMenuItem>(() => ({
  label: published.value ? `Open published app · v${published.value.version}` : 'Not published yet',
  icon: 'i-lucide-external-link',
  disabled: !published.value,
  to: published.value ? `${published.value.url}/${editor.page?.slug ?? ''}` : undefined,
  target: '_blank'
}))

const viewMenu = computed<DropdownMenuItem[][]>(() => [
  VIEWS.map(view => ({
    label: view.label,
    icon: view.icon,
    type: 'checkbox',
    checked: editor.mode === view.value,
    onSelect: () => {
      editor.mode = view.value
    }
  })),
  [{ label: 'Back to projects', icon: 'i-lucide-arrow-left', to: '/' }, openPublished.value]
])

function toggleTool(id: string) {
  editor.setTool(editor.tool === id ? MOVE_TOOL : id)
}

async function startRename() {
  nameDraft.value = editor.project?.name ?? ''
  renaming.value = true
  await nextTick()
  nameInput.value?.select()
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
  [openPublished.value, {
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
  <header class="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-default px-2">
    <div class="flex min-w-0 items-center gap-1">
      <EditorMenu :items="viewMenu">
        <EditorButton
          variant="ghost"
          trailing-icon="i-lucide-chevron-down"
          class="bg-white/6 font-semibold text-highlighted hover:bg-white/10 aria-expanded:bg-white/10"
          data-view-menu
        >
          <UIcon
            name="i-lucide-blocks"
            class="size-4 text-highlighted"
          />
          {{ viewLabel }}
        </EditorButton>
      </EditorMenu>
      <span class="mx-1 h-4 w-px bg-(--ui-border)" />
      <UPopover
        v-model:open="editor.insertOpen"
        :content="{ side: 'bottom', align: 'start', sideOffset: 8 }"
      >
        <UTooltip
          text="Insert"
          :kbds="['i']"
        >
          <EditorButton
            variant="ghost"
            icon="i-lucide-plus"
            aria-label="Insert"
            :disabled="editor.mode !== 'build'"
            :class="{ 'bg-white/10 text-highlighted': editor.insertOpen }"
            data-insert-button
          />
        </UTooltip>
        <template #content>
          <EditorPalette @done="editor.insertOpen = false" />
        </template>
      </UPopover>
      <UTooltip
        v-for="tool in TOOLS"
        :key="tool.id"
        :text="tool.label"
        :kbds="[tool.kbd]"
      >
        <EditorButton
          variant="ghost"
          :icon="tool.icon"
          :aria-label="`${tool.label} tool`"
          :aria-pressed="editor.tool === tool.id"
          :disabled="editor.mode !== 'build'"
          :class="{ 'bg-(--editor-selection)/20 text-[#4cb3ff]': editor.tool === tool.id }"
          :data-insert-tool="tool.id"
          @click="toggleTool(tool.id)"
        />
      </UTooltip>
    </div>

    <div class="flex min-w-0 justify-center">
      <EditorInput
        v-if="renaming"
        ref="nameInput"
        v-model="nameDraft"
        class="w-56"
        :maxlength="100"
        aria-label="Project name"
        data-project-rename
        @keydown.enter="saveRename"
        @keydown.esc="renaming = false"
        @blur="saveRename"
      />
      <EditorMenu
        v-else
        :items="projectMenu"
        :content="{ align: 'center' }"
      >
        <EditorButton
          variant="ghost"
          class="max-w-96 min-w-0"
          data-project-menu
        >
          <span class="truncate font-semibold text-highlighted">{{ editor.project?.name }}</span>
          <span class="shrink-0 font-normal text-dimmed">· /{{ editor.project?.slug }}</span>
        </EditorButton>
      </EditorMenu>
    </div>

    <div class="flex items-center justify-end gap-1">
      <UTooltip
        :text="editor.history.undo ? `Undo ${editor.history.undo}` : 'Nothing to undo'"
        :kbds="['meta', 'z']"
      >
        <EditorButton
          variant="ghost"
          icon="i-lucide-undo-2"
          aria-label="Undo"
          :disabled="!editor.history.undo"
          @click="editor.undo()"
        />
      </UTooltip>
      <UTooltip
        :text="editor.history.redo ? `Redo ${editor.history.redo}` : 'Nothing to redo'"
        :kbds="['meta', 'shift', 'z']"
      >
        <EditorButton
          variant="ghost"
          icon="i-lucide-redo-2"
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
        <EditorButton
          variant="ghost"
          :to="editor.previewUrl"
          target="_blank"
          icon="i-lucide-play"
          aria-label="Preview"
          data-preview
        />
      </UTooltip>
      <EditorButton
        variant="primary"
        label="Publish"
        class="ms-1 px-3"
        :loading="publishing"
        @click="publish"
      />
    </div>
  </header>
</template>
