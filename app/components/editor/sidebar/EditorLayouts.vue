<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Layout } from '#shared/document/schema'
import type { LayoutEntry } from '~/composables/layoutEditor'
import { layoutDeleteMessage, layoutEntries } from '~/composables/layoutEditor'

/**
 * The Assets panel's Layouts: the project's page layouts, filtered by the
 * sidebar search, each counting the pages that use it. "+" creates one and
 * opens it in the layout view, a click opens one, and deleting one names
 * the pages that will detach and asks first.
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

async function remove({ layout, pages }: LayoutEntry) {
  if (confirm(layoutDeleteMessage(layout, pages))) await editor.run('layout_delete', { layoutId: layout.id })
}

function menu(entry: LayoutEntry): DropdownMenuItem[] {
  const { layout } = entry
  return [
    { label: 'Edit layout', icon: 'i-lucide-pencil-ruler', onSelect: () => editor.editLayout(layout.id) },
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(layout) },
    { label: 'Delete…', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove(entry) }
  ]
}
</script>

<template>
  <section data-assets-layouts>
    <div class="mb-1 flex items-center justify-between">
      <p class="text-xs font-semibold text-muted uppercase">
        Layouts
      </p>
      <UTooltip text="New layout">
        <UButton
          icon="i-lucide-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="New layout"
          @click="editor.createLayout()"
        />
      </UTooltip>
    </div>
    <p
      v-if="!editor.project?.layouts.length"
      class="text-xs text-dimmed"
    >
      None yet. A layout frames the pages that use it.
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
      <UInput
        v-if="renamingId === entry.layout.id"
        v-model="renameValue"
        size="sm"
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
          class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg ps-1.5 pe-8 text-left text-sm"
          :class="entry.layout.id === editor.layoutId ? 'bg-white/8 font-medium text-highlighted' : 'text-toned hover:bg-white/4'"
          :title="`${entry.layout.name}: used by ${entry.pages.map(p => p.name).join(', ') || 'no pages'}`"
          :aria-current="entry.layout.id === editor.layoutId ? 'true' : undefined"
          @click="editor.editLayout(entry.layout.id)"
          @dblclick="startRename(entry.layout)"
        >
          <UIcon
            name="i-lucide-layout-template"
            class="size-4 shrink-0 text-sky-400"
          />
          <span class="truncate">{{ entry.layout.name }}</span>
          <span
            class="ms-auto shrink-0 text-[11px] text-dimmed tabular-nums"
            :data-layout-pages="entry.pages.length"
          >{{ entry.pages.length }}</span>
        </button>
        <UDropdownMenu :items="menu(entry)">
          <UButton
            icon="i-lucide-ellipsis"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Layout actions"
            class="absolute end-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          />
        </UDropdownMenu>
      </template>
    </div>
  </section>
</template>
