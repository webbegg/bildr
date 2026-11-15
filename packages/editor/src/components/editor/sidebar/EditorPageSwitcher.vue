<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useEditor } from '../../../editor/useEditor.ts'
import { pageRowLabel } from '../../../shared/sidebar.ts'

/** The Layers panel's page switcher, Framer's: the current page by path with a menu of the others, and Add page. */
const editor = useEditor()
const adding = ref(false)
const newName = ref('')

const isHome = (path: string | undefined) => path === '/'
const current = computed(() => (editor.currentPage ? pageRowLabel(editor.currentPage, isHome(editor.currentPage.path)) : null))

const items = computed<DropdownMenuItem[]>(() => editor.pages.map((page) => {
  const { path, hint } = pageRowLabel(page, isHome(page.path))
  return {
    label: hint ? `${path}  ${hint}` : path,
    icon: isHome(page.path) ? 'i-lucide-house' : 'i-lucide-file',
    type: 'checkbox',
    checked: page.id === editor.currentPage?.id,
    onSelect: () => editor.selectPage(page.id)
  }
}))

async function addPage() {
  const name = newName.value.trim()
  if (!name) return
  if (await editor.addPage(name)) {
    newName.value = ''
    adding.value = false
  }
}
</script>

<template>
  <div
    class="border-b border-default px-2 py-1.5"
    data-page-switcher
  >
    <div class="flex items-center gap-1">
      <EditorMenu :items="items">
        <button
          type="button"
          class="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 text-left text-[12px] text-highlighted hover:bg-white/4"
          aria-label="Switch page"
        >
          <UIcon
            :name="isHome(editor.currentPage?.path) ? 'i-lucide-house' : 'i-lucide-file'"
            class="size-4 shrink-0 text-dimmed"
          />
          <span class="truncate font-medium">{{ current?.path }}</span>
          <span
            v-if="current?.hint"
            class="truncate text-xs text-dimmed"
          >{{ current.hint }}</span>
          <UIcon
            name="i-lucide-chevron-down"
            class="ms-auto size-3 shrink-0 text-dimmed"
          />
        </button>
      </EditorMenu>
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
      class="px-1.5 pt-1"
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
  </div>
</template>
