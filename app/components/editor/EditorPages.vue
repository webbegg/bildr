<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Page } from '#shared/document/schema'
import { filterPages, pageRowLabel } from '#shared/editor/sidebar'

/**
 * The Pages panel, Framer's: a "Pages" header with Add page, then a row per
 * page named by its path (`/pricing`; the home page, the first, is `Home`
 * with a house icon), filtered by the sidebar search. Double-click renames.
 */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()
const pages = computed(() => {
  const homeId = editor.project?.pages[0]?.id
  return filterPages(editor.project?.pages ?? [], query).map(page => ({ page, home: page.id === homeId, ...pageRowLabel(page, page.id === homeId) }))
})

const newName = ref('')
const adding = ref(false)
const renamingId = ref<string | null>(null)
const renameValue = ref('')

async function addPage() {
  const name = newName.value.trim()
  if (!name) return
  if (await editor.addPage(name)) {
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
  <div class="overflow-y-auto pb-2">
    <div class="flex items-center justify-between ps-3.5 pe-2 pt-2.5 pb-1.5">
      <p class="text-sm font-semibold text-highlighted">
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
    <p
      v-if="query && !pages.length"
      class="px-3 py-2 text-xs text-dimmed"
    >
      No pages match “{{ query }}”.
    </p>
    <div
      v-for="{ page, home, path, hint } in pages"
      :key="page.id"
      class="group relative flex items-center px-2"
      :data-page-id="page.id"
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
        class="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg ps-3 pe-8 text-left text-sm"
        :class="page.id === editor.page?.id ? 'bg-white/8 font-medium text-highlighted' : 'text-toned hover:bg-white/4'"
        :title="page.name"
        :aria-current="page.id === editor.page?.id ? 'page' : undefined"
        :data-page-home="home || undefined"
        @click="editor.selectPage(page.id)"
        @dblclick="startRename(page)"
      >
        <UIcon
          :name="home ? 'i-lucide-house' : 'i-lucide-file'"
          class="size-4 shrink-0"
          :class="page.id === editor.page?.id ? 'text-highlighted' : 'text-dimmed'"
        />
        <span class="truncate">{{ path }}</span>
        <span
          v-if="hint"
          class="truncate text-xs font-normal text-dimmed"
        >{{ hint }}</span>
      </button>
      <UDropdownMenu :items="menu(page)">
        <UButton
          icon="i-lucide-ellipsis"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Page actions"
          class="absolute end-3 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>
