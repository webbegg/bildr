<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { ARTIFACT_KINDS } from '../../../shared/dataArtifacts.ts'
import type { ArtifactKind } from '../../../shared/dataArtifacts.ts'
import { dataItemKey } from '../../../editor/dataTabs.ts'
import { TREE_STOP } from '../../../editor/dataTree.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import { SELECTED_ITEM } from '../../../editorUi.ts'
import type { DataArtifact } from '../../../shared/dataModel.ts'

/**
 * A query, an action or a state in the Data tree (S10, B2): an icon, its label (the name when it has none) and the collection it works on as
 * a grey subtitle (a state has none). Click shows it in the workspace; the `…` menu (on hover, and always on the row shown or focused) renames or
 * deletes it, and so do F2 and Delete (or Backspace) on the focused row (the dialogs are the tree's, which `rename` and `delete`
 * ask for). It is a tree item (`DataTree.vue`): the tab stop when it is the one the tree names.
 */
const { kind, item } = defineProps<{ kind: ArtifactKind, item: DataArtifact }>()
const emit = defineEmits<{ rename: [], delete: [] }>()
const editor = useEditor()
const key = computed(() => dataItemKey({ kind, id: item.id }))
const stop = inject(TREE_STOP, ref(''))
const shown = computed(() => editor.dataShown?.kind === kind && editor.dataShown.id === item.id)
const words = computed(() => ARTIFACT_KINDS[kind])
const ICONS: Record<ArtifactKind, string> = { query: 'i-lucide-list-filter', action: 'i-lucide-zap', state: 'i-lucide-toggle-right' }

function show() {
  if (kind === 'query') editor.queryId = item.id
  else if (kind === 'action') editor.actionId = item.id
  else editor.stateId = item.id
  editor.mode = 'data'
}

const menu = computed<DropdownMenuItem[]>(() => [
  { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => emit('rename') },
  { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('delete') }
])
</script>

<template>
  <div class="group relative flex items-center px-2">
    <button
      type="button"
      class="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg ps-3 pe-9 text-left"
      :class="shown ? SELECTED_ITEM : 'text-toned hover:bg-white/4'"
      :title="item.name"
      role="treeitem"
      :aria-selected="shown"
      aria-level="1"
      :tabindex="stop === key ? 0 : -1"
      :data-tree-item="key"
      :data-artifact="item.id"
      @click="show"
      @keydown.f2.prevent="emit('rename')"
      @keydown.delete.prevent="emit('delete')"
    >
      <UIcon
        :name="ICONS[kind]"
        class="size-4 shrink-0"
        :class="shown ? 'text-highlighted' : 'text-dimmed'"
      />
      <span class="flex min-w-0 flex-col">
        <span
          class="truncate text-[12px] leading-4"
          data-artifact-label
        >{{ item.label }}</span>
        <span
          v-if="item.collectionName"
          class="truncate text-[11px] leading-4 text-dimmed"
          data-artifact-collection
        >{{ item.collectionName }}</span>
      </span>
    </button>
    <EditorMenu :items="menu">
      <EditorButton
        icon="i-lucide-ellipsis"
        variant="ghost"
        size="xs"
        :aria-label="`${words.label} options`"
        class="absolute end-3 data-[state=open]:opacity-100"
        :class="shown ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'"
        :data-artifact-menu="item.id"
      />
    </EditorMenu>
  </div>
</template>
