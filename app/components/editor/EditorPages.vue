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

// Rename… mounts the field focused; the closing menu must not take the focus back (its blur would commit).
function keepRenameFocus(event: Event) {
  if (renamingId.value) event.preventDefault()
}

function menu(page: Page): DropdownMenuItem[] {
  return [
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(page) },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      disabled: (editor.project?.pages.length ?? 0) < 2,
      onSelect: async () => {
        if (await editor.confirm({ title: `Delete "${page.name}"?`, description: 'The page and its content go. Undo brings it back.', confirmLabel: 'Delete page', danger: true })) editor.run('page_delete', { pageId: page.id })
      }
    }
  ]
}
</script>

<template>
  <div class="overflow-y-auto pb-2">
    <div class="flex items-center justify-between ps-3.5 pe-2 pt-2.5 pb-1.5">
      <p class="text-[12px] font-[550] text-highlighted">
        Pages
      </p>
      <EditorButton
        variant="ghost"
        size="xs"
        icon="i-lucide-plus"
        aria-label="Add page"
        @click="adding = !adding"
      />
    </div>
    <form
      v-if="adding"
      class="px-3 pb-2"
      @submit.prevent="addPage"
    >
      <EditorInput
        v-model="newName"
        placeholder="Page name"
        aria-label="New page name"
        autofocus
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
      <EditorInput
        v-if="renamingId === page.id"
        v-model="renameValue"
        aria-label="Rename page"
        autofocus
        class="flex-1"
        @keydown.enter="commitRename"
        @keydown.esc="renamingId = null"
        @blur="commitRename"
      />
      <button
        v-else
        type="button"
        class="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg ps-3 pe-8 text-left text-[12px]"
        :class="page.id === editor.page?.id ? 'bg-white/8 font-[550] text-highlighted' : 'text-toned hover:bg-white/4'"
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
      <EditorMenu
        :items="menu(page)"
        :content="{ align: 'end' }"
        :on-close-auto-focus="keepRenameFocus"
      >
        <EditorButton
          variant="ghost"
          size="xs"
          icon="i-lucide-ellipsis"
          aria-label="Page actions"
          class="absolute end-3 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      </EditorMenu>
    </div>
  </div>
</template>
