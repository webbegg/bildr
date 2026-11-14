<script setup lang="ts">
import { computed, ref } from 'vue'
import CommitInput from './CommitInput.vue'
import { useDesign } from './store.ts'

/**
 * The Layouts section of the left sidebar: the project's layouts (a row opens
 * one in the canvas), create one (empty, or from the top-level layers selected
 * on a page that has none), rename, duplicate and delete. A delete the module
 * refuses (pages use the layout) shows its message in the toolbar.
 */

const design = useDesign()
const name = ref('')
const renaming = ref<string | null>(null)

/** The selected layers can become a layout when they are all top-level layers of a page without one. */
const fromSelection = computed(() => {
  const page = design.fileKind.value === 'page' ? design.file.value as { layout?: string, root: { children?: Array<{ id: string }> } } : null
  const ids = design.selectedIds.value
  const top = page?.root.children?.map(child => child.id) ?? []
  return page && !page.layout && ids.length > 0 && ids.every(id => top.includes(id)) ? ids : null
})

const create = async () => {
  const out = await design.edit('layout_create', name.value.trim() ? { name: name.value.trim() } : {})
  if (!out) return
  name.value = ''
  if (typeof out.layoutId === 'string' && design.files.value.some(file => file.id === out.layoutId)) design.openFile(out.layoutId)
}
const createFromSelection = async () => {
  if (!fromSelection.value) return
  const out = await design.edit('layout_create_from_selection', { page: design.fileId.value!, nodeIds: [...fromSelection.value], ...(name.value.trim() ? { name: name.value.trim() } : {}) })
  if (out) name.value = ''
}
const rename = async (id: string, next: string) => {
  renaming.value = null
  if (next.trim()) await design.edit('layout_rename', { layout: id, name: next.trim() })
}
</script>

<template>
  <div
    class="flex flex-col gap-2 p-2"
    data-testid="layouts-panel"
  >
    <div class="flex items-center gap-1">
      <CommitInput
        :model-value="name"
        data-testid="layout-new-name"
        placeholder="New layout name"
        @commit="name = $event"
      />
      <UButton
        data-testid="layout-new"
        icon="i-lucide-plus"
        aria-label="New layout"
        title="New layout"
        size="xs"
        color="neutral"
        variant="soft"
        @click="create()"
      />
      <UButton
        data-testid="layout-from-selection"
        icon="i-lucide-panels-top-left"
        aria-label="Make a layout from the selection"
        title="Make a layout from the selected top-level layers of a page without one"
        size="xs"
        color="neutral"
        variant="soft"
        :disabled="!fromSelection"
        @click="createFromSelection()"
      />
    </div>
    <ul class="flex flex-col gap-0.5">
      <li
        v-for="layout in design.layouts.value"
        :key="layout.id"
        class="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-elevated"
        :class="{ 'bg-elevated': design.fileId.value === layout.id }"
      >
        <CommitInput
          v-if="renaming === layout.id"
          data-testid="layout-rename-input"
          :model-value="layout.name"
          @commit="rename(layout.id, $event)"
        />
        <button
          v-else
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
          :data-testid="`layout-open-${layout.id}`"
          @click="design.openFile(layout.id)"
        >
          <UIcon
            name="i-lucide-panels-top-left"
            class="size-4 shrink-0 text-muted"
          />
          <span
            class="truncate"
            data-testid="layout-row"
          >{{ layout.name }}</span>
        </button>
        <UButton
          :data-testid="`layout-rename-${layout.id}`"
          icon="i-lucide-pencil"
          aria-label="Rename"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="renaming = layout.id"
        />
        <UButton
          :data-testid="`layout-duplicate-${layout.id}`"
          icon="i-lucide-copy"
          aria-label="Duplicate"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="design.edit('layout_duplicate', { layout: layout.id })"
        />
        <UButton
          :data-testid="`layout-delete-${layout.id}`"
          icon="i-lucide-trash-2"
          aria-label="Delete"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="design.edit('layout_delete', { layout: layout.id })"
        />
      </li>
    </ul>
    <p
      v-if="!design.layouts.value.length"
      class="px-1 text-xs text-muted"
    >
      No layouts yet.
    </p>
  </div>
</template>
