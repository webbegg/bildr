<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Page } from '#shared/document/schema'

const editor = useEditor()

const newName = ref('')
const adding = ref(false)
const renamingId = ref<string | null>(null)
const renameValue = ref('')

async function addPage() {
  const name = newName.value.trim()
  if (!name) return
  const result = await editor.run<{ pageId: string }>('page_add', { name })
  if (result) {
    editor.selectPage(result.pageId)
    newName.value = ''
    adding.value = false
  }
}

function startRename(page: Page) {
  renamingId.value = page.id
  renameValue.value = page.name
}

async function commitRename() {
  const pageId = renamingId.value
  renamingId.value = null
  const page = editor.project?.pages.find(p => p.id === pageId)
  const name = renameValue.value.trim()
  if (page && name && name !== page.name) await editor.run('page_rename', { pageId, name })
}

function menu(page: Page): DropdownMenuItem[] {
  return [
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(page) },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      disabled: (editor.project?.pages.length ?? 0) < 2,
      onSelect: () => {
        if (confirm(`Delete page "${page.name}"?`)) editor.run('page_delete', { pageId: page.id })
      }
    }
  ]
}
</script>

<template>
  <div class="border-b border-default pb-2">
    <div class="flex items-center justify-between px-3 pt-3 pb-1">
      <p class="text-xs font-semibold text-muted uppercase">
        Pages
      </p>
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="Add page"
        @click="adding = !adding"
      />
    </div>
    <form
      v-if="adding"
      class="px-3 pb-2"
      @submit.prevent="addPage"
    >
      <UInput
        v-model="newName"
        size="sm"
        placeholder="Page name"
        autofocus
        class="w-full"
        @keydown.esc="adding = false"
      />
    </form>
    <div
      v-for="page in editor.project?.pages"
      :key="page.id"
      class="group flex items-center gap-1 px-1.5"
    >
      <UInput
        v-if="renamingId === page.id"
        v-model="renameValue"
        size="sm"
        autofocus
        class="flex-1"
        @keydown.enter="commitRename"
        @keydown.esc="renamingId = null"
        @blur="commitRename"
      />
      <button
        v-else
        type="button"
        class="flex flex-1 items-center gap-2 truncate rounded-md px-1.5 py-1 text-left text-sm"
        :class="page.id === editor.page?.id ? 'bg-elevated font-medium text-highlighted' : 'text-toned hover:bg-elevated/50'"
        @click="editor.selectPage(page.id)"
        @dblclick="startRename(page)"
      >
        <UIcon
          name="i-lucide-file"
          class="size-3.5 shrink-0"
        />
        <span class="truncate">{{ page.name }}</span>
        <span class="ms-auto truncate text-xs text-dimmed">/{{ page.slug }}</span>
      </button>
      <UDropdownMenu :items="menu(page)">
        <UButton
          icon="i-lucide-ellipsis"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Page actions"
          class="opacity-0 group-hover:opacity-100"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>
