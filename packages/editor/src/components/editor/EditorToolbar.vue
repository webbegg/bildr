<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useEditor } from '../../editor/useEditor.ts'
import type { EditorView } from '../../editor/useEditor.ts'
import { MOVE_TOOL } from '../../editor/tools.ts'

/**
 * The top bar, Framer's. Left: the "Canvas ▾" view menu (Canvas, Design),
 * named after the current view, then the insert icons: + opens the Insert panel
 * (`I`), Frame and Text arm their tools (`F`, `T`). Centre: the project name; while
 * editing a component or a layout, the breadcrumb (EditorBreadcrumb) instead.
 * Right: undo/redo, Preview (Cmd/Ctrl+P, opens the app on the page) in the context
 * accent. The canvas frames set the breakpoint. The `actions` slot is the hosted
 * toolbar's, where the shell puts what has no home yet (the canvas preview toggle, the
 * device switch, the regenerate and problems status).
 *
 * Not in the module: Publish, the project menu (rename, all projects, open the
 * published app) and the Data and Settings views (U7, U5).
 */
const editor = useEditor()

const VIEWS: { value: EditorView, label: string, icon: string }[] = [
  { value: 'build', label: 'Canvas', icon: 'i-lucide-pen-tool' },
  { value: 'design', label: 'Design', icon: 'i-lucide-palette' }
]
const viewLabel = computed(() => VIEWS.find(view => view.value === editor.mode)?.label)

const TOOLS = [
  { id: 'Container', label: 'Frame', icon: 'i-lucide-frame', kbd: 'f' },
  { id: 'Text', label: 'Text', icon: 'i-lucide-type', kbd: 't' }
]

const viewMenu = computed<DropdownMenuItem[][]>(() => [
  VIEWS.map(view => ({
    label: view.label,
    icon: view.icon,
    type: 'checkbox',
    checked: editor.mode === view.value,
    onSelect: () => {
      editor.mode = view.value
    }
  }))
])

function toggleTool(id: string) {
  editor.setTool(editor.tool === id ? MOVE_TOOL : id)
}
</script>

<template>
  <header class="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-default px-2">
    <div class="flex min-w-0 items-center gap-1">
      <EditorMenu :items="viewMenu">
        <EditorButton
          variant="ghost"
          trailing-icon="i-lucide-chevron-down"
          class="bg-white/6 font-[550] text-highlighted hover:bg-white/10 aria-expanded:bg-white/10"
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
          :class="{ 'bg-(--editor-selection)/20 text-(--editor-selection)': editor.tool === tool.id }"
          :data-insert-tool="tool.id"
          @click="toggleTool(tool.id)"
        />
      </UTooltip>
    </div>

    <div class="flex min-w-0 justify-center">
      <EditorBreadcrumb v-if="editor.mode === 'build' && editor.editStack.length" />
      <span
        v-else
        class="max-w-96 min-w-0 truncate px-2 font-[550] text-highlighted"
        data-project-name
      >{{ editor.model?.project.name }}</span>
    </div>

    <div class="flex items-center justify-end gap-1">
      <slot name="actions" />
      <UTooltip
        :text="editor.history.undo ? 'Undo' : 'Nothing to undo'"
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
        :text="editor.history.redo ? 'Redo' : 'Nothing to redo'"
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
      <UTooltip
        text="Preview the draft"
        :kbds="['meta', 'p']"
      >
        <EditorButton
          variant="ghost"
          icon="i-lucide-play"
          aria-label="Preview"
          data-preview
          @click="editor.openPreview()"
        />
      </UTooltip>
    </div>
  </header>
</template>
