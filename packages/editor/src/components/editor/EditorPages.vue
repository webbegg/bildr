<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { PageFile } from '@bildr/codegen/model'
import { useEditor } from '../../editor/useEditor.ts'
import { filterPages, pageRowLabel } from '../../shared/sidebar.ts'

/**
 * The Pages panel, Framer's: a "Pages" header with Add page, then a row per
 * page named by its path (`/pricing`; the home page, `/`, is `Home`
 * with a house icon), filtered by the sidebar search, and a small layout
 * badge (▭ name) on pages that use a layout. A page with route parameters
 * (a detail page, `/post/:slug`) shows its path pattern and a file-text icon. Double-click renames.
 */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()
const pages = computed(() => {
  return filterPages(editor.pages, query).map((page) => {
    const home = page.path === '/'
    return {
      page,
      home,
      detail: !!page.params?.length,
      layout: editor.layouts.find(l => l.id === page.layout) ?? null,
      ...pageRowLabel(page, home)
    }
  })
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

function startRename(page: PageFile) {
  renamingId.value = page.id
  renameValue.value = page.name
}

async function commitRename() {
  const pageId = renamingId.value
  renamingId.value = null
  const page = editor.pages.find(p => p.id === pageId)
  const name = renameValue.value.trim()
  if (page && name && name !== page.name) await editor.run('page_update', { page: pageId, name })
}

// Rename… mounts the field focused; the closing menu must not take the focus back (its blur would commit).
function keepRenameFocus(event: Event) {
  if (renamingId.value) event.preventDefault()
}

function menu(page: PageFile): DropdownMenuItem[] {
  return [
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(page) },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      disabled: editor.pages.length < 2,
      onSelect: async () => {
        if (await editor.confirm({ title: `Delete "${page.name}"?`, description: 'The page and its content go. Undo brings it back.', confirmLabel: 'Delete page', danger: true })) editor.run('page_delete', { page: page.id })
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
      v-for="{ page, home, detail, path, hint, layout } in pages"
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
        :class="page.id === editor.currentPage?.id ? 'bg-white/8 font-[550] text-highlighted' : 'text-toned hover:bg-white/4'"
        :title="page.name"
        :aria-current="page.id === editor.currentPage?.id ? 'page' : undefined"
        :data-page-home="home || undefined"
        @click="editor.selectPage(page.id)"
        @dblclick="startRename(page)"
      >
        <UIcon
          :name="home ? 'i-lucide-house' : detail ? 'i-lucide-file-text' : 'i-lucide-file'"
          class="size-4 shrink-0"
          :class="page.id === editor.currentPage?.id ? 'text-highlighted' : 'text-dimmed'"
        />
        <span class="truncate">{{ path }}</span>
        <span
          v-if="hint"
          class="truncate text-xs font-normal text-dimmed"
        >{{ hint }}</span>
        <span
          v-if="layout"
          class="ms-auto flex min-w-0 shrink items-center gap-1 rounded-md bg-(--editor-component)/12 px-1.5 py-0.5 text-[11px] font-normal text-(--editor-component)"
          :title="`Layout: ${layout.name}`"
          :data-page-layout-badge="layout.id"
        >
          <UIcon
            name="i-lucide-layout-template"
            class="size-3 shrink-0"
          />
          <span class="max-w-20 truncate">{{ layout.name }}</span>
        </span>
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
