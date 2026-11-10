<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Collection } from '#shared/document/schema'

/**
 * A Data sidebar row, Framer CMS's: the collection's icon (globe for API
 * ones), name and record count, `indent`ed inside a connection's folder.
 * Click shows it, double-click renames inline, and the hover `…` menu
 * renames or deletes it.
 */
const { collection, count, indent = false } = defineProps<{ collection: Collection, count?: number, indent?: boolean }>()
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
  if (name && name !== collection.name) await editor.run('collection_update', { collection: collection.id, name })
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

const menu = computed<DropdownMenuItem[]>(() => [
  { label: 'Rename', icon: 'i-lucide-pencil', onSelect: startRename },
  {
    label: 'Delete',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => {
      if (confirm(`Delete collection "${collection.name}"? Undo brings it back with its records.`)) editor.run('collection_delete', { collection: collection.id })
    }
  }
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
      class="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg pe-3 text-left text-sm"
      :class="[shown ? 'bg-white/8 font-medium text-highlighted' : 'text-toned hover:bg-white/4', indent ? 'ps-13' : 'ps-3']"
      :title="collection.name"
      :aria-current="shown ? 'true' : undefined"
      :data-collection="collection.slug"
      @click="show"
      @dblclick="startRename"
    >
      <UIcon
        :name="collection.source.type === 'api' ? 'i-lucide-globe' : 'i-lucide-database'"
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
