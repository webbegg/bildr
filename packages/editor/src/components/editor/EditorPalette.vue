<script setup lang="ts">
import { computed, ref } from 'vue'
import { nodeIcon } from '../../design/icons.ts'
import { FOCUS_RING } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { insertableComponents } from '../../shared/componentEditor.ts'
import { DRAG_MIME, instancePayload, insertPayload } from '../../shared/dropTarget.ts'
import { layoutDragPayload } from '../../shared/layoutEditor.ts'
import { insertId } from '../../shared/presets.ts'
import { matches } from '../../shared/sidebar.ts'

/**
 * The Insert panel (Framer's `I`): the project's own components and
 * layouts as tiles with a thumbnail of each (EditorInsertThumb), then the
 * built-in components with their icons, all filtered by the search box.
 * Components insert as instances (in the component view, not one that would
 * contain itself); a layout tile sets the page's layout (pages only). A
 * click (or Enter, for the first match) acts at the selection; a drag drops
 * onto the canvas or the layers. Emits `done` after either. The built-in
 * components are the store's catalog (`catalog_get`).
 */
const emit = defineEmits<{ done: [] }>()
const editor = useEditor()
const query = ref('')
const HIDDEN = ['Page', 'Instance', 'SlotFill']
const builtIn = computed(() => (editor.catalog?.nodeTypes ?? []).filter(entry => entry.insertable !== false && !HIDDEN.includes(entry.type)))
const shown = computed(() => builtIn.value.filter(c => matches(query.value, c.label, c.type)).map(c => ({ ...c, id: insertId(c) })))
const own = computed(() => (editor.model ? insertableComponents(editor.model, editor.componentId).filter(c => matches(query.value, c.name)) : []))
const onPage = computed(() => !editor.componentId && !editor.layoutId)
const layouts = computed(() => (onPage.value ? editor.layouts.filter(l => matches(query.value, l.name)) : []))
const pageLayoutId = computed(() => editor.currentPage?.layout)

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

function useLayout(layoutId: string) {
  emit('done')
  void editor.setPageLayout(layoutId)
}

function insertFirst() {
  if (own.value[0]) insertInstance(own.value[0].id)
  else if (layouts.value[0]) useLayout(layouts.value[0].id)
  else if (shown.value[0]) insert(shown.value[0].id)
}

const TILE = 'flex w-full cursor-grab flex-col gap-1 rounded-lg p-1 text-left text-[11px] text-toned hover:bg-white/8 hover:text-highlighted active:cursor-grabbing'
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
    <div class="max-h-96 overflow-y-auto">
      <template v-if="own.length">
        <p class="px-2 pt-1 pb-0.5 text-[11px] font-[550] text-dimmed uppercase">
          Components
        </p>
        <div class="grid grid-cols-2 gap-0.5">
          <button
            v-for="component in own"
            :key="component.id"
            type="button"
            draggable="true"
            :title="component.name"
            :data-palette-component="component.id"
            :class="[TILE, FOCUS_RING]"
            @dragstart="onDragStart($event, instancePayload(component.id))"
            @dragend="emit('done')"
            @click="insertInstance(component.id)"
          >
            <EditorInsertThumb
              :id="component.id"
              kind="component"
            />
            <span class="flex min-w-0 items-center gap-1 px-0.5">
              <UIcon
                name="i-lucide-component"
                class="size-3 shrink-0 text-(--editor-component)"
              />
              <span class="truncate">{{ component.name }}</span>
            </span>
          </button>
        </div>
      </template>
      <template v-if="layouts.length">
        <p class="px-2 pt-2 pb-0.5 text-[11px] font-[550] text-dimmed uppercase">
          Layouts
        </p>
        <div class="grid grid-cols-2 gap-0.5">
          <button
            v-for="layout in layouts"
            :key="layout.id"
            type="button"
            draggable="true"
            :title="layout.id === pageLayoutId ? `${layout.name}: this page's layout` : `Use ${layout.name} on this page`"
            :aria-current="layout.id === pageLayoutId ? 'true' : undefined"
            :data-palette-layout="layout.id"
            :class="[TILE, FOCUS_RING, layout.id === pageLayoutId ? 'bg-(--editor-component)/12' : '']"
            @dragstart="onDragStart($event, layoutDragPayload(layout.id))"
            @dragend="emit('done')"
            @click="useLayout(layout.id)"
          >
            <EditorInsertThumb
              :id="layout.id"
              kind="layout"
            />
            <span class="flex min-w-0 items-center gap-1 px-0.5">
              <UIcon
                name="i-lucide-layout-template"
                class="size-3 shrink-0 text-(--editor-component)"
              />
              <span class="truncate">{{ layout.name }}</span>
            </span>
          </button>
        </div>
      </template>
      <p
        v-if="own.length || layouts.length"
        class="px-2 pt-2 pb-0.5 text-[11px] font-[550] text-dimmed uppercase"
      >
        Built-in
      </p>
      <UTooltip
        v-for="component in shown"
        :key="component.id"
        :text="component.description"
        :content="{ side: 'right' }"
        :delay-duration="500"
      >
        <button
          type="button"
          draggable="true"
          :data-palette-type="component.id"
          class="flex w-full cursor-grab items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-toned hover:bg-white/8 hover:text-highlighted active:cursor-grabbing"
          :class="FOCUS_RING"
          @dragstart="onDragStart($event, insertPayload(component.id))"
          @dragend="emit('done')"
          @click="insert(component.id)"
        >
          <UIcon
            :name="nodeIcon(component.id)"
            class="size-4 shrink-0 text-dimmed"
          />
          <span class="truncate">{{ component.label }}</span>
        </button>
      </UTooltip>
      <p
        v-if="!shown.length && !own.length && !layouts.length"
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
