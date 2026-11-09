<script setup lang="ts">
import { getComponent, isContainerType } from '#shared/document/components'
import type { DocNode } from '#shared/document/schema'
import type { DropPosition } from '#shared/editor/dropTarget'
import { DRAG_MIME, draggedNodeId, dropPosition, nodeDragType, resolveDrop } from '#shared/editor/dropTarget'
import { nodeLabel } from '#shared/runtime/render'

const props = defineProps<{ node: DocNode, depth: number }>()
const editor = useEditor()

const icon = computed(() => getComponent(props.node.type)?.icon ?? 'i-lucide-file')
const label = computed(() => (props.depth === 0 ? editor.page?.name ?? 'Page' : nodeLabel(props.node)))
const isRoot = computed(() => props.depth === 0)
const dropAt = ref<DropPosition | null>(null)

const DROP_CLASS: Record<DropPosition, string> = {
  before: 'shadow-[inset_0_2px_0_var(--ui-primary)]',
  after: 'shadow-[inset_0_-2px_0_var(--ui-primary)]',
  inside: 'ring-2 ring-inset ring-primary'
}

function onDragStart(event: DragEvent) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'node', id: props.node.id }))
  event.dataTransfer.setData(nodeDragType(props.node.id), '')
  event.dataTransfer.effectAllowed = 'move'
}

function target(event: DragEvent) {
  const types = event.dataTransfer?.types ?? []
  if (!editor.page || !types.includes(DRAG_MIME)) return null
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const position = isRoot.value
    ? 'inside'
    : dropPosition(rect, { x: event.clientX, y: event.clientY }, { container: isContainerType(props.node.type), horizontal: false })
  const slot = resolveDrop(editor.page.root, props.node.id, position, draggedNodeId(types))
  return slot ? { position, slot } : null
}

function onDragOver(event: DragEvent) {
  const drop = target(event)
  dropAt.value = drop?.position ?? null
  if (!drop) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = draggedNodeId(event.dataTransfer!.types) ? 'move' : 'copy'
}

function onDragLeave(event: DragEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) dropAt.value = null
}

function onDrop(event: DragEvent) {
  const drop = target(event)
  dropAt.value = null
  if (!drop) return
  event.preventDefault()
  editor.drop(event.dataTransfer!.getData(DRAG_MIME), drop.slot)
}
</script>

<template>
  <div>
    <button
      type="button"
      :data-layer-id="node.id"
      :draggable="!isRoot"
      class="flex w-full items-center gap-1.5 truncate py-1 pr-2 text-left text-sm"
      :class="[
        editor.selectedId === node.id ? 'bg-primary/10 text-primary' : editor.hoveredId === node.id ? 'bg-elevated' : 'text-toned',
        dropAt && DROP_CLASS[dropAt]
      ]"
      :style="{ paddingLeft: `${12 + depth * 14}px` }"
      @click="editor.selectedId = node.id"
      @mouseenter="editor.hoveredId = node.id"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @dragend="dropAt = null"
    >
      <UIcon
        :name="icon"
        class="size-3.5 shrink-0"
      />
      <span class="truncate">{{ label }}</span>
    </button>
    <EditorLayerItem
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :depth="depth + 1"
    />
  </div>
</template>
