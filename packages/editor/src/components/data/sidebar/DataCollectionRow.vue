<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { dataItemKey } from '../../../editor/dataTabs.ts'
import { confirmDeleteCollection, confirmRenameCollection } from '../../../editor/dataUsage.ts'
import { TREE_STOP } from '../../../editor/dataTree.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import { SELECTED_ITEM } from '../../../editorUi.ts'
import type { DataCollection } from '../../../shared/dataModel.ts'

/**
 * A Data tree row, Framer CMS's: the collection's icon (globe for one read through a
 * connection), name and row count, `indent`ed inside a connection's folder. Click shows it,
 * double-click renames inline, and the `…` menu (on hover, and always on the row shown or focused) renames or deletes it, as do
 * F2 (rename) and Delete or Backspace (delete) on the focused row. A collection is
 * an entity: renaming is `entity_update`, deleting `entity_delete` (refused while pages use it). Both warn first, with the places that use it
 * (S5, `editor/dataUsage.ts`); a collection that is used cannot be deleted from here.
 * It is a tree item (`DataTree.vue`): the tab stop when it is the one the tree names.
 */
const { collection, count, indent = false } = defineProps<{ collection: DataCollection, count?: number, indent?: boolean }>()
const editor = useEditor()
const key = computed(() => dataItemKey({ kind: 'collection', id: collection.id }))
const stop = inject(TREE_STOP, ref(''))
const shown = computed(() => !editor.dataFiles && editor.dataItem?.kind === 'collection' && editor.dataItem.id === collection.id)
const renaming = ref(false)
const renameValue = ref('')

function startRename() {
  renaming.value = true
  renameValue.value = collection.name
}

async function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  const name = renameValue.value.trim()
  if (name && name !== collection.name && await confirmRenameCollection(editor, collection, 'name', name)) await editor.run('entity_update', { entity: collection.id, name })
}

// Rename mounts the field focused; the closing menu must not take the focus back (its blur would commit).
function keepRenameFocus(event: Event) {
  if (renaming.value) event.preventDefault()
}

function show() {
  editor.collectionId = collection.id
  editor.connectionId = null
  editor.mode = 'data'
}

async function remove() {
  const ok = await confirmDeleteCollection(editor, collection)
  if (ok) await editor.run('entity_delete', { entity: collection.id })
}

const menu = computed<DropdownMenuItem[]>(() => [
  { label: 'Rename', icon: 'i-lucide-pencil', onSelect: startRename },
  { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => void remove() }
])
</script>

<template>
  <div class="group relative flex items-center px-2">
    <EditorInput
      v-if="renaming"
      v-model="renameValue"
      autofocus
      class="flex-1"
      aria-label="Rename collection"
      @keydown.enter.prevent="commitRename"
      @keydown.esc="renaming = false"
      @blur="commitRename"
    />
    <button
      v-else
      type="button"
      class="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg pe-3 text-left text-[12px]"
      :class="[shown ? SELECTED_ITEM : 'text-toned hover:bg-white/4', indent ? 'ps-13' : 'ps-3']"
      :title="collection.name"
      role="treeitem"
      :aria-selected="shown"
      :aria-level="indent ? 2 : 1"
      :tabindex="stop === key ? 0 : -1"
      :data-collection="collection.plural"
      :data-tree-item="key"
      @click="show"
      @dblclick="startRename"
      @keydown.f2.prevent="startRename"
      @keydown.delete.prevent="remove"
    >
      <UIcon
        :name="collection.kind === 'rest' ? 'i-lucide-globe' : 'i-lucide-database'"
        class="size-4 shrink-0"
        :class="shown ? 'text-highlighted' : 'text-dimmed'"
      />
      <span class="truncate">{{ collection.name }}</span>
      <span
        class="ms-auto ps-2 text-xs font-normal text-dimmed tabular-nums group-hover:invisible group-has-data-[state=open]:invisible"
        data-collection-count
      >{{ count ?? '' }}</span>
    </button>
    <EditorMenu
      v-if="!renaming"
      :items="menu"
      :on-close-auto-focus="keepRenameFocus"
    >
      <EditorButton
        icon="i-lucide-ellipsis"
        variant="ghost"
        size="xs"
        aria-label="Collection actions"
        class="absolute end-3 data-[state=open]:opacity-100"
        :class="shown ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'"
      />
    </EditorMenu>
  </div>
</template>
