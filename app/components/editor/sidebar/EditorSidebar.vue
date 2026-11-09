<script setup lang="ts">
/**
 * The Canvas view's left sidebar, Framer's: a Pages / Layers / Assets
 * switcher with a "+" that opens the Insert panel (also `I`), and a search
 * that filters the panel showing (Cmd/Ctrl+F focuses it; Escape clears it,
 * then leaves it). A canvas selection made while Pages shows reveals it in
 * Layers.
 */
type Panel = 'pages' | 'layers' | 'assets'

const editor = useEditor()
const panel = ref<Panel>('pages')
const query = ref('')
const search = useTemplateRef<{ inputRef?: HTMLInputElement }>('search')

const PANELS = [{ value: 'pages', label: 'Pages' }, { value: 'layers', label: 'Layers' }, { value: 'assets', label: 'Assets' }]
const placeholder = computed(() => `Search ${panel.value}`)

watch(panel, () => {
  query.value = ''
})

watch(() => editor.selectedIds, (ids) => {
  if (ids.length && panel.value === 'pages') panel.value = 'layers'
})

watch(() => editor.searchRequest, () => {
  const input = search.value?.inputRef
  input?.focus()
  input?.select()
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
    <div class="flex items-center gap-1 px-2 pt-2">
      <EditorSegmented
        :items="PANELS"
        :model-value="panel"
        class="flex-1"
        dense
        data-sidebar-switcher
        @update:model-value="panel = $event as Panel"
      />
      <UPopover
        v-model:open="editor.insertOpen"
        :content="{ side: 'right', align: 'start', sideOffset: 8 }"
      >
        <UTooltip
          text="Insert"
          :kbds="['i']"
        >
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Insert"
            data-insert-button
          />
        </UTooltip>
        <template #content>
          <EditorPalette @done="editor.insertOpen = false" />
        </template>
      </UPopover>
    </div>
    <div class="px-2 py-2">
      <UInput
        ref="search"
        v-model="query"
        icon="i-lucide-search"
        size="xs"
        :placeholder="placeholder"
        :aria-label="placeholder"
        class="w-full"
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
