<script setup lang="ts">
import { getComponent, isContainerType } from '#shared/document/components'
import type { DocNode } from '#shared/document/schema'
import type { DropPosition } from '#shared/editor/dropTarget'
import { DRAG_MIME, draggedNodeId, dropPosition, nodeDragType, resolveDrop } from '#shared/editor/dropTarget'
import { hiddenBadge, naturalDisplay, visibilityAt, visibilityToggle } from '#shared/editor/layers'

/**
 * A layers row after Stacki's tree: 16px of indent per level, a chevron that
 * collapses the children, the type icon, the type with its text in italics,
 * and a drag handle on hover. The whole row drags and takes drops; Shift+click
 * toggles the row in the selection.
 * As in Figma, Row and Column show auto layout arrows, and hovering shows an
 * eye that hides or shows the node on the editor's device (one undo step).
 * A row hidden there is dimmed with a crossed eye; one hidden only on other
 * devices names their breakpoints.
 */
const props = defineProps<{ node: DocNode, depth: number }>()
const editor = useEditor()
const row = useTemplateRef<HTMLElement>('row')

const icon = computed(() => {
  const { type, style } = props.node
  if (type === 'Row' || type === 'Column') return (style.direction ?? (type === 'Row' ? 'row' : 'col')).startsWith('row') ? 'i-lucide-arrow-right' : 'i-lucide-arrow-down'
  if (type === 'Grid') return 'i-lucide-grid-3x3'
  return getComponent(type)?.icon ?? 'i-lucide-file'
})
const isRoot = computed(() => props.depth === 0)
const name = computed(() => (isRoot.value ? editor.page?.name ?? 'Page' : props.node.type))
const preview = computed(() => {
  const text = props.node.props.text ?? props.node.props.label
  return !isRoot.value && typeof text === 'string' ? text : ''
})
const hasChildren = computed(() => props.node.children.length > 0)
const collapsed = computed(() => editor.collapsed.has(props.node.id))
const selected = computed(() => editor.selectedIds.includes(props.node.id))
const dropAt = ref<DropPosition | null>(null)

const hidden = computed(() => visibilityAt(props.node.style, editor.deviceId).hidden)
const badge = computed(() => hiddenBadge(props.node.style, editor.deviceId))
function toggleVisibility() {
  editor.updateStyle(props.node.id, visibilityToggle(props.node.style, editor.deviceId, naturalDisplay(props.node)))
}

// Keyboard steps and canvas clicks can select a row that is scrolled away.
watch(selected, (value) => {
  if (value) nextTick(() => row.value?.scrollIntoView({ block: 'nearest' }))
})

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
  <div
    role="none"
  >
    <div
      ref="row"
      role="treeitem"
      :aria-selected="selected"
      :aria-expanded="hasChildren ? !collapsed : undefined"
      :aria-level="depth + 1"
      :data-layer-id="node.id"
      :data-layer-hidden="hidden ? '' : undefined"
      :draggable="!isRoot"
      class="group flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pe-1 text-xs whitespace-nowrap select-none"
      :class="[
        selected ? 'bg-primary/10 text-highlighted' : editor.hoveredId === node.id ? 'bg-elevated text-highlighted' : 'text-toned hover:bg-elevated',
        dropAt && DROP_CLASS[dropAt]
      ]"
      :style="{ paddingLeft: `${2 + depth * 16}px` }"
      @click="editor.selectRow(node.id, $event.shiftKey)"
      @mouseenter="editor.hoveredId = node.id"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @dragend="dropAt = null"
    >
      <button
        v-if="hasChildren"
        type="button"
        tabindex="-1"
        class="flex h-full w-4 shrink-0 items-center justify-center rounded-sm text-dimmed hover:text-highlighted"
        :aria-label="collapsed ? `Expand ${name}` : `Collapse ${name}`"
        data-layer-toggle
        @click.stop="editor.setCollapsed(node.id, !collapsed)"
      >
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3 transition-transform"
          :class="{ '-rotate-90': collapsed }"
        />
      </button>
      <span
        v-else
        class="w-4 shrink-0"
      />
      <UIcon
        :name="icon"
        class="size-3.5 shrink-0"
        :class="[selected ? 'text-primary' : 'text-dimmed group-hover:text-muted', { 'opacity-45': hidden }]"
      />
      <span
        class="min-w-0 flex-1 truncate"
        :class="{ 'opacity-45': hidden }"
      >
        <span class="font-medium">{{ name }}</span>
        <span
          v-if="preview"
          class="ms-1.5 text-dimmed italic"
        >{{ preview }}</span>
      </span>
      <span
        v-if="badge"
        class="shrink-0 text-[10px] text-dimmed"
        :title="`Hidden at ${badge}`"
        data-layer-badge
      >{{ badge }}</span>
      <UIcon
        v-if="!isRoot"
        name="i-lucide-grip-vertical"
        class="size-3.5 shrink-0 cursor-grab text-dimmed opacity-0 group-hover:opacity-100"
        aria-hidden="true"
        data-layer-handle
      />
      <button
        v-if="!isRoot"
        type="button"
        tabindex="-1"
        class="flex h-full w-4 shrink-0 items-center justify-center rounded-sm hover:text-highlighted"
        :class="hidden ? 'text-muted' : 'text-dimmed opacity-0 group-hover:opacity-100'"
        :aria-label="hidden ? `Show ${name}` : `Hide ${name}`"
        :aria-pressed="hidden"
        data-layer-eye
        @click.stop="toggleVisibility"
      >
        <UIcon
          :name="hidden ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          class="size-3.5"
        />
      </button>
    </div>
    <div
      v-if="hasChildren && !collapsed"
      role="group"
    >
      <EditorLayerItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
