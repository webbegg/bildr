<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { Theme } from '#shared/design/theme'
import type { Page } from '#shared/document/schema'
import type { CanvasToEditor, CanvasView, EditorToCanvas } from '#shared/editor/protocol'
import { isCanvasMessage } from '#shared/editor/protocol'
import { isContainerType } from '#shared/document/components'
import { findNode, findParent } from '#shared/document/tree'
import type { DropTarget } from '#shared/editor/dropTarget'
import type { StylePatch } from '#shared/editor/preview'
import { previewTree, settlePreviews } from '#shared/editor/preview'
import { breakpointAt, DRAG_MIME, draggedNodeId, dropPosition, laysOutInRow, resolveDrop } from '#shared/editor/dropTarget'
import { FRAME_MIN_HEIGHT, wheelPixels, zoomShortcut } from '#shared/editor/viewport'

/**
 * The editor canvas, loaded in an iframe. It renders whatever page the
 * editor sends with the same runtime as the published app, draws hover and
 * selection outlines, and turns pointer and key gestures into messages.
 * The `tokens` view shows the theme's token preview sheet instead.
 * Outlines use a fixed editor colour, not the project's `primary`.
 * List repetitions share their template's node ids: a click on any copy
 * selects the template, while outlines and drops stay on the first copy.
 * Style previews from the editor render over the page until it clears them
 * or a render shows their values (committed), so a commit never flickers.
 * The editor shows one canvas per device frame, as tall as its content
 * (reported on resize), and zooms and pans them itself: wheel, middle-drag
 * and space are forwarded. Only the active frame labels the selection.
 */
definePageMeta({ layout: false })

const page = shallowRef<Page | null>(null)
const base = ref('')
const lists = shallowRef<Record<string, DataRecord[]>>({})
const theme = shallowRef<Theme | null>(null)
useTheme(theme)
const view = ref<CanvasView>('page')
const selectedId = ref<string | null>(null)
const hoveredId = ref<string | null>(null)
const active = ref(true)
/** The editor's zoom; outlines and the selection label are scaled back to keep their screen size. */
const zoom = ref(1)
const root = useTemplateRef<HTMLDivElement>('root')
/** Uncommitted style patches by node id. */
const previews = shallowRef<Record<string, StylePatch>>({})
const shownPage = computed(() => {
  const current = page.value
  if (!current) return null
  const root = previewTree(current.root, previews.value)
  return root === current.root ? current : { ...current, root }
})

interface Box { top: number, left: number, width: number, height: number, label: string }
const boxes = reactive<{ hover: Box | null, selected: Box | null }>({ hover: null, selected: null })

interface Indicator { top: number, left: number, width: number, height: number, line: boolean }
const indicator = ref<Indicator | null>(null)

function post(message: CanvasToEditor) {
  window.parent.postMessage(message, window.location.origin)
}

function nodeIdAt(target: EventTarget | null): string | null {
  return (target as Element | null)?.closest?.('[data-bildr-id]')?.getAttribute('data-bildr-id') ?? null
}

function firstCopy(id: string): Element | null {
  return document.querySelector(`[data-bildr-id="${id}"]:not([data-bildr-copy])`)
}

function measure(id: string | null): Box | null {
  const el = id ? firstCopy(id) : null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height, label: el.getAttribute('data-bildr-type') ?? '' }
}

let frame = 0
function track() {
  boxes.hover = hoveredId.value !== selectedId.value ? measure(hoveredId.value) : null
  boxes.selected = measure(selectedId.value)
  frame = requestAnimationFrame(track)
}

function onMessage(event: MessageEvent) {
  if (event.source !== window.parent || !isCanvasMessage<EditorToCanvas>(event.data)) return
  const message = event.data
  if (message.type === 'bildr:render') {
    page.value = message.page
    if (Object.keys(previews.value).length) previews.value = settlePreviews(previews.value, message.page.root)
    base.value = message.base
    lists.value = message.lists
    theme.value = message.theme
    view.value = message.view
  } else if (message.type === 'bildr:select') {
    selectedId.value = message.nodeId
  } else if (message.type === 'bildr:active') {
    active.value = message.active
    zoom.value = message.zoom
  } else if (message.type === 'bildr:hover') {
    hoveredId.value = message.nodeId
  } else if (message.type === 'bildr:preview') {
    const { [message.nodeId]: _, ...others } = previews.value
    previews.value = message.style ? { ...others, [message.nodeId]: message.style } : others
  }
}

function onPointerMove(event: MouseEvent) {
  const id = nodeIdAt(event.target)
  if (id === hoveredId.value) return
  hoveredId.value = id
  post({ type: 'bildr:hover', nodeId: id })
}

function onPointerLeave() {
  hoveredId.value = null
  post({ type: 'bildr:hover', nodeId: null })
}

/** In the canvas, clicks select: links don't navigate and buttons don't act. */
function onClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const id = nodeIdAt(event.target)
  if (id) post({ type: 'bildr:click', nodeId: id })
}

/** The last pointer position of a middle-button pan, in screen pixels (zoom-independent). */
let pan: { x: number, y: number } | null = null

function onMouseDown(event: MouseEvent) {
  event.preventDefault()
  if (event.button === 1 && view.value === 'page') pan = { x: event.screenX, y: event.screenY }
}

function onPanMove(event: MouseEvent) {
  if (!pan) return
  post({ type: 'bildr:pan', dx: event.screenX - pan.x, dy: event.screenY - pan.y })
  pan = { x: event.screenX, y: event.screenY }
}

function onMouseUp() {
  pan = null
}

/** A middle click would open a link in a new tab. */
function onAuxClick(event: MouseEvent) {
  event.preventDefault()
}

// The token sheet scrolls itself; the page view is zoomed and panned by the editor.
function onWheel(event: WheelEvent) {
  if (view.value !== 'page') return
  event.preventDefault()
  post({
    type: 'bildr:wheel',
    dx: wheelPixels(event.deltaX, event.deltaMode),
    dy: wheelPixels(event.deltaY, event.deltaMode),
    zoom: event.ctrlKey || event.metaKey,
    x: event.clientX,
    y: event.clientY
  })
}

/** A right-click opens the editor's node menu; the editor places it over the iframe. */
function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  const id = nodeIdAt(event.target)
  if (id) post({ type: 'bildr:contextmenu', nodeId: id, x: event.clientX, y: event.clientY })
}

const SHORTCUT_KEYS = new Set(['Delete', 'Backspace', 'Escape'])
function onKeyDown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (event.code === 'Space' && view.value === 'page') {
    event.preventDefault()
    if (!event.repeat) post({ type: 'bildr:space', down: true })
    return
  }
  const zoom = zoomShortcut({ code: event.code, key: event.key, meta, shift: event.shiftKey })
  if (!zoom && !SHORTCUT_KEYS.has(event.key) && !(meta && ['z', 'y', 'd'].includes(event.key.toLowerCase()))) return
  event.preventDefault()
  post({ type: 'bildr:key', key: event.key, code: event.code, meta, shift: event.shiftKey })
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code !== 'Space' || view.value !== 'page') return
  event.preventDefault()
  post({ type: 'bildr:space', down: false })
}

// The editor sizes the frame to the content, so the page never scrolls inside it.
const sizeObserver = import.meta.client
  ? new ResizeObserver(() => view.value === 'page' && post({ type: 'bildr:size', height: Math.ceil(root.value?.offsetHeight ?? 0) }))
  : null

/** The drop slot under the pointer, plus where to draw it. */
function dropAt(event: DragEvent): { target: DropTarget, indicator: Indicator } | null {
  const types = event.dataTransfer?.types ?? []
  const root = page.value?.root
  if (!root || !types.includes(DRAG_MIME)) return null
  const el = event.target as Element | null
  if (el?.closest?.('[data-bildr-copy]')) return null
  const placeholder = el?.closest?.('[data-bildr-placeholder]')
  const nodeEl = placeholder ?? el?.closest?.('[data-bildr-id]')
  const id = placeholder?.getAttribute('data-bildr-placeholder') ?? nodeEl?.getAttribute('data-bildr-id')
  const node = id ? findNode(root, id) : undefined
  if (!nodeEl || !node) return null
  const rect = nodeEl.getBoundingClientRect()
  // The canvas is as wide as the editor's device, so its width gives the breakpoint that applies.
  const parent = findParent(root, node.id)?.parent
  const horizontal = !!parent && laysOutInRow(parent, breakpointAt(window.innerWidth))
  const position = placeholder || node === root
    ? 'inside'
    : dropPosition(rect, { x: event.clientX, y: event.clientY }, { container: isContainerType(node.type), horizontal })
  const target = resolveDrop(root, node.id, position, draggedNodeId(types))
  if (!target) return null
  const box = { top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height }
  if (position === 'inside') return { target, indicator: { ...box, line: false } }
  const end = position === 'after'
  return {
    target,
    indicator: horizontal
      ? { top: box.top, left: box.left + (end ? box.width : 0) - 1, width: 2, height: box.height, line: true }
      : { top: box.top + (end ? box.height : 0) - 1, left: box.left, width: box.width, height: 2, line: true }
  }
}

function onDragOver(event: DragEvent) {
  const drop = dropAt(event)
  indicator.value = drop?.indicator ?? null
  if (!drop) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = draggedNodeId(event.dataTransfer!.types) ? 'move' : 'copy'
}

function onDragLeave(event: DragEvent) {
  if (!event.relatedTarget) indicator.value = null
}

function onDrop(event: DragEvent) {
  const drop = dropAt(event)
  indicator.value = null
  if (!drop) return
  event.preventDefault()
  post({ type: 'bildr:drop', ...drop.target, payload: event.dataTransfer!.getData(DRAG_MIME) })
}

function clearIndicator() {
  indicator.value = null
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('dragleave', onDragLeave)
  document.addEventListener('drop', onDrop)
  document.addEventListener('dragend', clearIndicator)
  document.addEventListener('mousemove', onPointerMove, true)
  document.documentElement.addEventListener('mouseleave', onPointerLeave)
  document.addEventListener('click', onClick, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('contextmenu', onContextMenu, true)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('mousemove', onPanMove)
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('auxclick', onAuxClick, true)
  document.addEventListener('wheel', onWheel, { passive: false })
  frame = requestAnimationFrame(track)
  post({ type: 'bildr:ready' })
  if (root.value) sizeObserver?.observe(root.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  document.removeEventListener('dragover', onDragOver)
  document.removeEventListener('dragleave', onDragLeave)
  document.removeEventListener('drop', onDrop)
  document.removeEventListener('dragend', clearIndicator)
  document.removeEventListener('mousemove', onPointerMove, true)
  document.documentElement.removeEventListener('mouseleave', onPointerLeave)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('mousedown', onMouseDown, true)
  document.removeEventListener('contextmenu', onContextMenu, true)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('keyup', onKeyUp)
  document.removeEventListener('mousemove', onPanMove)
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('auxclick', onAuxClick, true)
  document.removeEventListener('wheel', onWheel)
  sizeObserver?.disconnect()
  cancelAnimationFrame(frame)
})
</script>

<template>
  <div
    ref="root"
    class="relative"
    :class="{ 'min-h-screen': view === 'tokens' }"
    :style="view === 'page' ? { minHeight: `${FRAME_MIN_HEIGHT}px` } : undefined"
  >
    <EditorTokenSheet v-if="view === 'tokens'" />
    <BildrPage
      v-else-if="shownPage"
      :page="shownPage"
      :base="base"
      :lists="lists"
      editable
      :style="{ minHeight: `${FRAME_MIN_HEIGHT}px` }"
    />
    <div
      v-for="(box, kind) in boxes"
      v-show="box"
      :key="kind"
      class="pointer-events-none absolute z-50 rounded-sm"
      :class="kind === 'selected' ? 'outline-solid outline-blue-500' : 'outline-dashed outline-blue-500/60'"
      :style="box ? { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, outlineWidth: `${2 / zoom}px`, outlineOffset: `${-1 / zoom}px` } : undefined"
    >
      <span
        v-if="kind === 'selected' && box && active"
        class="absolute bottom-full left-0 origin-bottom-left rounded-t-sm bg-blue-500 px-1.5 text-[10px] leading-5 whitespace-nowrap text-white"
        :style="{ transform: `scale(${1 / zoom})` }"
      >{{ box.label }}</span>
    </div>
    <div
      v-if="indicator"
      class="pointer-events-none absolute z-50"
      :class="indicator.line ? 'rounded-full bg-blue-500' : 'rounded-sm bg-blue-500/5 outline-2 -outline-offset-2 outline-blue-500'"
      :style="{ top: `${indicator.top}px`, left: `${indicator.left}px`, width: `${indicator.width}px`, height: `${indicator.height}px` }"
    />
  </div>
</template>
