<script setup lang="ts">
import { canHideFrame, frameRange } from '#shared/editor/frames'
import { layerKeyAction } from '#shared/editor/layers'
import { filterLayers } from '#shared/editor/sidebar'
import { PRIMARY_FRAME_HINT } from '#shared/editor/viewport'

/**
 * The layers tree. Its root rows are the visible frames, Framer-style, in
 * frame order with their width range (`Tablet 1023—768`) and a Primary tag on
 * Mobile; clicking one edits that device, and the page tree sits under the
 * edited one. Hovering a frame row other than the Primary shows an eye that
 * hides the frame. While the tree has focus, ArrowUp/ArrowDown step through
 * the visible rows, ArrowLeft collapses a row or goes to its parent, and
 * ArrowRight expands it. Right-click opens the node menu. A sidebar search
 * shows only the matching rows and their ancestors, expanded. The rows
 * aren't tab stops (the tree is), so the focus ring is the tree's.
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
    class="overflow-auto rounded-lg px-2 py-2 outline-none ring-inset focus-visible:ring-1 focus-visible:ring-(color:--editor-selection)"
    role="tree"
    aria-label="Layers"
    tabindex="0"
    data-layers
    @keydown="onKeyDown"
    @mouseleave="editor.hoveredId = null"
  >
    <div
      v-for="device in editor.visibleDevices"
      :key="device.id"
      role="none"
    >
      <div
        role="treeitem"
        aria-level="1"
        :aria-selected="device.id === editor.deviceId"
        :aria-expanded="device.id === editor.deviceId"
        :title="device.breakpoint ? undefined : PRIMARY_FRAME_HINT"
        :data-frame-row="device.id"
        :data-active="device.id === editor.deviceId || undefined"
        class="group flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg ps-1 pe-1.5 text-[12px] whitespace-nowrap select-none hover:bg-white/6"
        :class="device.id === editor.deviceId ? 'text-highlighted' : 'text-toned'"
        @click="editor.setDevice(device.id)"
        @mouseenter="editor.hoveredId = null"
      >
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3.5 w-4 shrink-0 text-dimmed transition-transform"
          :class="{ '-rotate-90': device.id !== editor.deviceId }"
        />
        <UIcon
          :name="device.icon"
          class="size-4 shrink-0 text-(--editor-selection)"
        />
        <span
          class="min-w-0 flex-1 truncate font-[550]"
          data-frame-row-name
        >{{ device.label }}</span>
        <button
          v-if="canHideFrame(device.id)"
          type="button"
          tabindex="-1"
          class="flex h-full w-4 shrink-0 items-center justify-center rounded-sm text-dimmed opacity-0 group-hover:opacity-100 hover:text-highlighted"
          :aria-label="`Hide ${device.label} frame`"
          data-frame-row-hide
          @click.stop="editor.hideFrame(device.id)"
        >
          <UIcon
            name="i-lucide-eye-off"
            class="size-3.5"
          />
        </button>
        <span
          class="shrink-0 text-[10px] text-dimmed tabular-nums"
          data-frame-row-range
        >{{ device.breakpoint ? frameRange(device) : 'Primary' }}</span>
      </div>
      <div
        v-if="device.id === editor.deviceId"
        role="group"
      >
        <p
          v-if="filter && !filter.size"
          class="px-1.5 py-1 ps-6 text-xs text-dimmed"
        >
          No layers match “{{ query }}”.
        </p>
        <EditorLayerItem
          v-else-if="editor.page"
          :node="editor.page.root"
          :depth="0"
          :indent="1"
          :filter="filter"
        />
      </div>
    </div>
  </EditorNodeMenu>
</template>
