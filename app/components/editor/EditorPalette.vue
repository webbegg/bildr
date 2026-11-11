<script setup lang="ts">
import { COMPONENTS } from '#shared/document/components'
import { DRAG_MIME } from '#shared/editor/dropTarget'
import { matches } from '#shared/editor/sidebar'
import { insertableComponents, instanceDragPayload } from '~/composables/componentEditor'

/**
 * The Insert panel's list (Framer's `I`): the project's own components (as
 * instances; in the component view, not one that would contain itself),
 * then the built-in ones, with a search box. A click (or Enter, for the
 * first match) inserts at the selection; a drag drops onto the canvas or the
 * layers. Emits `done` after either.
 */
const emit = defineEmits<{ done: [] }>()
const editor = useEditor()
const query = ref('')
const shown = computed(() => COMPONENTS.filter(c => matches(query.value, c.label, c.type)))
const own = computed(() => (editor.project ? insertableComponents(editor.project, editor.componentId).filter(c => matches(query.value, c.name)) : []))

function onDragStart(event: DragEvent, payload: string) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(DRAG_MIME, payload)
  event.dataTransfer.effectAllowed = 'copy'
}

function insert(type: string) {
  emit('done')
  editor.insert(type)
}

function insertInstance(componentId: string) {
  emit('done')
  editor.insertInstance(componentId)
}

function insertFirst() {
  if (own.value[0]) insertInstance(own.value[0].id)
  else if (shown.value[0]) insert(shown.value[0].type)
}
</script>

<template>
  <div
    class="w-60 p-1.5"
    data-insert-panel
  >
    <EditorInput
      v-model="query"
      icon="i-lucide-search"
      placeholder="Search components"
      aria-label="Search components"
      autofocus
      class="mb-1.5"
      @keydown.enter.prevent="insertFirst"
    />
    <div class="max-h-80 overflow-y-auto">
      <template v-if="own.length">
        <p class="px-2 pt-1 pb-0.5 text-[11px] font-[550] text-dimmed uppercase">
          Components
        </p>
        <button
          v-for="component in own"
          :key="component.id"
          type="button"
          draggable="true"
          :data-palette-component="component.id"
          class="flex w-full cursor-grab items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-toned hover:bg-white/8 hover:text-highlighted active:cursor-grabbing"
          :class="FOCUS_RING"
          @dragstart="onDragStart($event, instanceDragPayload(component.id))"
          @dragend="emit('done')"
          @click="insertInstance(component.id)"
        >
          <UIcon
            name="i-lucide-component"
            class="size-4 shrink-0 text-violet-400"
          />
          <span class="truncate">{{ component.name }}</span>
        </button>
        <p class="px-2 pt-2 pb-0.5 text-[11px] font-[550] text-dimmed uppercase">
          Built-in
        </p>
      </template>
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
          class="flex w-full cursor-grab items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-toned hover:bg-white/8 hover:text-highlighted active:cursor-grabbing"
          :class="FOCUS_RING"
          @dragstart="onDragStart($event, JSON.stringify({ kind: 'component', type: component.type }))"
          @dragend="emit('done')"
          @click="insert(component.type)"
        >
          <UIcon
            :name="component.icon"
            class="size-4 shrink-0 text-dimmed"
          />
          <span class="truncate">{{ component.label }}</span>
        </button>
      </UTooltip>
      <p
        v-if="!shown.length && !own.length"
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
