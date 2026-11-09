<script setup lang="ts">
import { COMPONENTS } from '#shared/document/components'
import { DRAG_MIME } from '#shared/editor/dropTarget'
import { matches } from '#shared/editor/sidebar'

/**
 * The Insert panel's list (Framer's `I`): the components with a search box.
 * A click (or Enter, for the first match) inserts at the selection; a drag
 * drops onto the canvas or the layers. Emits `done` after either.
 */
const emit = defineEmits<{ done: [] }>()
const editor = useEditor()
const query = ref('')
const shown = computed(() => COMPONENTS.filter(c => matches(query.value, c.label, c.type)))

function onDragStart(event: DragEvent, type: string) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'component', type }))
  event.dataTransfer.effectAllowed = 'copy'
}

function insert(type: string) {
  emit('done')
  editor.insert(type)
}
</script>

<template>
  <div
    class="w-60 p-1.5"
    data-insert-panel
  >
    <UInput
      v-model="query"
      icon="i-lucide-search"
      size="sm"
      placeholder="Search components"
      aria-label="Search components"
      autofocus
      class="mb-1.5 w-full"
      @keydown.enter.prevent="shown[0] && insert(shown[0].type)"
    />
    <div class="max-h-80 overflow-y-auto">
      <UTooltip
        v-for="component in shown"
        :key="component.type"
        :text="component.description"
        :content="{ side: 'right' }"
        :delay-duration="500"
      >
        <button
          type="button"
          draggable="true"
          :data-palette-type="component.type"
          class="flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-toned hover:bg-elevated active:cursor-grabbing"
          @dragstart="onDragStart($event, component.type)"
          @dragend="emit('done')"
          @click="insert(component.type)"
        >
          <UIcon
            :name="component.icon"
            class="size-3.5 shrink-0 text-dimmed"
          />
          <span class="truncate">{{ component.label }}</span>
        </button>
      </UTooltip>
      <p
        v-if="!shown.length"
        class="px-2 py-1.5 text-xs text-dimmed"
      >
        No components match.
      </p>
    </div>
    <p class="mt-1.5 border-t border-default px-2 pt-1.5 text-[11px] text-dimmed">
      Click to insert at the selection, or drag onto the canvas.
    </p>
  </div>
</template>
