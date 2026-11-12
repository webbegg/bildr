<script setup lang="ts">
import { getComponent, INSTANCE_TYPE, isContainerType, SLOT_FILL_TYPE } from '#shared/document/components'
import type { DocNode } from '#shared/document/schema'
import type { DropPosition } from '#shared/editor/dropTarget'
import { DRAG_MIME, draggedNodeId, dropPosition, nodeDragType, resolveDrop } from '#shared/editor/dropTarget'
import { hiddenBadge, naturalDisplay, visibilityAt, visibilityToggle } from '#shared/editor/layers'

/**
 * A layers row after Stacki's tree, at Framer's density (32px rows, 12px
 * text): 16px of indent per level, a chevron that
 * collapses the children, the type icon, the name (the type, or an instance's
 * component and a slot fill's slot) with its text in italics,
 * and a drag handle on hover. The whole row drags and takes drops; Shift+click
 * toggles the row in the selection.
 * As in Figma, Row and Column show auto layout arrows, and hovering shows an
 * eye that hides or shows the node on the editor's device (one undo step).
 * A row hidden there is dimmed with a crossed eye; one hidden only on other
 * devices names their breakpoints. With a search `filter` (the ids to show)
 * only those rows show, expanded.
 * A selected row is a solid pill in the context accent (Framer's: blue on
 * pages, purple in a component or layout); the rows under it
 * (`inSelection`) get a subtle tint of it. Instances are recognisable, as in
 * Framer: a purple component icon and a purple pill when selected; slot
 * fills a lighter purple.
 * A double-click on the name (or Rename, Cmd/Ctrl+R) renames the layer in
 * place: Enter or leaving the field saves (empty restores the derived name),
 * Escape cancels. A locked row shows a lock that unlocks it on click; locked
 * nodes stay selectable here, though not on the canvas. `indent` adds levels
 * of indent for the frame row the tree sits under.
 */
const props = withDefaults(defineProps<{ node: DocNode, depth: number, indent?: number, filter?: ReadonlySet<string> | null, inSelection?: boolean }>(), { indent: 0, filter: undefined })
const editor = useEditor()
const row = useTemplateRef<HTMLElement>('row')

const icon = computed(() => {
  const { type, style } = props.node
  if (type === 'Row' || type === 'Column') return (style.direction ?? (type === 'Row' ? 'row' : 'col')).startsWith('row') ? 'i-lucide-arrow-right' : 'i-lucide-arrow-down'
  if (type === 'Grid') return 'i-lucide-grid-3x3'
  return getComponent(type)?.icon ?? 'i-lucide-file'
})
const isRoot = computed(() => props.depth === 0)
const name = computed(() => (isRoot.value ? editor.page?.name ?? 'Page' : editor.nodeName(props.node)))
const preview = computed(() => {
  const text = props.node.props.text ?? props.node.props.label
  return !isRoot.value && typeof text === 'string' ? text : ''
})
const children = computed(() => (props.filter ? props.node.children.filter(child => props.filter!.has(child.id)) : props.node.children))
const hasChildren = computed(() => children.value.length > 0)
const collapsed = computed(() => !props.filter && editor.collapsed.has(props.node.id))
const selected = computed(() => editor.selectedIds.includes(props.node.id))
const kind = computed(() => (props.node.type === INSTANCE_TYPE ? 'instance' : props.node.type === SLOT_FILL_TYPE ? 'slot' : null))
/** The selected pill: purple for an instance (lighter for a slot fill), else the context accent. */
const pill = computed(() => (kind.value === 'instance' ? 'bg-(--editor-component)' : kind.value === 'slot' ? 'bg-(--editor-component)/70' : 'bg-(--editor-context)'))
const iconTint = computed(() => (kind.value === 'instance' ? 'text-(--editor-component)' : kind.value === 'slot' ? 'text-(--editor-component)/60' : 'text-dimmed group-hover:text-muted'))
const dropAt = ref<DropPosition | null>(null)

const renaming = computed(() => !isRoot.value && editor.renamingId === props.node.id)
const draft = ref('')
let cancelled = false
const renameField = useTemplateRef<HTMLInputElement>('renameField')
watch(renaming, (value) => {
  if (!value) return
  draft.value = props.node.name ?? name.value
  cancelled = false
  // After the node menu has closed and handed the focus back.
  requestAnimationFrame(() => {
    renameField.value?.focus()
    renameField.value?.select()
  })
}, { immediate: true, flush: 'post' })

function startRename() {
  if (!isRoot.value) editor.startRename(props.node.id)
}

function onRenameKeyDown(event: KeyboardEvent) {
  // The layers tree's arrows and the editor's shortcuts stay out of the field.
  event.stopPropagation()
  if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
  else if (event.key === 'Escape') {
    cancelled = true
    editor.renamingId = null
  }
}

function commitRename() {
  if (cancelled || editor.renamingId !== props.node.id) return
  editor.renameNode(props.node.id, draft.value)
}

const hidden = computed(() => visibilityAt(props.node.style, editor.deviceId, editor.breakpointBase).hidden)
const badge = computed(() => hiddenBadge(props.node.style, editor.deviceId, editor.frames, editor.breakpointBase))
function toggleVisibility() {
  editor.updateStyle(props.node.id, visibilityToggle(props.node.style, editor.deviceId, naturalDisplay(props.node), editor.frames, editor.breakpointBase))
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
/** The same marks on the selected row, whose solid accent fill would hide them. */
const DROP_CLASS_SELECTED: Record<DropPosition, string> = {
  before: 'shadow-[inset_0_2px_0_white]',
  after: 'shadow-[inset_0_-2px_0_white]',
  inside: 'ring-2 ring-inset ring-white'
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
      :aria-level="depth + indent + 1"
      :data-layer-id="node.id"
      :data-layer-hidden="hidden ? '' : undefined"
      :data-layer-locked="node.locked ? '' : undefined"
      :data-layer-kind="kind ?? undefined"
      :draggable="!isRoot && !renaming"
      class="group flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg pe-1.5 text-[12px] whitespace-nowrap select-none"
      :class="[
        selected
          ? `${pill} text-white`
          : inSelection
            ? (editor.hoveredId === node.id ? 'bg-(--editor-context)/15 text-highlighted' : 'bg-(--editor-context)/8 text-toned hover:bg-(--editor-context)/15')
            : editor.hoveredId === node.id ? 'bg-white/6 text-highlighted' : 'text-toned hover:bg-white/6',
        dropAt && (selected ? DROP_CLASS_SELECTED : DROP_CLASS)[dropAt]
      ]"
      :style="{ paddingLeft: `${4 + (depth + indent) * 16}px` }"
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
        class="flex h-full w-4 shrink-0 items-center justify-center rounded-sm"
        :class="selected ? 'text-white/70 hover:text-white' : 'text-dimmed hover:text-highlighted'"
        :aria-label="collapsed ? `Expand ${name}` : `Collapse ${name}`"
        data-layer-toggle
        @click.stop="editor.setCollapsed(node.id, !collapsed)"
      >
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3.5 transition-transform"
          :class="{ '-rotate-90': collapsed }"
        />
      </button>
      <span
        v-else
        class="w-4 shrink-0"
      />
      <UIcon
        :name="icon"
        class="size-4 shrink-0"
        :class="[selected ? 'text-white' : iconTint, { 'opacity-45': hidden && !selected }]"
      />
      <input
        v-if="renaming"
        ref="renameField"
        v-model="draft"
        type="text"
        maxlength="100"
        :aria-label="`Rename ${name}`"
        class="h-6 min-w-0 flex-1 rounded-md bg-default px-1.5 text-[12px] text-highlighted outline-none ring-1 ring-(color:--editor-selection)"
        data-layer-rename
        @click.stop
        @dblclick.stop
        @keydown="onRenameKeyDown"
        @blur="commitRename"
      >
      <span
        v-else
        class="min-w-0 flex-1 truncate"
        :class="{ 'opacity-45': hidden && !selected }"
        data-layer-name
        @dblclick.stop="startRename"
      >
        <span :class="selected ? 'font-[550]' : 'font-[450]'">{{ name }}</span>
        <span
          v-if="preview"
          class="ms-1.5 italic"
          :class="selected ? 'text-white/70' : 'text-dimmed'"
        >{{ preview }}</span>
      </span>
      <span
        v-if="badge"
        class="shrink-0 text-[10px]"
        :class="selected ? 'text-white/70' : 'text-dimmed'"
        :title="`Hidden at ${badge}`"
        data-layer-badge
      >{{ badge }}</span>
      <button
        v-if="node.locked"
        type="button"
        tabindex="-1"
        class="flex h-full w-4 shrink-0 items-center justify-center rounded-sm"
        :class="selected ? 'text-white/70 hover:text-white' : 'text-muted hover:text-highlighted'"
        :aria-label="`Unlock ${name}`"
        title="Locked on the canvas: click to unlock"
        data-layer-lock
        @click.stop="editor.setLocked([node.id], false)"
      >
        <UIcon
          name="i-lucide-lock"
          class="size-3.5"
        />
      </button>
      <UIcon
        v-if="!isRoot && !renaming"
        name="i-lucide-grip-vertical"
        class="size-3.5 shrink-0 cursor-grab opacity-0 group-hover:opacity-100"
        :class="selected ? 'text-white/70' : 'text-dimmed'"
        aria-hidden="true"
        data-layer-handle
      />
      <button
        v-if="!isRoot"
        type="button"
        tabindex="-1"
        class="flex h-full w-4 shrink-0 items-center justify-center rounded-sm"
        :class="[selected ? 'text-white/70 hover:text-white' : hidden ? 'text-muted hover:text-highlighted' : 'text-dimmed hover:text-highlighted', { 'opacity-0 group-hover:opacity-100': !hidden }]"
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
        v-for="child in children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :indent="indent"
        :filter="filter"
        :in-selection="selected || inSelection"
      />
    </div>
  </div>
</template>
