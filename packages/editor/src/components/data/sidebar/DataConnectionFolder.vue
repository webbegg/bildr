<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useEditor } from '../../../editor/useEditor.ts'
import type { DataConnection } from '../../../shared/dataModel.ts'

/**
 * A connection in the Synced section, Framer's folder: a chevron that shows or hides its
 * collections, the name (click shows the connection in the right panel, double-click renames)
 * and a hover `…` menu. Its collections sit indented under it with their counts, then `+ Add…`
 * (emits `add`). A connection is a REST data source: renaming is `datasource_update`.
 */
const { connection, counts } = defineProps<{ connection: DataConnection, counts: Record<string, number> }>()
const emit = defineEmits<{ add: [] }>()
const editor = useEditor()
const open = ref(true)
const shown = computed(() => editor.connectionId === connection.id)
const collections = computed(() => editor.collections.filter(entry => entry.datasource === connection.id))
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
  if (name && name !== connection.name) await editor.run('datasource_update', { datasource: connection.id, name })
}

function show() {
  editor.connectionId = connection.id
  editor.mode = 'data'
}

/**
 * Deletes the connection. `datasource_delete` is refused while collections use it, so one that
 * has some goes with them: each collection first (each is undoable, and one refused stops it).
 */
async function remove() {
  const used = collections.value
  const names = used.map(entry => entry.name)
  const ok = await editor.confirm(used.length
    ? {
        title: `Delete "${connection.name}" with its ${used.length === 1 ? 'collection' : `${used.length} collections`}?`,
        description: `"${connection.name}" is used by ${names.join(', ')}, so it can only be deleted with ${used.length === 1 ? 'that collection' : 'those collections'}. Each deletion can be undone.`,
        confirmLabel: 'Delete all',
        danger: true
      }
    : { title: `Delete the connection "${connection.name}"?`, description: 'Undo brings it back.', confirmLabel: 'Delete connection', danger: true })
  if (!ok) return
  for (const entry of used) {
    if (!await editor.run('entity_delete', { entity: entry.id })) return
  }
  if (await editor.run('datasource_delete', { datasource: connection.id }) && editor.connectionId === connection.id) editor.connectionId = null
}

const menu = computed<DropdownMenuItem[]>(() => [
  { label: 'Rename', icon: 'i-lucide-pencil', onSelect: startRename },
  { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => void remove() }
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
        class="flex h-9 min-w-0 flex-1 items-center rounded-lg ps-1 pe-3 text-[12px]"
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
          class="flex h-9 w-full items-center gap-2.5 rounded-lg ps-13 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
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
