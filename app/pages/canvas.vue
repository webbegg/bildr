<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { Theme } from '#shared/design/theme'
import type { ComponentDefinition, Layout, Page } from '#shared/document/schema'
import type { EnvValues } from '#shared/env/variables'
import type { CanvasToEditor, CanvasView, EditorToCanvas } from '#shared/editor/protocol'
import { isCanvasMessage } from '#shared/editor/protocol'
import { isContainerType } from '#shared/document/components'
import { findNode, findParent } from '#shared/document/tree'
import type { DropPosition, DropTarget } from '#shared/editor/dropTarget'
import type { InsertHit } from '#shared/editor/insertTools'
import { insertTargetAt, toolForKey } from '#shared/editor/insertTools'
import type { StylePatch } from '#shared/editor/preview'
import { previewTree, settlePreviews } from '#shared/editor/preview'
import { breakpointAt, DRAG_MIME, draggedNodeId, dropPosition, laysOutInRow, resolveDrop } from '#shared/editor/dropTarget'
import { FRAME_MIN_HEIGHT, viewportUnitRules, wheelPixels, zoomShortcut } from '#shared/editor/viewport'
import type { NodeBox } from '#shared/editor/autoLayout'
import type { MeasureLine } from '#shared/editor/measure'
import { layerName } from '#shared/editor/layers'
import { measure as measureLines } from '#shared/editor/measure'
import { labelPlacement } from '#shared/editor/labelPlacement'

/**
 * The editor canvas, loaded in an iframe. It renders whatever page the
 * editor sends with the same runtime as the published app, draws hover and
 * selection outlines, and turns pointer and key gestures into messages.
 * The `tokens` view shows the theme's style guide instead (the Design view).
 * Outlines use a fixed editor colour, not the project's `primary`: the
 * editor's accent (`--editor-selection` in main.css), defined again on this
 * document's root as `--canvas-accent` since the iframe has no editor chrome.
 * Selection and hover are 1 px (Framer's), and a single selection's parent
 * gets a dashed outline for context.
 * List repetitions share their template's node ids: a click on any copy
 * selects the template, while outlines and drops stay on the first copy.
 * Style previews from the editor render over the page until it clears them
 * or a render shows their values (committed), so a commit never flickers.
 * The editor shows one canvas per device frame, as tall as its content
 * (reported on resize), and zooms and pans them itself: wheel, middle-drag
 * and space are forwarded. Only the active frame labels the selection.
 * Every selected node is outlined; holding Alt (Option) over another element
 * draws Figma's red distance lines from the selection box in the active frame.
 * With an insert tool armed the cursor is a crosshair, the pointer shows the
 * insert slot with the drop indicator, and a click reports that slot.
 * The editor's light/dark preview sets this document's colour mode class.
 * Component instances render from the `components` the editor sends; their
 * parts report the instance's id, so a click anywhere in one selects it.
 * Labels name nodes as the layers do (`layerName`); layout parts read Layout.
 * `{{ env.NAME }}` resolves from the public variables the editor sends; a
 * missing one shows as written.
 * The frame grows with its content, so `screen` heights (100vh) would grow
 * with it: in the page view they resolve to the device's nominal viewport
 * height from `bildr:active` instead.
 */
definePageMeta({ layout: false })

const page = shallowRef<Page | null>(null)
const base = ref('')
const components = shallowRef<ComponentDefinition[]>([])
const layouts = shallowRef<Layout[]>([])
const lists = shallowRef<Record<string, DataRecord[]>>({})
const theme = shallowRef<Theme | null>(null)
const env = shallowRef<EnvValues>({})
useTheme(theme, env)
const view = ref<CanvasView>('page')
const selectedId = ref<string | null>(null)
const selectedIds = ref<string[]>([])
const hoveredId = ref<string | null>(null)
/** The armed insert tool's component type; null is Move. */
const tool = ref<string | null>(null)
/** Alt (Option) held, here or in the editor: measurements to the hovered element. */
const alt = ref(false)
const active = ref(true)
/** The editor's zoom; outlines and the selection label are scaled back to keep their screen size. */
const zoom = ref(1)
/** The device's nominal viewport height, which `screen` heights resolve to in the page view. */
const viewportHeight = ref(FRAME_MIN_HEIGHT)
const VIEWPORT_VAR = '--canvas-vh'

/** Writes the `screen` overrides for this frame's breakpoint (its width is the device's, fixed). */
function applyViewportRules() {
  let style = document.getElementById('bildr-canvas-viewport')
  if (!style) {
    style = document.createElement('style')
    style.id = 'bildr-canvas-viewport'
    document.head.appendChild(style)
  }
  const css = viewportUnitRules(breakpointAt(window.innerWidth), '[data-canvas-viewport]', VIEWPORT_VAR).join('\n')
  if (style.textContent !== css) style.textContent = css
}
const root = useTemplateRef<HTMLDivElement>('root')
/** Uncommitted style patches by node id. */
const previews = shallowRef<Record<string, StylePatch>>({})
const shownPage = computed(() => {
  const current = page.value
  if (!current) return null
  const root = previewTree(current.root, previews.value)
  return root === current.root ? current : { ...current, root }
})

interface Box { id: string, top: number, left: number, width: number, height: number, label: string }
const boxes = reactive<{ hover: Box | null, selected: Box[], parent: Box | null }>({ hover: null, selected: [], parent: null })
/** The editor accent (`--editor-selection`), which this document can't inherit. */
const ACCENT_VAR = '--canvas-accent'
const ACCENT = '#09f'
/** A single selection's parent, outlined dashed for context. */
const parentId = computed(() => {
  const root = page.value?.root
  const id = selectedIds.value.length === 1 ? selectedIds.value[0] : undefined
  return root && id ? findParent(root, id)?.parent.id ?? null : null
})

const toRect = (box: Box) => ({ x: box.left, y: box.top, width: box.width, height: box.height })

/** The selection label (16 px on screen, `leading-4`): above the box, or inset inside it at the frame top. */
const LABEL_PX = 16
const labelInside = (box: Box) => labelPlacement(box.top, LABEL_PX / zoom.value) === 'inside'
/** The selection's bounds, measured from, and the hovered element's box, measured to. */
const measurement = computed(() => {
  const target = boxes.hover
  if (!alt.value || !active.value || !target || !boxes.selected.length) return null
  const rects = boxes.selected.map(toRect)
  const x = Math.min(...rects.map(r => r.x))
  const y = Math.min(...rects.map(r => r.y))
  const from = { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y }
  return { target, lines: measureLines(from, toRect(target)) }
})
const lineStyle = (line: MeasureLine) => line.y1 === line.y2
  ? { left: `${line.x1}px`, top: `${line.y1 - 0.5 / zoom.value}px`, width: `${line.length}px`, height: `${1 / zoom.value}px` }
  : { left: `${line.x1 - 0.5 / zoom.value}px`, top: `${line.y1}px`, width: `${1 / zoom.value}px`, height: `${line.length}px` }

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
  return { id: id!, top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height, label: boxLabel(id!, el.getAttribute('data-bildr-type') ?? '') }
}

function boxLabel(id: string, type: string): string {
  const node = type === 'Layout' || !page.value ? undefined : findNode(page.value.root, id)
  return node ? layerName(page.value!, node, { components: components.value, layouts: layouts.value }) : type
}

/** The boxes of `ids` in canvas pixels, for the editor's auto layout; hidden or missing nodes have none. */
function nodeBoxes(ids: string[]): NodeBox[] {
  return ids.map(measure).filter((box): box is Box => !!box && (box.width > 0 || box.height > 0)).map(box => ({ id: box.id, ...toRect(box) }))
}

let frame = 0
function track() {
  boxes.hover = hoveredId.value && !selectedIds.value.includes(hoveredId.value) ? measure(hoveredId.value) : null
  boxes.selected = selectedIds.value.map(measure).filter((box): box is Box => !!box)
  boxes.parent = active.value && parentId.value ? measure(parentId.value) : null
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
    components.value = message.components ?? []
    layouts.value = message.layouts ?? []
    env.value = message.env ?? {}
    theme.value = message.theme
    view.value = message.view
  } else if (message.type === 'bildr:select') {
    selectedId.value = message.nodeId
    selectedIds.value = message.nodeIds
  } else if (message.type === 'bildr:measure') {
    post({ type: 'bildr:rects', requestId: message.requestId, rects: nodeBoxes(message.nodeIds) })
  } else if (message.type === 'bildr:alt') {
    alt.value = message.down
  } else if (message.type === 'bildr:tool') {
    tool.value = message.tool
    indicator.value = null
  } else if (message.type === 'bildr:dark') {
    // Also drops the system preference's class (Nuxt UI colour mode), so off always previews light.
    document.documentElement.classList.toggle('dark', message.dark)
    document.documentElement.classList.toggle('light', !message.dark)
  } else if (message.type === 'bildr:active') {
    active.value = message.active
    zoom.value = message.zoom
    viewportHeight.value = message.viewportHeight
    applyViewportRules()
  } else if (message.type === 'bildr:hover') {
    hoveredId.value = message.nodeId
  } else if (message.type === 'bildr:preview') {
    const { [message.nodeId]: _, ...others } = previews.value
    previews.value = message.style ? { ...others, [message.nodeId]: message.style } : others
  }
}

function onPointerMove(event: MouseEvent) {
  alt.value = event.altKey
  if (tool.value) indicator.value = insertAt(event)?.indicator ?? null
  const id = nodeIdAt(event.target)
  if (id === hoveredId.value) return
  hoveredId.value = id
  post({ type: 'bildr:hover', nodeId: id })
}

function onPointerLeave() {
  if (tool.value) indicator.value = null
  hoveredId.value = null
  post({ type: 'bildr:hover', nodeId: null })
}

/** In the canvas, clicks select (or insert, with a tool armed): links don't navigate and buttons don't act. */
function onClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (tool.value) {
    const insert = insertAt(event)
    indicator.value = null
    if (insert) post({ type: 'bildr:insert', ...insert.hit.target })
    return
  }
  const id = nodeIdAt(event.target)
  if (id) post({ type: 'bildr:click', nodeId: id, shift: event.shiftKey, meta: event.metaKey || event.ctrlKey })
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

const SHORTCUT_KEYS = new Set(['Delete', 'Backspace', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
function onKeyDown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (event.key === 'Alt') alt.value = true
  if (event.code === 'Space' && view.value === 'page') {
    event.preventDefault()
    if (!event.repeat) post({ type: 'bildr:space', down: true })
    return
  }
  const zoom = zoomShortcut({ code: event.code, key: event.key, meta, shift: event.shiftKey })
  const lower = event.key.toLowerCase()
  const armsTool = !!toolForKey({ key: event.key, meta, shift: event.shiftKey, alt: event.altKey })
  if (!zoom && !armsTool && !SHORTCUT_KEYS.has(event.key) && !(meta && ['z', 'y', 'd', 'a', 'g', 'p', 'f', 'k'].includes(lower)) && !(event.shiftKey && !meta && lower === 'a')) return
  event.preventDefault()
  post({ type: 'bildr:key', key: event.key, code: event.code, meta, shift: event.shiftKey })
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === 'Alt') alt.value = false
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
  return { target, indicator: indicatorAt(rect, position, horizontal) }
}

/** The drop indicator for `position` relative to an element's viewport `rect`: its outline inside, else a line on that side. */
function indicatorAt(rect: DOMRect, position: DropPosition, horizontal: boolean): Indicator {
  const box = { top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height }
  if (position === 'inside') return { ...box, line: false }
  const end = position === 'after'
  return horizontal
    ? { top: box.top, left: box.left + (end ? box.width : 0) - 1, width: 2, height: box.height, line: true }
    : { top: box.top + (end ? box.height : 0) - 1, left: box.left, width: box.width, height: 2, line: true }
}

/** The insert slot for an armed tool under the pointer, plus where to draw it. */
function insertAt(event: MouseEvent): { hit: InsertHit, indicator: Indicator } | null {
  const root = page.value?.root
  const id = nodeIdAt(event.target)
  const node = root && id && view.value === 'page' ? findNode(root, id) : undefined
  if (!root || !node) return null
  const breakpoint = breakpointAt(window.innerWidth)
  const childRects = node.children.map(child => firstCopy(child.id)?.getBoundingClientRect() ?? new DOMRect())
  const hit = insertTargetAt(root, node.id, { x: event.clientX, y: event.clientY }, childRects, breakpoint)
  const markEl = hit && firstCopy(hit.mark.nodeId)
  if (!hit || !markEl) return null
  const parent = findParent(root, hit.mark.nodeId)?.parent
  const horizontal = !!parent && laysOutInRow(parent, breakpoint)
  return { hit, indicator: indicatorAt(markEl.getBoundingClientRect(), hit.mark.position, horizontal) }
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
    :class="{ 'min-h-screen': view === 'tokens', 'cursor-crosshair! **:cursor-crosshair!': tool && view === 'page' }"
    :data-armed-tool="tool ?? undefined"
    :data-canvas-viewport="view === 'page' || undefined"
    :style="view === 'page' ? { minHeight: `${FRAME_MIN_HEIGHT}px`, [VIEWPORT_VAR]: `${viewportHeight}px`, [ACCENT_VAR]: ACCENT } : { [ACCENT_VAR]: ACCENT }"
  >
    <EditorTokenSheet
      v-if="view === 'tokens'"
      :theme="theme"
    />
    <BildrPage
      v-else-if="shownPage"
      :page="shownPage"
      :base="base"
      :lists="lists"
      :components="components"
      :layouts="layouts"
      :env="env"
      missing-env="keep"
      editable
      :style="{ minHeight: `${FRAME_MIN_HEIGHT}px` }"
    />
    <div
      v-if="boxes.parent"
      class="pointer-events-none absolute z-50 outline-dashed outline-(--canvas-accent)/60"
      :style="{ top: `${boxes.parent.top}px`, left: `${boxes.parent.left}px`, width: `${boxes.parent.width}px`, height: `${boxes.parent.height}px`, outlineWidth: `${1 / zoom}px`, outlineOffset: `${-1 / zoom}px` }"
      :data-selection-parent="boxes.parent.id"
    />
    <div
      v-for="box in [...boxes.selected, ...(boxes.hover ? [boxes.hover] : [])]"
      :key="box === boxes.hover ? 'hover' : box.id"
      class="pointer-events-none absolute z-50 outline-solid"
      :class="box === boxes.hover && measurement ? 'outline-[#f24822]' : 'outline-(--canvas-accent)'"
      :style="{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, outlineWidth: `${1 / zoom}px`, outlineOffset: `${-1 / zoom}px` }"
      :data-selection-box="box === boxes.hover ? undefined : box.id"
    >
      <span
        v-if="box.id === selectedId && box !== boxes.hover && active"
        class="absolute left-0 bg-(--canvas-accent) px-1 text-[10px] leading-4 font-medium whitespace-nowrap text-white"
        :class="labelInside(box) ? 'top-0 origin-top-left rounded-sm' : 'bottom-full origin-bottom-left rounded-t-sm'"
        :style="{ transform: labelInside(box) ? `translate(${2 / zoom}px, ${2 / zoom}px) scale(${1 / zoom})` : `scale(${1 / zoom})` }"
        :data-selection-label="labelInside(box) ? 'inside' : 'above'"
      >{{ box.label }}</span>
    </div>
    <template v-if="measurement">
      <div
        v-for="(line, i) in measurement.lines"
        :key="i"
        class="pointer-events-none absolute z-50 bg-[#f24822]"
        :style="lineStyle(line)"
        data-measure-line
        :data-measure-px="Math.round(line.length)"
      >
        <!-- Beside the line, as in Figma: below a horizontal one, right of a vertical one. -->
        <span
          class="absolute rounded-[3px] bg-[#f24822] px-1 text-[10px] leading-4 font-medium whitespace-nowrap text-white tabular-nums"
          :class="line.y1 === line.y2 ? 'top-full left-1/2 origin-top' : 'top-1/2 left-full origin-left'"
          :style="{ transform: line.y1 === line.y2 ? `translate(-50%, ${4 / zoom}px) scale(${1 / zoom})` : `translate(${4 / zoom}px, -50%) scale(${1 / zoom})` }"
        >{{ Math.round(line.length) }}</span>
      </div>
    </template>
    <div
      v-if="indicator"
      class="pointer-events-none absolute z-50"
      :class="indicator.line ? 'rounded-full bg-(--canvas-accent)' : 'rounded-sm bg-(--canvas-accent)/5 outline-2 -outline-offset-2 outline-(--canvas-accent)'"
      :style="{ top: `${indicator.top}px`, left: `${indicator.left}px`, width: `${indicator.width}px`, height: `${indicator.height}px` }"
      data-drop-indicator
    />
  </div>
</template>
