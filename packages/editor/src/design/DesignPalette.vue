<script setup lang="ts">
import { computed } from 'vue'
import { DRAG_MIME, dragPayload } from './layersDrag.ts'
import { nodeIcon } from './icons.ts'
import { useDesign } from './store.ts'

/**
 * What can be inserted (`catalog_get`): node types, and the project's
 * components. A click inserts next to the selection (`node_insert`); a drag
 * onto the canvas inserts at the drop slot the canvas shows.
 */

const design = useDesign()
const HIDDEN = ['Page', 'Instance', 'SlotFill']

const types = computed(() => (design.catalog.value?.nodeTypes ?? []).filter(entry => entry.insertable !== false && !HIDDEN.includes(entry.type)))
// A component can't hold an instance of itself.
const components = computed(() => (design.catalog.value?.components ?? []).filter(entry => entry.id !== design.fileId.value))

const drag = (event: DragEvent, payload: Parameters<typeof dragPayload>[0]) => {
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(DRAG_MIME, dragPayload(payload))
}
</script>

<template>
  <div
    class="flex flex-col gap-3 p-2"
    data-testid="palette"
  >
    <div class="grid grid-cols-2 gap-1">
      <button
        v-for="entry in types"
        :key="entry.type"
        type="button"
        :data-testid="`palette-${entry.type}`"
        :title="entry.description"
        draggable="true"
        class="flex items-center gap-2 rounded-md border border-default px-2 py-1.5 text-left text-sm hover:bg-elevated"
        @click="design.insert({ type: entry.type })"
        @dragstart="drag($event, { insert: entry.type })"
      >
        <UIcon
          :name="nodeIcon(entry.type)"
          class="size-4 shrink-0 text-muted"
        />
        <span class="truncate">{{ entry.label }}</span>
      </button>
    </div>
    <template v-if="components.length">
      <h3 class="px-1 text-xs font-medium text-muted">
        Components
      </h3>
      <div class="grid grid-cols-2 gap-1">
        <button
          v-for="entry in components"
          :key="entry.id"
          type="button"
          :data-testid="`palette-component-${entry.id}`"
          draggable="true"
          class="flex items-center gap-2 rounded-md border border-default px-2 py-1.5 text-left text-sm hover:bg-elevated"
          @click="design.insertComponent(entry.id)"
          @dragstart="drag($event, { component: entry.id })"
        >
          <UIcon
            name="i-lucide-component"
            class="size-4 shrink-0 text-muted"
          />
          <span class="truncate">{{ entry.name }}</span>
        </button>
      </div>
    </template>
  </div>
</template>
