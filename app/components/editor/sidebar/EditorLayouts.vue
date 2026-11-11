<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Layout } from '#shared/document/schema'
import type { LayoutEntry } from '~/composables/layoutEditor'
import { layoutDeleteConfirm, layoutEntries } from '~/composables/layoutEditor'

/**
 * The Assets panel's Layouts: the project's page layouts, filtered by the
 * sidebar search, each counting the pages that use it. "+" opens the "New
 * layout" dialog (then the new layout's view), a click opens one, the row
 * menu duplicates one ("<name> copy"), and deleting one names the pages that
 * will detach and asks first.
 */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()

const entries = computed(() => (editor.project ? layoutEntries(editor.project, query) : []))
const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(layout: Layout) {
  renamingId.value = layout.id
  renameValue.value = layout.name
}

async function commitRename() {
  const layoutId = renamingId.value
  renamingId.value = null
  const layout = editor.project?.layouts.find(l => l.id === layoutId)
  const name = renameValue.value.trim()
  if (layout && name && name !== layout.name) await editor.run('layout_rename', { layoutId, name })
}

// Rename mounts the field focused; the closing menu must not take the focus back (its blur would commit).
function keepRenameFocus(event: Event) {
  if (renamingId.value) event.preventDefault()
}

async function remove({ layout, pages }: LayoutEntry) {
  if (await editor.confirm(layoutDeleteConfirm(layout, pages))) await editor.run('layout_delete', { layoutId: layout.id })
}

function menu(entry: LayoutEntry): DropdownMenuItem[] {
  const { layout } = entry
  return [
    { label: 'Edit layout', icon: 'i-lucide-pencil-ruler', onSelect: () => editor.editLayout(layout.id) },
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(layout) },
    { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => editor.run('layout_duplicate', { layoutId: layout.id }) },
    { label: 'Delete…', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove(entry) }
  ]
}
</script>

<template>
  <section data-assets-layouts>
    <div class="mb-1 flex items-center justify-between">
      <p class="text-xs font-[550] text-muted uppercase">
        Layouts
      </p>
      <UTooltip text="New layout">
        <EditorButton
          icon="i-lucide-plus"
          size="xs"
          variant="ghost"
          aria-label="New layout"
          @click="editor.createLayout()"
        />
      </UTooltip>
    </div>
    <p
      v-if="!editor.project?.layouts.length"
      class="text-xs text-dimmed"
      data-layouts-empty
    >
      No layouts yet. A layout frames pages with a shared nav or footer. Use + to create one.
    </p>
    <p
      v-else-if="!entries.length"
      class="text-xs text-dimmed"
    >
      No layouts match “{{ query }}”.
    </p>
    <div
      v-for="entry in entries"
      :key="entry.layout.id"
      class="group relative flex items-center"
      :data-layout-id="entry.layout.id"
    >
      <EditorInput
        v-if="renamingId === entry.layout.id"
        v-model="renameValue"
        autofocus
        class="flex-1"
        aria-label="Layout name"
        @keydown.enter="commitRename"
        @keydown.esc="renamingId = null"
        @blur="commitRename"
      />
      <template v-else>
        <button
          type="button"
          class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg ps-1.5 pe-8 text-left text-[12px]"
          :class="entry.layout.id === editor.layoutId ? 'bg-white/8 font-medium text-highlighted' : 'text-toned hover:bg-white/4'"
          :title="`${entry.layout.name}: used by ${entry.pages.map(p => p.name).join(', ') || 'no pages'}`"
          :aria-current="entry.layout.id === editor.layoutId ? 'true' : undefined"
          @click="editor.editLayout(entry.layout.id)"
          @dblclick="startRename(entry.layout)"
        >
          <UIcon
            name="i-lucide-layout-template"
            class="size-4 shrink-0 text-(--editor-component)"
          />
          <span class="truncate">{{ entry.layout.name }}</span>
          <span
            class="ms-auto shrink-0 text-[11px] text-dimmed tabular-nums"
            :data-layout-pages="entry.pages.length"
          >{{ entry.pages.length }}</span>
        </button>
        <EditorMenu
          :items="menu(entry)"
          :content="{ align: 'end' }"
          :on-close-auto-focus="keepRenameFocus"
        >
          <EditorButton
            icon="i-lucide-ellipsis"
            size="xs"
            variant="ghost"
            aria-label="Layout actions"
            class="absolute end-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          />
        </EditorMenu>
      </template>
    </div>
  </section>
</template>
