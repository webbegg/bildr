<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Collection } from '#shared/document/schema'

/** The Data mode sidebar: the project's collections, with add and delete. */
const editor = useEditor()

const newName = ref('')
const adding = ref(false)
const fromApi = ref(false)

async function addCollection() {
  const name = newName.value.trim()
  if (!name) return
  const result = await editor.run<{ collectionId: string }>('collection_create', { name })
  if (result) {
    editor.collectionId = result.collectionId
    newName.value = ''
    adding.value = false
  }
}

function menu(collection: Collection): DropdownMenuItem[] {
  return [{
    label: 'Delete',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => {
      if (confirm(`Delete collection "${collection.name}"? Undo brings it back with its records.`)) editor.run('collection_delete', { collection: collection.id })
    }
  }]
}
</script>

<template>
  <div class="overflow-y-auto pb-2">
    <div class="flex items-center justify-between px-3 pt-3 pb-1">
      <p class="text-xs font-semibold text-muted uppercase">
        Collections
      </p>
      <div class="flex items-center gap-0.5">
        <UButton
          icon="i-lucide-globe"
          label="From API"
          size="xs"
          color="neutral"
          variant="ghost"
          data-from-api
          @click="fromApi = true"
        />
        <UButton
          icon="i-lucide-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Add collection"
          @click="adding = !adding"
        />
      </div>
    </div>
    <UModal
      v-model:open="fromApi"
      title="Collection from an API"
      description="Paste a JSON endpoint, review the proposed mapping, then save. The records stay live and read-only."
      :ui="{ content: 'sm:max-w-5xl' }"
    >
      <template #body>
        <DataApiSource @done="fromApi = false" />
      </template>
    </UModal>
    <form
      v-if="adding"
      class="px-3 pb-2"
      @submit.prevent="addCollection"
    >
      <UInput
        v-model="newName"
        size="sm"
        placeholder="Collection name"
        autofocus
        class="w-full"
        @keydown.esc="adding = false"
      />
    </form>
    <p
      v-if="!editor.project?.collections.length && !adding"
      class="px-3 py-2 text-xs text-dimmed"
    >
      No collections yet. Add one to store data such as a menu or contact messages.
    </p>
    <div
      v-for="collection in editor.project?.collections"
      :key="collection.id"
      class="group flex items-center gap-1 px-1.5"
    >
      <button
        type="button"
        class="flex flex-1 items-center gap-2 truncate rounded-md px-1.5 py-1 text-left text-sm"
        :class="collection.id === editor.collection?.id ? 'bg-elevated font-medium text-highlighted' : 'text-toned hover:bg-elevated/50'"
        :data-collection="collection.slug"
        @click="editor.collectionId = collection.id"
      >
        <UIcon
          :name="collection.source.type === 'api' ? 'i-lucide-globe' : 'i-lucide-database'"
          class="size-3.5 shrink-0"
        />
        <span class="truncate">{{ collection.name }}</span>
        <span class="ms-auto truncate text-xs text-dimmed">{{ collection.fields.length }} {{ collection.fields.length === 1 ? 'field' : 'fields' }}</span>
      </button>
      <UDropdownMenu :items="menu(collection)">
        <UButton
          icon="i-lucide-ellipsis"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Collection actions"
          class="opacity-0 group-hover:opacity-100"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>
