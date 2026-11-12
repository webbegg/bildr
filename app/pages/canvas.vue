<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import { bindingItem } from '#shared/runtime/bindings'
import type { BindingItem } from '#shared/runtime/bindings'
import type { Theme } from '#shared/design/theme'
import type { ComponentDefinition, Layout, Page } from '#shared/document/schema'
import type { EnvValues } from '#shared/env/variables'
import type { BoardVariant, CanvasToEditor, CanvasView, EditorToCanvas, SpacingOverlay } from '#shared/editor/protocol'
import { canvasKeyMessage, isCanvasMessage } from '#shared/editor/protocol'
import { spacingBasePx } from '#shared/design/theme'
import { containsNode, findNode, findParent } from '#shared/document/tree'
import type { DropPosition, DropTarget, Rect } from '#shared/editor/dropTarget'
import type { InsertHit } from '#shared/editor/insertTools'
import { insertTargetAt, toolForKey } from '#shared/editor/insertTools'
import type { StylePatch } from '#shared/editor/preview'
import { previewTree, settlePreviews } from '#shared/editor/preview'
import { breakpointAt, DRAG_MIME, draggedNodeId, laysOutInRow } from '#shared/editor/dropTarget'
import type { GestureEffect, GestureEndReason, GestureState } from '#shared/editor/gesture'
import { gestureTargetGone, startGesture, stepGesture } from '#shared/editor/gesture'
import type { ReorderHit } from '#shared/editor/reorder'
import { canDragNode, isNoopMove, REORDER_THRESHOLD, reorderTarget } from '#shared/editor/reorder'
import type { Axis, HandleId, Insets, Point, ResizeDrag, SpacingHandle, SpacingTarget } from '#shared/editor/handles'
import { changedPatch, gapRects, handleCursor, handlePoint, HANDLES, hitPoint, hitRadius, paddingRects, resizePatch, scaleLabel, spacingDragPatch, spacingHandles } from '#shared/editor/handles'
import { editorTakesKey, hasTextSelection } from '#shared/editor/clipboardKeys'
import { FRAME_MIN_HEIGHT, viewportUnitRules, wheelPixels, zoomShortcut } from '#shared/editor/viewport'
import type { NodeBox } from '#shared/editor/autoLayout'
import type { MeasureLine } from '#shared/editor/measure'
import { layerName } from '#shared/editor/layers'
import { measure as measureLines } from '#shared/editor/measure'
import { nearestUnlocked } from '#shared/editor/selection'
import { labelPlacement } from '#shared/editor/labelPlacement'
import { SELECTION_ACCENT } from '#shared/editor/accent'

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
 * A locked node (`locked`, or inside one) can't be hovered, clicked or
 * right-clicked here: the pointer reaches its nearest unlocked ancestor, and
 * under a locked root nothing (the layers still select it).
 * `{{ env.NAME }}` resolves from the public variables the editor sends; a
 * missing one shows as written.
 * The frame grows with its content, so `screen` heights (100vh) would grow
 * with it: in the page view they resolve to the device's nominal viewport
 * height from `bildr:active` instead.
 * A variant board frame shows one variant (`bildr:render.variant`) and
 * reports it with its clicks and right-clicks (`variantId`).
 *
 * Direct manipulation (#23), in the active frame on a single unlocked
 * selection (not the root), with no insert tool armed:
 * - 8 resize handles (corners and edge midpoints): a drag previews the W/H
 *   scale step nearest the pointer (`resizePatch`), labelled e.g.
 *   `w-64 · 256px`, Shift by 4 stops; a Fit or Fill size becomes fixed.
 * - Padding and gap overlays (hatched, accent) while the panel's Padding or
 *   Gap field is hovered (`bildr:overlay`), or both while the pointer is over
 *   a selected auto layout; their handles drag the padding key the side uses
 *   (`paddingDragKey`) or `gap`, snapped the same way.
 * - A press on the selection that moves past 4 px drags it: the drop
 *   indicator shows the sibling slot or container under the pointer (locks
 *   respected), and the release moves it there (`bildr:drop`, one node_move).
 * Handle drags preview through the editor (`bildr:style-preview`) and commit
 * once on release (`bildr:style-commit`), at this frame's breakpoint (the
 * edited one: only the active frame has handles). Esc cancels any drag and
 * drops its preview; the click that ends a drag selects nothing.
 */
definePageMeta({ layout: false })

const page = shallowRef<Page | null>(null)
const base = ref('')
const components = shallowRef<ComponentDefinition[]>([])
const layouts = shallowRef<Layout[]>([])
const lists = shallowRef<Record<string, DataRecord[]>>({})
/** A detail page's preview record, the page item its bindings read; null shows them as written. */
const item = shallowRef<BindingItem | null>(null)
const theme = shallowRef<Theme | null>(null)
const env = shallowRef<EnvValues>({})
useTheme(theme, env)
const view = ref<CanvasView>('page')
/** The variant this frame shows on the variant board; null elsewhere. */
const boardVariant = shallowRef<BoardVariant | null>(null)
/** Hit-testing reports the board variant with the node. */
const variantField = () => (boardVariant.value ? { variantId: boardVariant.value.id } : {})
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
/** The editor accent (`--editor-selection`, purple `--editor-context` in a component, a layout or on instances), which this document can't inherit. */
const ACCENT_VAR = '--canvas-accent'
const accent = ref(SELECTION_ACCENT)
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
const rectStyle = (rect: { x: number, y: number, width: number, height: number }) => ({ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` })
/** The spacing overlays' fill: an accent tint with diagonal hatching, at screen size. */
const hatch = () => ({
  backgroundColor: `color-mix(in srgb, var(${ACCENT_VAR}) 10%, transparent)`,
  backgroundImage: `repeating-linear-gradient(-45deg, color-mix(in srgb, var(${ACCENT_VAR}) 45%, transparent) 0 ${1 / zoom.value}px, transparent ${1 / zoom.value}px ${5 / zoom.value}px)`
})
/** The white ring around a handle, `px` wide on screen. */
const ringShadow = (px: number) => `0 0 0 ${px / zoom.value}px #fff`
/** A spacing handle: a pill across the side or gap it drags (12 × 4 on screen). */
function spacingHandleStyle(handle: SpacingHandle) {
  const across = handle.kind === 'padding' ? handle.side === 'left' || handle.side === 'right' : spacing.value?.axis === 'row'
  const [w, h] = (across ? [4, 12] : [12, 4]).map(n => n / zoom.value) as [number, number]
  return { left: `${handle.x - w / 2}px`, top: `${handle.y - h / 2}px`, width: `${w}px`, height: `${h}px`, boxShadow: ringShadow(1) }
}
const lineStyle = (line: MeasureLine) => line.y1 === line.y2
  ? { left: `${line.x1}px`, top: `${line.y1 - 0.5 / zoom.value}px`, width: `${line.length}px`, height: `${1 / zoom.value}px` }
  : { left: `${line.x1 - 0.5 / zoom.value}px`, top: `${line.y1}px`, width: `${1 / zoom.value}px`, height: `${line.length}px` }

interface Indicator { top: number, left: number, width: number, height: number, line: boolean }
const indicator = ref<Indicator | null>(null)

/** The panel field hovered in the editor (Padding or Gap), whose overlay to paint. */
const panelOverlay = ref<SpacingOverlay | null>(null)
/** Handle sizes in screen px (scaled back by the zoom): the drawn dot, the hit radius, and a spacing handle's least inset. */
const HANDLE_PX = 7
const HANDLE_HIT_PX = 6
const HANDLE_INSET_PX = 8

/** The node direct manipulation applies to: a single unlocked selection, not the root, in the active page-view frame with Move. */
const editable = computed(() => {
  const root = page.value?.root
  const id = selectedIds.value.length === 1 ? selectedIds.value[0] : undefined
  return root && id && view.value === 'page' && active.value && !tool.value && canDragNode(root, id) ? id : null
})
const editableBox = computed(() => (editable.value ? boxes.selected.find(box => box.id === editable.value) ?? null : null))

interface SpacingBox {
  /** The padding box (inside the border), its padding, and the gaps of its flex layout. */
  rect: { x: number, y: number, width: number, height: number }
  insets: Insets
  gaps: { x: number, y: number, width: number, height: number }[]
  axis: Axis
  gapPx: number
  showPadding: boolean
  showGap: boolean
}
/** The spacing overlays shown on the editable node, measured each frame; null when none shows. */
const spacing = shallowRef<SpacingBox | null>(null)
const spacingHandleList = computed<SpacingHandle[]>(() => {
  const s = spacing.value
  if (!s) return []
  return spacingHandles(s.rect, s.insets, s.gaps, HANDLE_INSET_PX / zoom.value).filter(h => (h.kind === 'padding' ? s.showPadding : s.showGap))
})
const resizeHandles = computed(() => (editableBox.value ? HANDLES.map(handle => ({ handle, ...handlePoint(toRect(editableBox.value!), handle) })) : []))

/** A drag's node, the page it started on, and its lifecycle (`stepGesture`: pending → active → done or cancelled). */
interface GestureBase { nodeId: string, pageId: string | undefined, state: GestureState }
type Gesture
  = | GestureBase & { kind: 'resize', drag: ResizeDrag, patch: Record<string, string>, cursor: string }
    | GestureBase & { kind: 'spacing', target: SpacingTarget, startPx: number, patch: Record<string, string>, cursor: string, shown: { padding: boolean, gap: boolean } }
    | GestureBase & { kind: 'reorder', target: DropTarget | null }
/** The drag in progress, from the press until it ends (`stepGesture`). */
let gesture: Gesture | null = null
/** The live token label of a handle drag, at the pointer (canvas px). */
const dragLabel = ref<{ text: string, x: number, y: number } | null>(null)
/** The pointer in canvas px; null outside the frame. */
let pointer: Point | null = null
/** Set when a press ended a drag (or Esc cancelled one): the click that follows selects nothing. */
let swallowClick = false

const canvasPoint = (event: MouseEvent): Point => ({ x: event.clientX + window.scrollX, y: event.clientY + window.scrollY })
const inside = (point: Point, rect: { x: number, y: number, width: number, height: number }) =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height

const SPACING_CURSORS: Record<string, string> = { top: 'ns-resize', bottom: 'ns-resize', left: 'ew-resize', right: 'ew-resize', row: 'ew-resize', col: 'ns-resize' }
const spacingCursor = (handle: SpacingHandle) => SPACING_CURSORS[handle.kind === 'padding' ? handle.side : spacing.value?.axis ?? 'row']!

/** The resize or spacing handle under a canvas point (the nearest within the hit radius), or null. */
function handleAt(point: Point): { handle: HandleId } | { spacing: SpacingHandle } | null {
  const box = editableBox.value
  if (!box) return null
  const candidates = [
    ...resizeHandles.value.map(h => ({ x: h.x, y: h.y, hit: { handle: h.handle } as const })),
    ...spacingHandleList.value.map(h => ({ x: h.x, y: h.y, hit: { spacing: h } }))
  ]
  return hitPoint(candidates, point, hitRadius(toRect(box), point, HANDLE_HIT_PX / zoom.value))?.hit ?? null
}

/** Every pointer cursor in the frame, while a handle is hovered or a drag runs; null restores them. */
function setCursor(cursor: string | null) {
  let style = document.getElementById('bildr-canvas-cursor')
  if (!style) {
    style = document.createElement('style')
    style.id = 'bildr-canvas-cursor'
    document.head.appendChild(style)
  }
  const css = cursor ? `*, *::before, *::after { cursor: ${cursor} !important; }` : ''
  if (style.textContent !== css) style.textContent = css
}

/** The layout element of a node's element: itself, or for wrappers (a Card) its only child, down to the flex box. */
function layoutElement(el: Element): Element {
  let at = el
  for (let depth = 0; depth < 3 && !getComputedStyle(at).display.includes('flex') && at.children.length === 1; depth++) at = at.children[0]!
  return at
}

/** An element's content box (inside its border and padding), in canvas px. */
function contentOf(target: Element): { x: number, y: number, width: number, height: number } {
  const px = (value: string) => Number.parseFloat(value) || 0
  const r = target.getBoundingClientRect()
  const c = getComputedStyle(target)
  return {
    x: r.left + window.scrollX + px(c.borderLeftWidth) + px(c.paddingLeft),
    y: r.top + window.scrollY + px(c.borderTopWidth) + px(c.paddingTop),
    width: r.width - px(c.borderLeftWidth) - px(c.borderRightWidth) - px(c.paddingLeft) - px(c.paddingRight),
    height: r.height - px(c.borderTopWidth) - px(c.borderBottomWidth) - px(c.paddingTop) - px(c.paddingBottom)
  }
}

/** The padding and flex gaps of node `id`'s element, in canvas px. */
function measureSpacing(id: string, box: Box): Omit<SpacingBox, 'showPadding' | 'showGap'> & { flex: boolean } | null {
  const el = firstCopy(id)
  if (!el) return null
  const px = (value: string) => Number.parseFloat(value) || 0
  const css = getComputedStyle(el)
  const insets = { top: px(css.paddingTop), right: px(css.paddingRight), bottom: px(css.paddingBottom), left: px(css.paddingLeft) }
  const border = { top: px(css.borderTopWidth), right: px(css.borderRightWidth), bottom: px(css.borderBottomWidth), left: px(css.borderLeftWidth) }
  const rect = { x: box.left + border.left, y: box.top + border.top, width: box.width - border.left - border.right, height: box.height - border.top - border.bottom }
  const layout = layoutElement(el)
  const lcss = getComputedStyle(layout)
  const flex = lcss.display.includes('flex')
  const axis: Axis = lcss.flexDirection.startsWith('column') ? 'col' : 'row'
  const children = flex
    ? [...layout.children].filter((child) => {
        const c = getComputedStyle(child)
        return c.display !== 'none' && c.position !== 'absolute' && c.position !== 'fixed'
      }).map((child) => {
        const r = child.getBoundingClientRect()
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
      })
    : []
  if (lcss.flexDirection.endsWith('reverse')) children.reverse()
  const gaps = flex ? gapRects(contentOf(layout), children, axis) : []
  return { rect, insets, gaps, axis, gapPx: px(axis === 'row' ? lcss.columnGap : lcss.rowGap), flex }
}

/** Which spacing overlays show: a spacing drag's, the hovered panel field's, or both over a selected auto layout. */
function trackSpacing() {
  const id = editable.value
  const box = editableBox.value
  const g = gesture
  const want = !id || !box || (g && g.kind !== 'spacing')
    ? null
    : g?.kind === 'spacing'
      ? g.shown
      : panelOverlay.value
        ? { padding: panelOverlay.value === 'padding', gap: panelOverlay.value === 'gap' }
        : pointer && inside(pointer, toRect(box)) ? 'hover' : null
  const measured = want ? measureSpacing(id!, box!) : null
  if (!want || !measured || (want === 'hover' && !measured.flex)) {
    spacing.value = null
    return
  }
  const { flex, ...rest } = measured
  spacing.value = { ...rest, showPadding: want === 'hover' || want.padding, showGap: flex && (want === 'hover' || want.gap) }
}

function post(message: CanvasToEditor) {
  window.parent.postMessage(message, window.location.origin)
}

function nodeIdAt(target: EventTarget | null): string | null {
  return (target as Element | null)?.closest?.('[data-bildr-id]')?.getAttribute('data-bildr-id') ?? null
}

/** The node a pointer gesture on `target` reaches: the element's node, or its nearest unlocked ancestor. */
function reachableAt(target: EventTarget | null): string | null {
  const id = nodeIdAt(target)
  const root = page.value?.root
  return id && root && findNode(root, id) ? nearestUnlocked(root, id) : id
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
  trackSpacing()
  frame = requestAnimationFrame(track)
}

/**
 * The record a detail page previews: `bildr:render.record`, a `DataRecord`
 * (as `record_list` returns it), or null or absent for none. Read
 * defensively, so an editor that sends none shows bindings as written.
 */
function previewItem(message: object): BindingItem | null {
  const record = (message as { record?: unknown }).record as Partial<DataRecord> | null | undefined
  if (!record || typeof record.id !== 'string' || typeof record.values !== 'object' || record.values === null) return null
  return bindingItem({ id: record.id, createdAt: String(record.createdAt ?? ''), updatedAt: String(record.updatedAt ?? ''), values: record.values })
}

function onMessage(event: MessageEvent) {
  if (event.source !== window.parent || !isCanvasMessage<EditorToCanvas>(event.data)) return
  const message = event.data
  if (message.type === 'bildr:render') {
    page.value = message.page
    if (Object.keys(previews.value).length) previews.value = settlePreviews(previews.value, message.page.root)
    base.value = message.base
    lists.value = message.lists
    item.value = message.page.collection ? previewItem(message) : null
    components.value = message.components ?? []
    layouts.value = message.layouts ?? []
    env.value = message.env ?? {}
    theme.value = message.theme
    view.value = message.view
    boardVariant.value = message.variant ?? null
  } else if (message.type === 'bildr:select') {
    selectedId.value = message.nodeId
    selectedIds.value = message.nodeIds
    accent.value = message.accent ?? SELECTION_ACCENT
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
  } else if (message.type === 'bildr:overlay') {
    panelOverlay.value = message.overlay
  } else if (message.type === 'bildr:preview') {
    const { [message.nodeId]: _, ...others } = previews.value
    previews.value = message.style ? { ...others, [message.nodeId]: message.style } : others
  }
}

function onPointerMove(event: MouseEvent) {
  alt.value = event.altKey
  pointer = canvasPoint(event)
  if (gesture) return
  const over = handleAt(pointer)
  setCursor(over ? ('handle' in over ? handleCursor(over.handle) : spacingCursor(over.spacing)) : null)
  if (tool.value) indicator.value = insertAt(event)?.indicator ?? null
  const id = reachableAt(event.target)
  if (id === hoveredId.value) return
  hoveredId.value = id
  post({ type: 'bildr:hover', nodeId: id })
}

function onPointerLeave() {
  pointer = null
  // A press that hasn't become a drag ends here: its release outside the frame would never reach it.
  endGestureBy('leave')
  if (!gesture) setCursor(null)
  if (tool.value) indicator.value = null
  hoveredId.value = null
  post({ type: 'bildr:hover', nodeId: null })
}

/** In the canvas, clicks select (or insert, with a tool armed): links don't navigate and buttons don't act. */
function onClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (swallowClick) {
    swallowClick = false
    return
  }
  if (tool.value) {
    const insert = insertAt(event)
    indicator.value = null
    if (insert) post({ type: 'bildr:insert', ...insert.hit.target })
    return
  }
  const id = reachableAt(event.target)
  if (id) post({ type: 'bildr:click', nodeId: id, shift: event.shiftKey, meta: event.metaKey || event.ctrlKey, ...variantField() })
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
  const id = reachableAt(event.target)
  if (id) post({ type: 'bildr:contextmenu', nodeId: id, x: event.clientX, y: event.clientY, ...variantField() })
}

const SHORTCUT_KEYS = new Set(['Delete', 'Backspace', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
function onKeyDown(event: KeyboardEvent) {
  // Esc is a drag's own: it cancels it rather than selecting the parent.
  if (event.key === 'Escape' && endGestureBy('escape') === 'cancel') {
    event.preventDefault()
    return
  }
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
  // Cmd/Ctrl+C, V, R and L (copy, paste, rename, lock) without Alt; Cmd/Ctrl+Alt+V (Paste style) by its physical code, as Alt changes the key on a Mac.
  // Copy, rename and lock only with a selection, and copy and paste not over a text selection (`editorTakesKey`): else the browser keeps them.
  const pasteStyleKey = meta && event.altKey && !event.shiftKey && event.code === 'KeyV'
  // Cmd/Ctrl+Alt+K (Create component) and Cmd/Ctrl+Alt+B (Detach instance) by their physical code too.
  const createKey = meta && event.altKey && !event.shiftKey && (event.code === 'KeyK' || event.code === 'KeyB')
  const editorMeta = pasteStyleKey || createKey || (meta && (['z', 'y', 'd', 'a', 'g', 'p', 'f', 'k'].includes(lower) || (!event.altKey && ['c', 'v', 'r', 'l'].includes(lower))))
  const takes = editorTakesKey(
    { key: event.key, code: event.code, meta, shift: event.shiftKey, alt: event.altKey },
    { focus: 'canvas', textSelected: hasTextSelection(window), hasSelection: selectedIds.value.length > 0 }
  )
  if (!takes || (!zoom && !armsTool && !SHORTCUT_KEYS.has(event.key) && !editorMeta && !(event.shiftKey && !meta && lower === 'a'))) return
  event.preventDefault()
  post(canvasKeyMessage(event))
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

/**
 * The drop slot for a pointer over element `el` (at viewport `point`), for a
 * drag of node `draggedId` or of a new component. A locked node (or one
 * inside a lock) is no drop target: its nearest unlocked ancestor takes the drop.
 */
function dropHitAt(el: Element | null, point: Point, draggedId: string | undefined): ReorderHit | null {
  const root = page.value?.root
  if (!root || el?.closest?.('[data-bildr-copy]')) return null
  const over = el?.closest?.('[data-bildr-placeholder]')
  const overEl = over ?? el?.closest?.('[data-bildr-id]')
  const overId = over?.getAttribute('data-bildr-placeholder') ?? overEl?.getAttribute('data-bildr-id')
  // The canvas is as wide as the editor's device, so its width gives the breakpoint that applies.
  return reorderTarget(root, { id: overId, placeholder: !!over }, point, breakpointAt(window.innerWidth), draggedId, (nodeId, redirected) => {
    const nodeEl = redirected ? firstCopy(nodeId) : overEl
    return nodeEl?.getBoundingClientRect() ?? null
  })
}

/** The drop slot under the pointer, plus where to draw it. */
function dropAt(event: DragEvent): { target: DropTarget, indicator: Indicator } | null {
  const types = event.dataTransfer?.types ?? []
  if (!types.includes(DRAG_MIME)) return null
  const hit = dropHitAt(event.target as Element | null, { x: event.clientX, y: event.clientY }, draggedNodeId(types))
  return hit ? { target: hit.target, indicator: indicatorAt(hit.rect, hit.position, hit.horizontal) } : null
}

/** The size Fill (`full`) resolves to for node `id`: its element's parent's content box. */
function fillSize(id: string): { width: number, height: number } | undefined {
  const parent = firstCopy(id)?.parentElement
  if (!parent) return undefined
  const { width, height } = contentOf(parent)
  return { width, height }
}

/** A press in the active frame: on a handle it starts a resize or spacing drag, on the selection a pending drag-to-reorder. */
function onGestureDown(event: PointerEvent) {
  if (event.button !== 0) return
  swallowClick = false
  // A new press means the last one is over, even if its release never reached this frame.
  if (gesture) endGestureBy('press')
  const root = page.value?.root
  const id = editable.value
  if (!root || !id || !editableBox.value) return
  const start = canvasPoint(event)
  const hit = handleAt(start)
  const base = { nodeId: id, pageId: page.value?.id, state: startGesture(event.pointerId, start, !!hit) }
  if (hit && 'handle' in hit) {
    const box = editableBox.value
    const drag = { handle: hit.handle, width: box.width, height: box.height, breakpoint: breakpointAt(window.innerWidth), basePx: spacingBasePx(theme.value?.spacing ?? 'default'), fill: fillSize(id) }
    gesture = { kind: 'resize', ...base, drag, patch: {}, cursor: handleCursor(hit.handle) }
  } else if (hit && spacing.value) {
    const s = spacing.value
    const handle = hit.spacing
    gesture = {
      kind: 'spacing',
      ...base,
      target: handle.kind === 'padding' ? { kind: 'padding', side: handle.side } : { kind: 'gap', axis: s.axis },
      startPx: handle.kind === 'padding' ? s.insets[handle.side] : s.gapPx,
      patch: {},
      cursor: spacingCursor(handle),
      shown: { padding: s.showPadding, gap: s.showGap }
    }
  } else {
    const reached = reachableAt(event.target)
    const node = findNode(root, id)
    if (!reached || !node || !containsNode(node, reached)) return
    gesture = { kind: 'reorder', ...base, target: null }
  }
  if (gesture.state.phase === 'active') beginDrag(gesture)
  window.addEventListener('pointermove', onGestureMove)
  window.addEventListener('pointerup', onGestureUp)
  window.addEventListener('pointercancel', onGestureCancel)
  window.addEventListener('blur', onGestureBlur)
  document.documentElement.addEventListener('lostpointercapture', onLostCapture)
}

/**
 * A press becomes a drag: the pointer is captured (so it keeps dragging outside the frame), and the frame takes the keys (Esc).
 * A pending press is not captured, so its click still reaches the node under it: a move with the button up (released
 * outside the frame) or leaving the frame ends it instead.
 */
function beginDrag(g: Gesture) {
  try {
    document.documentElement.setPointerCapture(g.state.pointerId)
  } catch {
    // The pointer is already gone; its pointerup ends the drag.
  }
  window.focus()
  setCursor(g.kind === 'reorder' ? 'grabbing' : g.cursor)
}

/** Shows a handle drag's patch on the node here at once, and through the editor in the other frames. */
function showPatch(g: Extract<Gesture, { kind: 'resize' | 'spacing' }>, patch: Record<string, string>, at: Point) {
  const spacingScale = theme.value?.spacing ?? 'default'
  const entries = Object.entries(patch)
  dragLabel.value = entries.length ? { text: entries.map(([key, value]) => scaleLabel(key, value, spacingScale)).join(', '), x: at.x, y: at.y } : null
  if (JSON.stringify(patch) === JSON.stringify(g.patch)) return
  g.patch = patch
  const { [g.nodeId]: _, ...others } = previews.value
  previews.value = entries.length ? { ...others, [g.nodeId]: patch } : others
  post({ type: 'bildr:style-preview', nodeId: g.nodeId, style: entries.length ? patch : null })
}

function onGestureMove(event: PointerEvent) {
  const g = gesture
  const root = page.value?.root
  if (!g || !root) return
  const at = canvasPoint(event)
  // The threshold is screen px: scaled back by the editor zoom, like the handles.
  const step = stepGesture(g.state, { type: 'move', pointerId: event.pointerId, point: at, buttons: event.buttons }, REORDER_THRESHOLD / zoom.value)
  if (step.effect === 'ignore' || step.effect === 'wait') return
  if (!step.state) {
    finishGesture(step.effect)
    return
  }
  g.state = step.state
  if (step.effect === 'activate') beginDrag(g)
  const delta = { dx: at.x - g.state.start.x, dy: at.y - g.state.start.y }
  if (g.kind === 'reorder') {
    // The pointer is captured, so the element under it comes from its position.
    const hit = dropHitAt(document.elementFromPoint(event.clientX, event.clientY), { x: event.clientX, y: event.clientY }, g.nodeId)
    g.target = hit && !isNoopMove(root, g.nodeId, hit.target) ? hit.target : null
    indicator.value = hit && g.target ? indicatorAt(hit.rect, hit.position, hit.horizontal) : null
    return
  }
  const style = findNode(root, g.nodeId)?.style ?? {}
  const patch = g.kind === 'resize'
    ? resizePatch(g.drag, delta, event.shiftKey)
    : spacingDragPatch(style, g.target, g.startPx, delta, { breakpoint: breakpointAt(window.innerWidth), basePx: spacingBasePx(theme.value?.spacing ?? 'default'), shift: event.shiftKey })
  showPatch(g, patch, at)
}

/** Ends the drag in progress: listeners, capture, cursor and label. */
function endGesture(): Gesture | null {
  const g = gesture
  gesture = null
  window.removeEventListener('pointermove', onGestureMove)
  window.removeEventListener('pointerup', onGestureUp)
  window.removeEventListener('pointercancel', onGestureCancel)
  window.removeEventListener('blur', onGestureBlur)
  document.documentElement.removeEventListener('lostpointercapture', onLostCapture)
  if (g && document.documentElement.hasPointerCapture?.(g.state.pointerId)) document.documentElement.releasePointerCapture(g.state.pointerId)
  setCursor(null)
  dragLabel.value = null
  return g
}

function onGestureUp(event: PointerEvent) {
  if (!gesture) return
  const step = stepGesture(gesture.state, { type: 'up', pointerId: event.pointerId })
  if (!step.state) finishGesture(step.effect)
}

const onGestureCancel = (event: PointerEvent) => endGestureBy('pointercancel', event.pointerId)
const onGestureBlur = () => endGestureBy('blur')
const onLostCapture = (event: PointerEvent) => endGestureBy('lostcapture', event.pointerId)

/** Ends the gesture for an exit (Esc, blur, lost capture…) if it applies; returns what that did (`cancel` for a running drag). */
function endGestureBy(reason: GestureEndReason, pointerId?: number): GestureEffect {
  if (!gesture) return 'ignore'
  const step = stepGesture(gesture.state, { type: 'end', reason, pointerId })
  if (!step.state) finishGesture(step.effect)
  return step.effect
}

/** Ends the gesture by its outcome: `commit`, `cancel` (like Esc) or `abandon` (a press that never dragged: no effect). */
function finishGesture(effect: GestureEffect) {
  const g = endGesture()
  if (!g) return
  if (g.kind === 'reorder') indicator.value = null
  if (effect === 'abandon') return
  swallowClick = true
  if (effect === 'cancel') {
    if (g.kind !== 'reorder' && Object.keys(g.patch).length) dropPreview(g.nodeId)
    return
  }
  commitGesture(g)
}

/** The release: a handle drag commits its patch (one undo step), a reorder drag moves the node to the slot shown. */
function commitGesture(g: Gesture) {
  const root = page.value?.root
  if (g.kind === 'reorder') {
    if (g.target) post({ type: 'bildr:drop', ...g.target, payload: JSON.stringify({ kind: 'node', id: g.nodeId }) })
    return
  }
  const node = root ? findNode(root, g.nodeId) : undefined
  const changed = node ? changedPatch(node.style, g.patch) : {}
  if (Object.keys(changed).length) post({ type: 'bildr:style-commit', nodeId: g.nodeId, style: changed })
  else if (Object.keys(g.patch).length) dropPreview(g.nodeId)
}

function dropPreview(nodeId: string) {
  const { [nodeId]: _, ...others } = previews.value
  previews.value = others
  post({ type: 'bildr:style-preview', nodeId, style: null })
}

// The dragged node going (deselected, deleted, another page, locked, or no longer editable here) cancels the drag like Esc.
watch([page, selectedIds, editable], () => {
  const g = gesture
  if (g && (gestureTargetGone(g, { pageId: page.value?.id, root: page.value?.root, selectedIds: selectedIds.value }) || editable.value !== g.nodeId)) endGestureBy('target-gone')
})

/** The drop indicator for `position` relative to an element's viewport `rect`: its outline inside, else a line on that side. */
function indicatorAt(rect: Rect, position: DropPosition, horizontal: boolean): Indicator {
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
  // Lock-aware: a click on a locked node (or inside a lock) inserts into its nearest unlocked ancestor.
  const id = reachableAt(event.target)
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
  document.addEventListener('pointerdown', onGestureDown, true)
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
  document.removeEventListener('pointerdown', onGestureDown, true)
  endGesture()
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
    :style="view === 'page' ? { minHeight: `${FRAME_MIN_HEIGHT}px`, [VIEWPORT_VAR]: `${viewportHeight}px`, [ACCENT_VAR]: accent } : { [ACCENT_VAR]: accent }"
    :data-canvas-accent="accent"
    :data-board-variant="boardVariant ? (boardVariant.id ?? 'primary') : undefined"
  >
    <EditorTokenSheet
      v-if="view === 'tokens'"
      :theme="theme"
    />
    <BildrPage
      v-else-if="shownPage"
      :page="shownPage"
      :item="item"
      :base="base"
      :lists="lists"
      :components="components"
      :layouts="layouts"
      :env="env"
      missing-env="keep"
      editable
      :interactive="false"
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
      :class="box === boxes.hover ? (measurement ? 'outline-[#f24822]' : 'outline-(--canvas-accent)/50') : 'outline-(--canvas-accent)'"
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
    <!-- Padding and gap overlays: accent hatching, with a drag handle per side and gap. -->
    <template v-if="spacing">
      <div
        v-if="spacing.showPadding"
        class="contents"
        data-spacing-overlay="padding"
      >
        <div
          v-for="area in paddingRects(spacing.rect, spacing.insets).filter(a => a.width > 0 && a.height > 0)"
          :key="area.side"
          class="pointer-events-none absolute z-50"
          :style="{ ...rectStyle(area), ...hatch() }"
          :data-padding-area="area.side"
        />
      </div>
      <div
        v-if="spacing.showGap"
        class="contents"
        data-spacing-overlay="gap"
      >
        <div
          v-for="(gap, i) in spacing.gaps.filter(g => g.width > 0 && g.height > 0)"
          :key="i"
          class="pointer-events-none absolute z-50"
          :style="{ ...rectStyle(gap), ...hatch() }"
          data-gap-area
        />
      </div>
      <div
        v-for="handle in spacingHandleList"
        :key="handle.kind === 'padding' ? handle.side : `gap-${handle.index}`"
        class="pointer-events-none absolute z-50 rounded-full bg-(--canvas-accent)"
        :style="spacingHandleStyle(handle)"
        :data-spacing-handle="handle.kind === 'padding' ? handle.side : 'gap'"
      />
    </template>
    <div
      v-for="h in resizeHandles"
      :key="h.handle"
      class="pointer-events-none absolute z-50 rounded-full bg-(--canvas-accent)"
      :style="{ left: `${h.x - HANDLE_PX / 2 / zoom}px`, top: `${h.y - HANDLE_PX / 2 / zoom}px`, width: `${HANDLE_PX / zoom}px`, height: `${HANDLE_PX / zoom}px`, boxShadow: ringShadow(1.5) }"
      :data-resize-handle="h.handle"
    />
    <span
      v-if="dragLabel"
      class="pointer-events-none absolute z-50 origin-top-left rounded-sm bg-(--canvas-accent) px-1 text-[10px] leading-4 font-medium whitespace-nowrap text-white tabular-nums"
      :style="{ left: `${dragLabel.x + 12 / zoom}px`, top: `${dragLabel.y + 12 / zoom}px`, transform: `scale(${1 / zoom})` }"
      data-drag-label
    >{{ dragLabel.text }}</span>
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
