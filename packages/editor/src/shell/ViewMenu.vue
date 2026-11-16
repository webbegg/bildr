<script setup lang="ts">
import { computed, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DropdownMenuItem } from '@nuxt/ui'
import EditorButton from '../components/kit/EditorButton.vue'
import EditorMenu from '../components/kit/EditorMenu.vue'
import { MENU, currentEntry } from '../editor/menu.ts'
import type { MenuEntry } from '../editor/menu.ts'
import { EDITOR_KEY } from '../editor/useEditor.ts'
import { openView } from '../editor/views.ts'

/**
 * The editor's one navigation: the brand and the "Canvas ▾" menu, named after the current view.
 * On the editor's screens a view entry sets the editor's mode (which opens the other screen when it
 * shows that view); on the other screens, where there is no editor, it opens the screen that does.
 * A screen with no entry (Migrations) shows its own name.
 */
const route = useRoute()
const router = useRouter()
const editor = inject(EDITOR_KEY, null)

const current = computed(() => currentEntry(route.name, editor?.mode ?? null))
const label = computed(() => current.value?.label ?? route.meta.title ?? '')

const choose = (entry: MenuEntry) => {
  if ('route' in entry) {
    if (route.name !== entry.route) void router.push({ name: entry.route })
  } else if (editor) {
    editor.mode = entry.view
  } else {
    openView(entry.view)
  }
}

const items = computed<DropdownMenuItem[][]>(() => [
  MENU.map(entry => ({
    label: entry.label,
    icon: entry.icon,
    type: 'checkbox',
    checked: current.value === entry,
    onSelect: () => choose(entry)
  }))
])
</script>

<template>
  <span
    class="flex items-center gap-1.5 px-2 font-semibold text-highlighted"
    data-brand
  >
    <UIcon
      name="i-lucide-blocks"
      class="size-4 text-primary"
    />bildr</span>
  <EditorMenu :items="items">
    <EditorButton
      variant="ghost"
      trailing-icon="i-lucide-chevron-down"
      class="bg-white/6 font-[550] text-highlighted hover:bg-white/10 aria-expanded:bg-white/10"
      data-view-menu
    >
      {{ label }}
    </EditorButton>
  </EditorMenu>
</template>
