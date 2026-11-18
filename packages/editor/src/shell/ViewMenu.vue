<script setup lang="ts">
import { computed, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DropdownMenuItem } from '@nuxt/ui'
import ChecksDot from '../components/ChecksDot.vue'
import EditorButton from '../components/kit/EditorButton.vue'
import EditorMenu from '../components/kit/EditorMenu.vue'
import { checksSummary } from '../editor/checksSummary.ts'
import { MENU, currentEntry } from '../editor/menu.ts'
import type { MenuEntry } from '../editor/menu.ts'
import { EDITOR_KEY } from '../editor/useEditor.ts'
import { openView } from '../editor/views.ts'
import { STATUS_KEY } from '../status.ts'

/**
 * The editor's one navigation: the brand and the "Canvas ▾" menu, named after the current view.
 * On the editor's screens a view entry sets the editor's mode (which opens the other screen when it
 * shows that view); on the other screens, where there is no editor, it opens the screen that does.
 * A screen with no entry shows the `title` its route names.
 * A failure dot (`ChecksDot`, S8) is on the button and on the Checks entry while the last Health report has something wrong (`checksSummary`: a failing check,
 * model problems, a file edited by hand); the summary is the button's description and the entry's text for a screen reader. It reads the status every screen
 * shares, which the shell already keeps fresh, so it polls nothing of its own.
 */
const route = useRoute()
const router = useRouter()
const editor = inject(EDITOR_KEY, null)
const status = inject(STATUS_KEY, null)
const summary = computed(() => checksSummary(status?.health.value ?? null))

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
    ...('route' in entry && entry.route === 'health' ? { slot: 'checks' } : {}),
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
      :title="summary ?? undefined"
      data-view-menu
    >
      {{ label }}<ChecksDot
        v-if="summary"
        class="ms-1.5"
      />
    </EditorButton>
    <template #checks-trailing>
      <template v-if="summary">
        <ChecksDot />
        <span class="sr-only">, {{ summary }}</span>
      </template>
    </template>
  </EditorMenu>
</template>
