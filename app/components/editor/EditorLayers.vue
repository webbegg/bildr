<script setup lang="ts">
import { layerKeyAction } from '#shared/editor/layers'
import { filterLayers } from '#shared/editor/sidebar'

/**
 * The layers tree. While it has focus, ArrowUp/ArrowDown step through the
 * visible rows, ArrowLeft collapses a row or goes to its parent, and
 * ArrowRight expands it. Right-click opens the node menu. A sidebar search
 * shows only the matching rows and their ancestors, expanded.
 */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()
const filter = computed(() => (editor.page ? filterLayers(editor.page.root, query) : null))

function onKeyDown(event: KeyboardEvent) {
  const root = editor.page?.root
  if (!root || event.metaKey || event.ctrlKey || event.altKey) return
  const action = layerKeyAction(root, editor.collapsed, editor.selectedId, event.key)
  if (!action) return
  event.preventDefault()
  if ('select' in action) editor.selectedId = action.select
  else if ('collapse' in action) editor.setCollapsed(action.collapse, true)
  else editor.setCollapsed(action.expand, false)
}
</script>

<template>
  <EditorNodeMenu
    class="overflow-auto px-1.5 py-2 outline-none"
    role="tree"
    aria-label="Layers"
    tabindex="0"
    data-layers
    @keydown="onKeyDown"
    @mouseleave="editor.hoveredId = null"
  >
    <p
      v-if="filter && !filter.size"
      class="px-1.5 py-1 text-xs text-dimmed"
    >
      No layers match “{{ query }}”.
    </p>
    <EditorLayerItem
      v-else-if="editor.page"
      :node="editor.page.root"
      :depth="0"
      :filter="filter"
    />
  </EditorNodeMenu>
</template>
