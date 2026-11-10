<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Connection } from '#shared/document/schema'

/**
 * A connection in the Synced section, Framer's folder: a chevron that shows or
 * hides its collections, the name (click shows the connection in the right
 * panel, double-click renames) and a hover `…` menu. Its collections sit
 * indented under it with their counts, then `+ Add…` (emits `add`).
 */
const { connection, counts } = defineProps<{ connection: Connection, counts: Record<string, number> }>()
const emit = defineEmits<{ add: [] }>()
const editor = useEditor()
const open = ref(true)
const shown = computed(() => editor.connectionId === connection.id)
const collections = computed(() => editor.project?.collections.filter(c => c.source.type === 'connection' && c.source.connectionId === connection.id) ?? [])
const renaming = ref(false)
const renameValue = ref('')

function startRename() {
  renaming.value = true
  renameValue.value = connection.name
}

async function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  const name = renameValue.value.trim()
  if (name && name !== connection.name) await editor.run('connection_update', { connectionId: connection.id, name })
}

function show() {
  editor.connectionId = connection.id
  editor.mode = 'data'
}

/** Deletes the connection; one that collections use (which `connection_delete` refuses) can go with its collections. */
function remove() {
  const n = collections.value.length
  if (!n) {
    if (confirm(`Delete the connection "${connection.name}"? Undo brings it back.`)) void editor.run('connection_delete', { connectionId: connection.id })
    return
  }
  const names = collections.value.map(c => c.name).join(', ')
  if (confirm(`"${connection.name}" is used by ${names}, so it can only be deleted with ${n === 1 ? 'that collection' : `those ${n} collections`}.\n\nDelete with its ${n === 1 ? 'collection' : 'collections'}? Undo brings everything back.`)) {
    void editor.run('connection_delete', { connectionId: connection.id, force: true })
  }
}

const menu = computed<DropdownMenuItem[]>(() => [
  { label: 'Rename', icon: 'i-lucide-pencil', onSelect: startRename },
  { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: remove }
])
</script>

<template>
  <div :data-connection="connection.id">
    <div class="group relative flex items-center px-2">
      <EditorInput
        v-if="renaming"
        v-model="renameValue"
        autofocus
        class="flex-1"
        aria-label="Rename connection"
        @keydown.enter="commitRename"
        @keydown.esc="renaming = false"
        @blur="commitRename"
      />
      <div
        v-else
        class="flex h-9 min-w-0 flex-1 items-center rounded-lg ps-1 pe-3 text-sm"
        :class="shown ? 'bg-white/8 font-medium text-highlighted' : 'text-toned hover:bg-white/4'"
      >
        <button
          type="button"
          class="grid size-5 shrink-0 place-items-center rounded text-dimmed hover:text-highlighted"
          :aria-label="open ? `Collapse ${connection.name}` : `Expand ${connection.name}`"
          :aria-expanded="open"
          data-connection-toggle
          @click="open = !open"
        >
          <UIcon
            :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3.5"
          />
        </button>
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center gap-2.5 ps-0.5 text-left"
          :title="connection.name"
          :aria-current="shown ? 'true' : undefined"
          data-connection-name
          @click="show"
          @dblclick="startRename"
        >
          <UIcon
            name="i-lucide-server"
            class="size-4 shrink-0"
            :class="shown ? 'text-highlighted' : 'text-dimmed'"
          />
          <span class="truncate">{{ connection.name }}</span>
        </button>
      </div>
      <EditorMenu
        v-if="!renaming"
        :items="menu"
      >
        <EditorButton
          icon="i-lucide-ellipsis"
          variant="ghost"
          size="xs"
          aria-label="Connection actions"
          class="absolute end-3 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          data-connection-menu
        />
      </EditorMenu>
    </div>

    <template v-if="open">
      <DataCollectionRow
        v-for="collection in collections"
        :key="collection.id"
        :collection="collection"
        :count="counts[collection.id]"
        indent
      />
      <div class="px-2">
        <button
          type="button"
          class="flex h-9 w-full items-center gap-2.5 rounded-lg ps-13 text-left text-sm text-muted hover:bg-white/4 hover:text-toned"
          :aria-label="`Add a collection to ${connection.name}`"
          data-connection-add-collection
          @click="emit('add')"
        >
          <UIcon
            name="i-lucide-plus"
            class="size-4 shrink-0"
          />
          Add…
        </button>
      </div>
    </template>
  </div>
</template>
