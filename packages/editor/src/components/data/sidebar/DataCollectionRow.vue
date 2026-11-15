<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useEditor } from '../../../editor/useEditor.ts'
import type { DataCollection } from '../../../shared/dataModel.ts'

/**
 * A Data sidebar row, Framer CMS's: the collection's icon (globe for one read through a
 * connection), name and row count, `indent`ed inside a connection's folder. Click shows it,
 * double-click renames inline, and the hover `…` menu renames or deletes it. A collection is
 * an entity: renaming is `entity_update`, deleting `entity_delete` (refused while pages use it).
 */
const { collection, count, indent = false } = defineProps<{ collection: DataCollection, count?: number, indent?: boolean }>()
const editor = useEditor()
const shown = computed(() => editor.collection?.id === collection.id && !editor.connectionId)
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
  if (name && name !== collection.name) await editor.run('entity_update', { entity: collection.id, name })
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
  const ok = await editor.confirm({ title: `Delete collection "${collection.name}"?`, description: 'The entity goes with its repository, queries, create action and fixtures. Undo brings it back.', confirmLabel: 'Delete collection', danger: true })
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
      @keydown.enter="commitRename"
      @keydown.esc="renaming = false"
      @blur="commitRename"
    />
    <button
      v-else
      type="button"
      class="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg pe-3 text-left text-[12px]"
      :class="[shown ? 'bg-white/8 font-medium text-highlighted' : 'text-toned hover:bg-white/4', indent ? 'ps-13' : 'ps-3']"
      :title="collection.name"
      :aria-current="shown ? 'true' : undefined"
      :data-collection="collection.plural"
      @click="show"
      @dblclick="startRename"
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
        class="absolute end-3 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
      />
    </EditorMenu>
  </div>
</template>
