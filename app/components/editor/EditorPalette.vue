<script setup lang="ts">
import { COMPONENTS } from '#shared/document/components'
import { DRAG_MIME } from '#shared/editor/dropTarget'

const editor = useEditor()

function onDragStart(event: DragEvent, type: string) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'component', type }))
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div class="overflow-y-auto p-3">
    <div class="grid grid-cols-2 gap-1.5">
      <UTooltip
        v-for="component in COMPONENTS"
        :key="component.type"
        :text="component.description"
        :content="{ side: 'right' }"
      >
        <button
          type="button"
          draggable="true"
          :data-palette-type="component.type"
          class="flex cursor-grab items-center gap-1.5 rounded-md border border-default px-2 py-1.5 text-left text-sm text-toned hover:bg-elevated active:cursor-grabbing"
          @dragstart="onDragStart($event, component.type)"
          @click="editor.insert(component.type)"
        >
          <UIcon
            :name="component.icon"
            class="size-3.5 shrink-0"
          />
          <span class="truncate">{{ component.label }}</span>
        </button>
      </UTooltip>
    </div>
    <p class="mt-3 text-xs text-dimmed">
      Drag onto the canvas or the layers, or click to insert at the selection.
    </p>
  </div>
</template>
