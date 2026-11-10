<script setup lang="ts">
/**
 * The Canvas view's left sidebar, Framer's: Pages / Layers / Assets as plain
 * text tabs (the current one white on a soft pill), and a search that filters
 * the panel showing (Cmd/Ctrl+F focuses it; Escape clears it, then leaves
 * it). A canvas selection made while Pages shows reveals it in Layers. The
 * panel lives on the editor, so quick actions can open Assets.
 */
import type { SidebarPanel } from '#shared/editor/commands'

const editor = useEditor()
const panel = toRef(editor, 'sidebarPanel')
const query = ref('')
const search = useTemplateRef<{ focus: () => void, select: () => void }>('search')

const PANELS = [{ value: 'pages', label: 'Pages' }, { value: 'layers', label: 'Layers' }, { value: 'assets', label: 'Assets' }]
const placeholder = computed(() => `Search ${panel.value}`)

watch(panel, () => {
  query.value = ''
})

watch(() => editor.selectedIds, (ids) => {
  if (ids.length && panel.value === 'pages') panel.value = 'layers'
})

watch(() => editor.searchRequest, () => {
  search.value?.focus()
  search.value?.select()
})

function onSearchKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (query.value) query.value = ''
  else (event.target as HTMLElement).blur()
}
</script>

<template>
  <div
    class="flex flex-col"
    data-sidebar
  >
    <div
      class="flex items-center gap-0.5 px-2 pt-2"
      role="tablist"
      aria-label="Sidebar"
      data-sidebar-switcher
    >
      <button
        v-for="item in PANELS"
        :key="item.value"
        type="button"
        role="tab"
        :aria-selected="panel === item.value"
        class="h-7 rounded-lg px-2.5 text-[12px] font-[550] transition-colors"
        :class="[FOCUS_RING, panel === item.value ? 'bg-white/8 text-highlighted' : 'text-muted hover:text-default']"
        @click="panel = item.value as SidebarPanel"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="border-b border-default px-2 py-2">
      <EditorInput
        ref="search"
        v-model="query"
        icon="i-lucide-search"
        :placeholder="placeholder"
        :aria-label="placeholder"
        data-sidebar-search
        @keydown="onSearchKeyDown"
      />
    </div>
    <EditorPages
      v-if="panel === 'pages'"
      :query="query"
      class="min-h-0 flex-1"
    />
    <template v-else-if="panel === 'layers'">
      <EditorPageSwitcher />
      <EditorLayers
        :query="query"
        class="min-h-0 flex-1"
      />
    </template>
    <EditorAssets
      v-else
      :query="query"
      class="min-h-0 flex-1"
    />
  </div>
</template>
