<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { ModelNode } from '@bildr/codegen/model'
import { nodeIcon } from './icons.ts'
import { DRAG_MIME, dragPayload, draggingLayer, dropMark, positionIn } from './layersDrag.ts'
import { useDesign } from './store.ts'
import { moveTarget } from './tree.ts'

/**
 * One row of the layers tree and its children: select (Shift toggles), rename
 * (double click), lock, collapse, and drag to reorder (`node_move`). The root
 * can't be moved, and a row can't be dropped into its own subtree.
 */

const props = defineProps<{ node: ModelNode, depth: number, root?: boolean, collapsed: Set<string> }>()
const emit = defineEmits<{ toggle: [id: string] }>()

const design = useDesign()
const editing = ref(false)
const input = useTemplateRef<HTMLInputElement>('input')

const selected = computed(() => design.selectedIds.value.includes(props.node.id))
const open = computed(() => !props.collapsed.has(props.node.id))
const hasChildren = computed(() => !!props.node.children?.length)
const label = computed(() => {
  const text = props.node.props?.text
  return props.node.name ?? (typeof text === 'string' && text ? text : props.node.type)
})
const mark = computed(() => dropMark.value?.id === props.node.id ? dropMark.value.position : null)

const startRename = async () => {
  if (props.root) return
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
const commitRename = (event: Event) => {
  editing.value = false
  const name = (event.target as HTMLInputElement).value
  if (name !== (props.node.name ?? '')) void design.rename(props.node.id, name)
}

const onDragStart = (event: DragEvent) => {
  if (props.root || !event.dataTransfer) return
  draggingLayer.value = props.node.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(DRAG_MIME, dragPayload({ move: props.node.id }))
  event.dataTransfer.setData(`${DRAG_MIME}-node;${props.node.id}`, '')
}
const onDragOver = (event: DragEvent) => {
  const dragged = draggingLayer.value
  if (!dragged) return
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const position = positionIn(event.clientY - box.top, box.height, design.isContainer(props.node.type) && props.node.type !== 'Instance')
  const target = design.file.value ? moveTarget(design.file.value.root, dragged, props.node.id, position) : null
  if (!target) {
    dropMark.value = null
    return
  }
  event.preventDefault()
  dropMark.value = { id: props.node.id, position }
}
const onDrop = (event: DragEvent) => {
  const dragged = draggingLayer.value
  const target = dropMark.value
  draggingLayer.value = null
  dropMark.value = null
  if (!dragged || !target || target.id !== props.node.id) return
  event.preventDefault()
  void design.dropOnLayer(dragged, props.node.id, target.position)
}
const onDragEnd = () => {
  draggingLayer.value = null
  dropMark.value = null
}
</script>

<template>
  <li role="none">
    <div
      role="treeitem"
      data-testid="layer"
      :data-node-id="node.id"
      :aria-selected="selected"
      :draggable="!root"
      class="relative flex cursor-default items-center gap-1 rounded-sm py-0.5 pr-1 text-sm"
      :class="[selected ? 'bg-primary/15 text-highlighted' : 'hover:bg-elevated', draggingLayer === node.id ? 'opacity-40' : '']"
      :style="{ paddingLeft: `${depth * 12 + 4}px` }"
      @click.exact="design.selectNode(node.id)"
      @click.shift="design.selectNode(node.id, true)"
      @dblclick="startRename"
      @mouseenter="design.hoveredId.value = node.id"
      @mouseleave="design.hoveredId.value = null"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @drop="onDrop"
      @dragend="onDragEnd"
    >
      <button
        v-if="hasChildren"
        type="button"
        class="grid size-4 place-items-center text-muted"
        :aria-label="open ? 'Collapse' : 'Expand'"
        @click.stop="emit('toggle', node.id)"
      >
        <UIcon
          :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3"
        />
      </button>
      <span
        v-else
        class="size-4"
      />
      <UIcon
        :name="nodeIcon(node.type)"
        class="size-3.5 shrink-0 text-muted"
      />
      <input
        v-if="editing"
        ref="input"
        data-testid="layer-rename"
        class="min-w-0 flex-1 rounded-sm border border-primary bg-default px-1 text-sm"
        :value="node.name ?? ''"
        @click.stop
        @change="commitRename"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @keydown.esc.stop="editing = false"
        @blur="editing = false"
      >
      <span
        v-else
        class="min-w-0 flex-1 truncate"
      >{{ label }}</span>
      <button
        v-if="!root"
        type="button"
        :data-testid="`layer-lock-${node.id}`"
        class="grid size-4 place-items-center"
        :class="node.locked ? 'text-primary' : 'text-muted/40 hover:text-default'"
        :aria-label="node.locked ? 'Unlock' : 'Lock'"
        @click.stop="design.setLocked(node.id, !node.locked)"
      >
        <UIcon
          :name="node.locked ? 'i-lucide-lock' : 'i-lucide-lock-open'"
          class="size-3"
        />
      </button>
      <span
        v-if="mark"
        class="pointer-events-none absolute right-0 left-0 bg-primary"
        :class="mark === 'before' ? 'top-0 h-0.5' : mark === 'after' ? 'bottom-0 h-0.5' : 'inset-0 rounded-sm bg-primary/20 ring-1 ring-primary'"
      />
    </div>
    <ul
      v-if="hasChildren && open"
      role="group"
    >
      <LayerItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :collapsed="collapsed"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
</template>
