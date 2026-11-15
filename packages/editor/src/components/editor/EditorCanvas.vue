<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { NodeBox } from '@bildr/editor-core/autoLayout'
import { revealFrame } from '@bildr/editor-core/devices'
import { createThrottle, PREVIEW_INTERVAL } from '@bildr/editor-core/preview'
import type { PreviewState } from '@bildr/editor-core/preview'
import type { Device } from '@bildr/editor-core/styleFields'
import type { Point, Rect, Viewport, ZoomCommand } from '@bildr/editor-core/viewport'
import { activeMessage, boundsOf, fitView, FRAME_BAR_HEIGHT, FRAME_GAP, FRAME_MIN_HEIGHT, layoutFrames, panView, selectionView, stepZoom, viewportHeight, wheelPixels, wheelZoom, zoomAround, zoomShortcut } from '@bildr/editor-core/viewport'
import { canvasSrc } from '../../design/config.ts'
import { isCanvasMessage } from '../../canvas/protocol.ts'
import type { CanvasToEditor, CanvasView, EditorToCanvas, RenderMessage } from '../../canvas/protocol.ts'
import { isInsertTool, pointerMode } from '../../editor/tools.ts'
import type { StateKind } from '../../editor/useEditor.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { FOCUS_RING } from '../../editorUi.ts'
import { ARROW_TOP, arrowGeometry, boardArrows } from '../../shared/interactionArrows.ts'
import { EVENT_LABELS } from '../../shared/interactionPanel.ts'
import { childrenSlotNode } from '../../shared/layoutEditor.ts'
import type { BoardFrame } from '../../shared/variantBoard.ts'
import { boardDropTarget, boardFrameKey, boardFrames, boardLayout } from '../../shared/variantBoard.ts'

/**
 * The editor canvas. The page view is a Figma-style infinite surface showing
 * one frame per device side by side (Desktop, Tablet, then the Primary
 * Mobile frame, as in Framer), each a `/canvas` iframe at the device's
 * native width (so `md:`/`lg:` match it) and as tall as its content, all
 * scaled by one zoom/pan transform. Every frame gets the same messages, so
 * selection, hover and previews show in all of them; the active frame is
 * `editor.device`, the breakpoint the style panel edits. Wheel pans,
 * Cmd/Ctrl + wheel or pinch zooms around the pointer, and a drag with the
 * Hand tool, Space held or the middle button pans; the iframes forward those
 * gestures. The `tokens` view is one plain iframe with the theme's token
 * preview sheet. The editor measures node boxes in the active frame through
 * this component (Shift+A), and Alt held here shows the frames'
 * measurements. The floating bar's zoom menu also holds the Deep select
 * setting (on: a click selects the innermost element; off: Figma's drill,
 * where the first click selects a top-level element). The armed insert tool
 * goes to the frames, which report where a click inserts, and so does the
 * light/dark preview. Each frame has Framer's header bar (EditorFrameBar):
 * clicking it activates the frame, ▶ previews the draft in a popup that wide.
 * The frames shown are the editor's visible frames (`editor.visibleDevices`):
 * the bar's "+" adds a hidden one back and its right-click menu hides one.
 * Direct manipulation (#23): the active frame's handle drags preview a style
 * patch and commit it through `updateStyle` (one undo step, `setOverride` in
 * the variant view), and the panel's hovered Padding or Gap field goes to the
 * frames as `bildr:overlay`.
 * In the component view, the variant board (`editor.variantBoard`) replaces
 * the device frames with one frame per variant at the active breakpoint
 * (Primary, then each variant), each labelled with a purple chip
 * (EditorVariantBar) and ending with a dashed "+ Variant" tile. The active
 * variant's frame is the active one: it alone shows the selection, handles
 * and previews. A click, right-click, drop or insert in another frame makes
 * its variant active first, so edits override that variant. Each base's
 * hover and pressed states go under it, joined by a purple line, with a
 * dashed "+ Hover / Pressed" tile below while a kind is missing. Each frame
 * has a ⚡ handle on its right edge: dragging it to another base frame
 * adds a click interaction and opens its popover. Interactions draw as
 * curved purple arrows over the board (`interactionArrows.ts`); clicking
 * one, or its event label, selects it and opens the popover, and Delete
 * removes the selected one.
 * In the layout view, the children slot gets a light-purple placeholder,
 * "Page content — your page appears here", drawn over its box as measured
 * in each frame (clicks and drops pass through to the slot).
 */
const { view = 'page' } = defineProps<{ view?: CanvasView }>()
const editor = useEditor()
const emit = defineEmits<{ key: [message: Extract<CanvasToEditor, { type: 'bildr:key' }>] }>()
const stage = useTemplateRef<HTMLDivElement>('stage')
const tokenFrame = useTemplateRef<HTMLIFrameElement>('tokenFrame')

/** The mounted frame iframes by frame key (a device id, or `variant:<key>` on the board); null keys the token preview. */
const frames = new Map<string | null, HTMLIFrameElement>()
function frameRef(key: string) {
  return (el: unknown) => {
    if (el) frames.set(key, el as HTMLIFrameElement)
    else frames.delete(key)
  }
}

/** A frame on the canvas: a device's, or on the variant board a variant's (at the active device's width). */
interface ShownFrame { key: string, device: Device, rect: Rect, variant?: BoardFrame }

const board = computed(() => view === 'page' && editor.variantBoard)
const boardList = computed<BoardFrame[]>(() => (editor.component ? boardFrames(editor.component.variants) : []))
const boardKey = (variantId: string | null) => `variant:${boardFrameKey(variantId)}`
/** The frame the style panel edits: the active device's, or on the board the active variant's. */
const activeKey = computed(() => (board.value ? boardKey(editor.variant?.id ?? null) : editor.deviceId))

const FRAMES_KEY = 'bildr:canvas-frames'
/** All frames, or only the active one (small screens, performance); remembered across reloads. */
const singleFrame = ref(view === 'page' && localStorage.getItem(FRAMES_KEY) === 'single')
const heights = reactive<Record<string, number>>({})
const frameHeight = (key: string) => Math.max(FRAME_MIN_HEIGHT, heights[key] ?? 0)
const shownDevices = computed(() => (singleFrame.value ? [editor.device] : editor.visibleDevices))
/** On the board, where its frames, tiles and state lines go (`boardLayout`), with the frames' keys; null off the board. */
const boardPlaced = computed(() => {
  if (!board.value) return null
  const keys = boardList.value.map(f => boardKey(f.variantId))
  return { keys, ...boardLayout(boardList.value, keys.map(frameHeight), editor.device.width, FRAME_GAP) }
})
/** The frames and where they go, plus the board's "+ Variant" tile (null off the board). */
const placement = computed<{ frames: ShownFrame[], add: Rect | null }>(() => {
  const placed = boardPlaced.value
  if (placed) {
    const device = editor.device
    return { frames: boardList.value.map((variant, i) => ({ key: placed.keys[i]!, device, rect: placed.frames[i]!, variant })), add: placed.add }
  }
  const rects = layoutFrames(shownDevices.value.map(d => ({ width: d.width, height: frameHeight(d.id) })), FRAME_GAP)
  return { frames: shownDevices.value.map((device, i) => ({ key: device.id, device, rect: rects[i]! })), add: null }
})
const layout = computed(() => placement.value.frames)

const viewport = ref<Viewport>({ x: 0, y: 0, zoom: 1 })
const stageSize = reactive({ width: 0, height: 0 })
const observer = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(([entry]) => Object.assign(stageSize, { width: entry!.contentRect.width, height: entry!.contentRect.height }))
  : null
/** Room around fitted content, in screen px; the frame header bars sit in it. */
const FIT_PADDING = 48 + FRAME_BAR_HEIGHT
/** Until the user zooms or pans, the view keeps fitting the frames as they load and grow. */
let autoFit = true

function fit() {
  const add = placement.value.add
  const stateAdds = boardPlaced.value?.stateAdds.map(tile => tile.rect) ?? []
  viewport.value = fitView(boundsOf([...layout.value.map(f => f.rect), ...(add ? [add] : []), ...stateAdds]), stageSize, FIT_PADDING)
}

/** A "+ Hover / Pressed" tile's menu: the kinds its base lacks (the others disabled). */
function stateMenu(tile: { variantId: string | null, taken: StateKind[] }) {
  const item = (kind: StateKind, label: string, icon: string) => ({
    label,
    icon,
    disabled: tile.taken.includes(kind),
    description: tile.taken.includes(kind) ? 'Already added' : undefined,
    onSelect: () => editor.addState(tile.variantId, kind)
  })
  return [item('hover', 'Hover', 'i-lucide-mouse-pointer-2'), item('pressed', 'Pressed', 'i-lucide-pointer')]
}

/** Where a frame's ⚡ handle sits: on its right edge, level with the arrows. */
const handlePoint = (rect: Rect): Point => ({ x: rect.x + rect.width, y: rect.y + Math.min(ARROW_TOP, rect.height / 2) })

/** The board's interaction arrows, with their geometry in board pixels. */
const arrows = computed(() => {
  const placed = boardPlaced.value
  const def = editor.component
  if (!placed || !def) return []
  const rectOf = new Map(boardList.value.map((f, i) => [f.key, placed.frames[i]!]))
  return boardArrows(def, boardList.value).map(arrow => ({
    ...arrow,
    label: EVENT_LABELS[arrow.on],
    ...arrowGeometry(rectOf.get(arrow.from)!, rectOf.get(arrow.to)!, { lane: arrow.lane, head: 10 / viewport.value.zoom })
  }))
})
const selectedArrow = computed(() => arrows.value.find(arrow => arrow.id === editor.interactionId) ?? null)
/** The board's Interaction popover, at the selected arrow. */
const arrowPopover = ref(false)
watch(selectedArrow, (arrow) => {
  if (!arrow) arrowPopover.value = false
})

function selectArrow(id: string) {
  editor.interactionId = id
  arrowPopover.value = true
}

/** A ⚡ drag in progress: from which frame, where it started and is now (board pixels), and the frame it would go to. */
const linking = ref<{ from: BoardFrame, start: Point, at: Point, target: string | null } | null>(null)

function contentPoint(clientX: number, clientY: number): Point {
  const p = stagePoint(clientX, clientY)
  return { x: (p.x - viewport.value.x) / viewport.value.zoom, y: (p.y - viewport.value.y) / viewport.value.zoom }
}

function linkTarget(from: BoardFrame, at: Point): BoardFrame | undefined {
  const placed = boardPlaced.value
  return placed ? boardDropTarget(boardList.value, placed.frames, at, from.key) : undefined
}

/** Drags from a frame's ⚡ handle; dropped on another base frame, it adds a click interaction and opens its popover. */
function startLink(event: PointerEvent, frame: ShownFrame) {
  const from = frame.variant
  if (event.button !== 0 || !from) return
  event.preventDefault()
  event.stopPropagation()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const start = handlePoint(frame.rect)
  linking.value = { from, start, at: start, target: null }
  const move = (e: PointerEvent) => {
    const at = contentPoint(e.clientX, e.clientY)
    linking.value = { from, start, at, target: linkTarget(from, at)?.key ?? null }
  }
  const end = async (e: PointerEvent) => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    linking.value = null
    const target = e.type === 'pointerup' ? linkTarget(from, contentPoint(e.clientX, e.clientY)) : undefined
    if (!target) return
    const id = await editor.addInteraction(from.variantId, 'click', target.variantId ?? '')
    if (id) selectArrow(id)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

// Turning the board on or off shows other frames: fit them again.
watch(board, () => {
  autoFit = true
})

watch([layout, () => stageSize.width, () => stageSize.height], () => {
  if (autoFit && stageSize.width) fit()
})

function zoomTo(zoom: number, at: Point = { x: stageSize.width / 2, y: stageSize.height / 2 }) {
  autoFit = false
  viewport.value = zoomAround(viewport.value, zoom, at)
}

/** Shift+2: fits the selection, as measured in the active frame; nothing without one. */
async function zoomToSelection() {
  const frame = layout.value.find(f => f.key === activeKey.value)?.rect
  if (!frame || !editor.selectedIds.length) return
  const view = selectionView(await measureNodes(editor.selectedIds), frame, stageSize, FIT_PADDING)
  if (!view) return
  autoFit = false
  viewport.value = view
}

function zoomCommand(command: ZoomCommand) {
  if (command === 'selection') return void zoomToSelection()
  autoFit = false
  if (command === 'fit') fit()
  else if (command === 'reset') zoomTo(1)
  else zoomTo(stepZoom(viewport.value.zoom, command === 'in' ? 1 : -1))
}

// Zooms asked for elsewhere, e.g. from the quick actions.
watch(() => editor.zoomRequest, (request) => {
  if (request && view === 'page') zoomCommand(request.command)
})

// A device picked on the floating bar, with ⌥1–3 or ⌘K: pan its frame into view at the same zoom (a single frame refits instead).
watch(() => editor.frameRequest, (request) => {
  const rect = request && view === 'page' && !singleFrame.value && !board.value ? layout.value.find(f => f.key === request.deviceId)?.rect : undefined
  if (!rect || !stageSize.width) return
  autoFit = false
  viewport.value = revealFrame(viewport.value, rect, stageSize, FIT_PADDING)
}, { flush: 'post' })

function panBy(dx: number, dy: number) {
  autoFit = false
  viewport.value = { ...viewport.value, x: viewport.value.x + dx, y: viewport.value.y + dy }
}

/** A wheel at a stage point: Cmd/Ctrl (or a pinch) zooms around it, else it pans. */
function wheel(dx: number, dy: number, zoom: boolean, at: Point) {
  if (zoom) zoomTo(wheelZoom(viewport.value.zoom, dy), at)
  else panBy(-dx, -dy)
}

function stagePoint(clientX: number, clientY: number): Point {
  const rect = stage.value!.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function onStageWheel(event: WheelEvent) {
  event.preventDefault()
  wheel(wheelPixels(event.deltaX, event.deltaMode), wheelPixels(event.deltaY, event.deltaMode), event.ctrlKey || event.metaKey, stagePoint(event.clientX, event.clientY))
}

/** A wheel forwarded by a frame, at its canvas coordinates. */
function onFrameWheel(el: HTMLIFrameElement, { dx, dy, zoom, x, y }: Extract<CanvasToEditor, { type: 'bildr:wheel' }>) {
  const rect = el.getBoundingClientRect()
  wheel(dx, dy, zoom, stagePoint(rect.left + x * viewport.value.zoom, rect.top + y * viewport.value.zoom))
}

// The Hand tool or Space held shows a grab layer over the frames, so the drag lands in the editor, not in a canvas (and never selects).
const spaceHeld = ref(false)
const panning = ref(false)
const pointerInStage = ref(false)
const panMode = computed(() => pointerMode(editor.tool, spaceHeld.value) === 'pan')

function onStagePointerDown(event: PointerEvent) {
  if (event.button !== 1 && !(event.button === 0 && panMode.value)) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  let last = { x: event.clientX, y: event.clientY }
  panning.value = true
  const move = (e: PointerEvent) => {
    const next = { x: e.clientX, y: e.clientY }
    autoFit = false
    viewport.value = panView(viewport.value, last, next)
    last = next
  }
  const up = () => {
    panning.value = false
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', up)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', up)
}

function isEditable(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === 'Alt') broadcast({ type: 'bildr:alt', down: true })
  if (editor.mode !== 'build' || isEditable(event.target)) return
  if (event.code === 'Space') {
    if (!pointerInStage.value && !spaceHeld.value) return
    event.preventDefault()
    spaceHeld.value = true
    return
  }
  const command = zoomShortcut({ code: event.code, key: event.key, meta: event.metaKey || event.ctrlKey, shift: event.shiftKey })
  if (!command) return
  event.preventDefault()
  zoomCommand(command)
}

function onWindowKeyUp(event: KeyboardEvent) {
  if (event.key === 'Alt') broadcast({ type: 'bildr:alt', down: false })
  if (event.code !== 'Space' || !spaceHeld.value) return
  event.preventDefault()
  spaceHeld.value = false
}

const zoomItems = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Zoom in', icon: 'i-lucide-zoom-in', kbds: ['meta', '+'], onSelect: () => zoomCommand('in') },
    { label: 'Zoom out', icon: 'i-lucide-zoom-out', kbds: ['meta', '-'], onSelect: () => zoomCommand('out') }
  ],
  [
    { label: 'Zoom to fit', kbds: ['shift', '1'], onSelect: () => zoomCommand('fit') },
    { label: 'Zoom to selection', kbds: ['shift', '2'], disabled: !editor.selectedIds.length, onSelect: () => zoomCommand('selection') },
    { label: 'Zoom to 50%', onSelect: () => zoomTo(0.5) },
    { label: 'Zoom to 100%', kbds: ['shift', '0'], onSelect: () => zoomTo(1) },
    { label: 'Zoom to 200%', onSelect: () => zoomTo(2) }
  ],
  [
    { label: 'Select parent', kbds: ['escape'], disabled: !editor.selectedId || editor.selectedId === editor.page?.root.id, onSelect: () => editor.navigate('parent') }
  ],
  [
    { label: 'All frames', type: 'checkbox', checked: !singleFrame.value, onUpdateChecked: () => setSingleFrame(false) },
    { label: 'Active frame only', type: 'checkbox', checked: singleFrame.value, onUpdateChecked: () => setSingleFrame(true) }
  ],
  [
    { label: 'Deep select', type: 'checkbox', checked: editor.deepSelect, onUpdateChecked: (value: boolean) => editor.setDeepSelect(value) }
  ]
])

function setSingleFrame(value: boolean) {
  singleFrame.value = value
  localStorage.setItem(FRAMES_KEY, value ? 'single' : 'all')
  autoFit = true
}

// In single-frame mode another active frame is another frame to fit.
watch(() => editor.deviceId, () => {
  if (singleFrame.value) autoFit = true
})

/** Makes a frame the active one: its device, or on the board its variant (`variantId`, as the frame reported it, wins). */
function activate(frame: ShownFrame | undefined, variantId?: string | null) {
  if (frame?.variant) editor.selectVariant(variantId !== undefined ? variantId : frame.variant.variantId)
  else if (frame) editor.deviceId = frame.device.id
}

function frameTitle(frame: ShownFrame): string {
  // The active frame keeps the plain "Canvas" title the e2e scripts and assistive tech look for.
  return frame.key === activeKey.value ? 'Canvas' : `Canvas ${frame.variant?.label ?? frame.device.label}`
}

const frameAt = (key: string | null | undefined) => (key ? layout.value.find(f => f.key === key) : undefined)

function post(el: HTMLIFrameElement, message: EditorToCanvas) {
  // The document lives in reactive proxies, which postMessage cannot clone.
  el.contentWindow?.postMessage(JSON.parse(JSON.stringify(message)), window.location.origin)
}

function broadcast(message: EditorToCanvas) {
  for (const el of frames.values()) post(el, message)
}

/**
 * What frame `key` renders (the module's `RenderMessage`, P4a): the file being edited with the project's
 * components, layouts, theme and data; a component shows a variant, which on the board is the frame's own
 * (`id` null is the primary, which the render calls `default`), else the active one.
 */
function renderMessage(key: string | null): RenderMessage | null {
  const file = editor.page
  if (!file) return null
  const board = frameAt(key)?.variant
  const shown = board
    ? { id: board.variantId, label: board.variantId === null ? 'default' : board.label }
    : editor.variant ? { id: editor.variant.id, label: editor.variant.name } : { id: null, label: 'default' }
  const isPage = !editor.componentId && !editor.layoutId
  return {
    type: 'bildr:render',
    file,
    components: editor.components,
    layouts: editor.layouts,
    theme: editor.theme,
    breakpointBase: editor.breakpointBase,
    data: editor.data,
    paths: editor.pagePaths,
    ...(isPage && editor.pagePaths[file.id] ? { path: editor.pagePaths[file.id] } : {}),
    ...(editor.componentId ? { variant: shown } : {}),
    view
  }
}

/** Every frame shows the selection, except on the board, where only the active variant's does. */
const showsSelection = (key: string | null) => !board.value || key === activeKey.value

function selectMessage(key: string | null): EditorToCanvas {
  return showsSelection(key)
    ? { type: 'bildr:select', nodeId: editor.selectedId, nodeIds: editor.selectedIds, accent: editor.canvasAccent }
    : { type: 'bildr:select', nodeId: null, nodeIds: [], accent: editor.canvasAccent }
}

/** On the board, the frame the pointer hovers in (else the active one) shows the hover; elsewhere every frame does. */
const hoverKey = ref<string | null>(null)
function hoverMessage(key: string | null): EditorToCanvas {
  const shows = !board.value || key === (hoverKey.value ?? activeKey.value)
  return { type: 'bildr:hover', nodeId: shows ? editor.hoveredId : null }
}

function activeFrameMessage(key: string): EditorToCanvas {
  if (!board.value) return activeMessage(key, editor.deviceId, viewport.value.zoom)
  return { type: 'bildr:active', active: key === activeKey.value, zoom: viewport.value.zoom, viewportHeight: viewportHeight(editor.deviceId) }
}

function postEach(message: (key: string | null) => EditorToCanvas | null) {
  for (const [key, el] of frames) {
    const m = message(key)
    if (m) post(el, m)
  }
}

function toolMessage(): EditorToCanvas {
  return { type: 'bildr:tool', tool: view === 'page' && isInsertTool(editor.tool) ? editor.tool : null }
}

function render() {
  if (!renderMessage(null)) return
  postEach(renderMessage)
  postEach(selectMessage)
}

const modeMessage = (): EditorToCanvas => ({ type: 'bildr:mode', mode: editor.canvasMode })

/** Brings a frame that just loaded up to date with the others. */
function sync(key: string | null, el: HTMLIFrameElement) {
  const message = renderMessage(key)
  if (!message) return
  post(el, message)
  post(el, selectMessage(key))
  post(el, hoverMessage(key))
  post(el, toolMessage())
  post(el, modeMessage())
  post(el, { type: 'bildr:dark', dark: editor.previewDark })
  post(el, { type: 'bildr:overlay', overlay: editor.spacingOverlay })
  if (key) post(el, activeFrameMessage(key))
  const preview = editor.stylePreview
  if (preview && showsSelection(key)) for (const nodeId of previewTargets(preview)) post(el, { type: 'bildr:preview', nodeId, style: preview.style })
}

/** Pending `bildr:measure` requests by id; a frame that never answers resolves with no boxes. */
const measures = new Map<number, (rects: NodeBox[]) => void>()
let measureId = 0

/** The boxes of nodes in the active frame (or frame `key`), in its canvas pixels. */
function measureNodes(nodeIds: string[], key: string = activeKey.value): Promise<NodeBox[]> {
  const el = frames.get(key)
  if (!el || !nodeIds.length) return Promise.resolve([])
  const requestId = ++measureId
  return new Promise((resolve) => {
    const timer = setTimeout(() => done([]), 1000)
    const done = (rects: NodeBox[]) => {
      clearTimeout(timer)
      measures.delete(requestId)
      resolve(rects)
    }
    measures.set(requestId, done)
    post(el, { type: 'bildr:measure', requestId, nodeIds })
  })
}

/** Replays a canvas right-click on its iframe, in editor coordinates, for an enclosing EditorNodeMenu. */
function openNodeMenu(el: HTMLIFrameElement, { nodeId, x, y }: Extract<CanvasToEditor, { type: 'bildr:contextmenu' }>) {
  const rect = el.getBoundingClientRect()
  const scale = el.offsetWidth ? rect.width / el.offsetWidth : 1
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + x * scale, clientY: rect.top + y * scale })
  el.dispatchEvent(Object.assign(event, { bildrNodeId: nodeId }))
}

function onMessage(event: MessageEvent) {
  // Only a frame of this editor, from this origin, is heard.
  if (event.origin !== window.location.origin) return
  const [id, el] = [...frames].find(([, frame]) => frame.contentWindow === event.source) ?? []
  if (!el || !isCanvasMessage<CanvasToEditor>(event.data)) return
  const message = event.data
  const frame = frameAt(id)
  if (message.type === 'bildr:ready') {
    editor.dragging = null
    sync(id ?? null, el)
  } else if (message.type === 'bildr:hover') {
    hoverKey.value = message.nodeId ? id ?? null : null
    editor.hoveredId = message.nodeId
  } else if (message.type === 'bildr:click') {
    // On the board the frame's variant becomes the active one first, so the selection edits it.
    activate(frame, message.variantId)
    editor.canvasClick(message.nodeId, message)
  } else if (message.type === 'bildr:insert') {
    activate(frame)
    editor.insertWithTool({ parentId: message.parentId, index: message.index })
  } else if (message.type === 'bildr:rects') measures.get(message.requestId)?.(message.rects)
  else if (message.type === 'bildr:key') {
    const command = view === 'page' ? zoomShortcut(message) : null
    if (command) zoomCommand(command)
    else emit('key', message)
  } else if (message.type === 'bildr:contextmenu') {
    activate(frame, message.variantId)
    openNodeMenu(el, message)
  } else if (message.type === 'bildr:drop') {
    activate(frame)
    editor.drop(message.payload, { parentId: message.parentId, index: message.index })
  } else if (message.type === 'bildr:style-preview') {
    // Esc, in the editor, cancels the drag the preview belongs to (`bildr:cancel-drag`) instead of clearing the selection.
    editor.dragging = message.style ? message.nodeId : null
    editor.previewStyle(message.nodeId, message.style)
  } else if (message.type === 'bildr:style-commit') {
    editor.dragging = null
    void editor.updateStyle(message.nodeId, message.style)
  } else if (message.type === 'bildr:interaction') {
    // A submitted form or an action run in preview may have changed the app's rows.
    if (message.step.kind === 'runAction') editor.refreshDataSoon()
  } else if (id && message.type === 'bildr:size') heights[id] = message.height
  else if (id && message.type === 'bildr:wheel') onFrameWheel(el, message)
  else if (id && message.type === 'bildr:pan') panBy(message.dx, message.dy)
  else if (id && message.type === 'bildr:space') spaceHeld.value = message.down
}

// The model's files are replaced, not mutated, when it is read again: an identity change is a new render.
watch(() => [editor.page, editor.theme, editor.data, editor.pagePaths, editor.components, editor.layouts, editor.variant, editor.breakpointBase, board.value], render)
watch(() => editor.canvasMode, mode => broadcast({ type: 'bildr:mode', mode }))
watch(() => editor.dragCancels, () => broadcast({ type: 'bildr:cancel-drag' }))

/** In the layout view, the children slot's node; its placeholder boxes per frame key, in frame pixels. */
const slotNodeId = computed(() => (view === 'page' && editor.layout ? childrenSlotNode(editor.layout) : null))
const slotBoxes = ref<Record<string, NodeBox>>({})
let slotTimer: ReturnType<typeof setTimeout> | undefined
/** Measures the slot in every frame once the frames have rendered the last change. */
function measureSlot() {
  clearTimeout(slotTimer)
  const id = slotNodeId.value
  if (!id) return void (slotBoxes.value = {})
  slotTimer = setTimeout(async () => {
    const keys = layout.value.map(f => f.key)
    const boxes = await Promise.all(keys.map(key => measureNodes([id], key)))
    if (slotNodeId.value !== id) return
    slotBoxes.value = Object.fromEntries(keys.flatMap((key, i) => (boxes[i]![0] ? [[key, boxes[i]![0]]] : [])))
  }, 80)
}
watch(() => [slotNodeId.value, editor.page, heights, layout.value.map(f => f.key)], measureSlot, { deep: true })
watch([() => editor.selectedIds, () => editor.canvasAccent, activeKey], () => postEach(selectMessage))
watch([() => editor.hoveredId, hoverKey, activeKey], () => postEach(hoverMessage))
watch(() => editor.tool, () => broadcast(toolMessage()))
watch(() => editor.previewDark, dark => broadcast({ type: 'bildr:dark', dark }))
watch(() => editor.spacingOverlay, overlay => broadcast({ type: 'bildr:overlay', overlay }))
watch([() => editor.deviceId, () => viewport.value.zoom, activeKey], () => {
  for (const [key, el] of frames) if (key) post(el, activeFrameMessage(key))
})

type PreviewMessage = Extract<EditorToCanvas, { type: 'bildr:preview' }>
const previewTargets = (state: PreviewState) => state.nodeIds ?? [state.nodeId]
// Style previews move with a drag, so they are throttled (one batch per selection); a clear goes at once and drops any pending one.
// On the board only the active variant's frame shows them.
const postPreview = (message: PreviewMessage) => postEach(key => (showsSelection(key) ? message : null))
const previews = createThrottle<PreviewMessage[]>(batch => batch.forEach(postPreview), PREVIEW_INTERVAL)
// After the render watcher, so a commit's clear always follows the render that shows the committed value.
watch(() => editor.stylePreview, (next, prev) => {
  const kept = next ? previewTargets(next) : []
  const cleared = prev ? previewTargets(prev).filter(nodeId => !kept.includes(nodeId)) : []
  if (cleared.length) previews.flush(cleared.map(nodeId => ({ type: 'bildr:preview', nodeId, style: null })))
  if (next) previews.push(kept.map(nodeId => ({ type: 'bildr:preview', nodeId, style: next.style })))
}, { flush: 'post' })

onMounted(() => {
  window.addEventListener('message', onMessage)
  if (view === 'tokens') {
    if (tokenFrame.value) frames.set(null, tokenFrame.value)
    return
  }
  window.addEventListener('keydown', onWindowKeyDown)
  window.addEventListener('keyup', onWindowKeyUp)
  if (stage.value) observer?.observe(stage.value)
  editor.setMeasurer(measureNodes)
})
onBeforeUnmount(() => {
  if (view === 'page') editor.setMeasurer(null)
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('keyup', onWindowKeyUp)
  observer?.disconnect()
  clearTimeout(slotTimer)
})
</script>

<template>
  <iframe
    v-if="view === 'tokens'"
    ref="tokenFrame"
    :src="canvasSrc"
    title="Token preview"
    class="size-full rounded-lg bg-white shadow-sm ring ring-default"
  />
  <div
    v-else
    ref="stage"
    class="relative size-full overflow-clip select-none"
    data-canvas-stage
    @wheel="onStageWheel"
    @pointerdown="onStagePointerDown"
    @pointerenter="pointerInStage = true"
    @pointerleave="pointerInStage = false"
  >
    <div
      class="absolute top-0 left-0 origin-top-left"
      :style="{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }"
      data-canvas-content
    >
      <!-- The purple line joining each base variant to its states, under the frames. -->
      <div
        v-for="(link, i) in boardPlaced?.links ?? []"
        :key="`link-${i}`"
        class="pointer-events-none absolute bg-(--editor-context)"
        :style="{ left: `${link.x - 0.5 / viewport.zoom}px`, top: `${link.y1}px`, width: `${1 / viewport.zoom}px`, height: `${link.y2 - link.y1}px` }"
        :data-board-link="link.base"
      />
      <div
        v-for="frame in layout"
        :key="frame.key"
        class="absolute"
        :style="{ left: `${frame.rect.x}px`, top: `${frame.rect.y}px`, width: `${frame.rect.width}px`, height: `${frame.rect.height}px` }"
        :data-frame="frame.variant ? undefined : frame.device.id"
        :data-board-frame="frame.variant?.key"
        :data-active="frame.key === activeKey || undefined"
      >
        <!-- The header bar and the active outline keep their screen size at any zoom. -->
        <EditorVariantBar
          v-if="frame.variant"
          :label="frame.variant.label"
          :primary="frame.variant.primary"
          :active="frame.key === activeKey"
          :zoom="viewport.zoom"
          :width="frame.rect.width"
          @activate="activate(frame)"
          @rename="frame.variant.variantId && editor.renameVariant(frame.variant.variantId, $event)"
        />
        <EditorFrameBar
          v-else
          :device="frame.device"
          :zoom="viewport.zoom"
          :active="frame.key === activeKey"
          :hidden="editor.hiddenDevices"
          @activate="activate(frame)"
          @preview="editor.openPreview(frame.device.width)"
          @add="editor.showFrame($event)"
          @hide="editor.hideFrame(frame.device.id)"
        />
        <iframe
          :ref="frameRef(frame.key)"
          :src="canvasSrc"
          :title="frameTitle(frame)"
          :data-device="frame.variant ? undefined : frame.device.id"
          :data-board-variant="frame.variant?.key"
          class="block size-full bg-white"
          :style="linking && frame.variant && linking.target === frame.variant.key
            ? { outline: `${2 / viewport.zoom}px dashed var(--editor-context)`, outlineOffset: `${4 / viewport.zoom}px` }
            : frame.key === activeKey ? { outline: `${2 / viewport.zoom}px solid var(--editor-context)` } : undefined"
        />
        <!-- The ⚡ handle: drag it to another variant to add an interaction. -->
        <button
          v-if="frame.variant"
          type="button"
          class="absolute z-[1] grid size-6 cursor-crosshair place-items-center rounded-full bg-(--editor-context) text-white shadow-md ring-2 ring-white/80 hover:brightness-110"
          :class="FOCUS_RING"
          :style="{ left: `${frame.rect.width}px`, top: `${handlePoint(frame.rect).y - frame.rect.y}px`, transform: `translate(-50%, -50%) scale(${1 / viewport.zoom})` }"
          :aria-label="`Add an interaction from ${frame.variant.label}: drag to another variant`"
          title="Drag to another variant to add an interaction"
          :data-board-handle="frame.variant.key"
          @pointerdown="startLink($event, frame)"
        >
          <UIcon
            name="i-lucide-zap"
            class="size-3.5"
          />
        </button>
        <!-- The layout's children slot: where each page's own content goes. -->
        <div
          v-if="slotBoxes[frame.key]"
          class="pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-md border-dashed border-(--editor-component) p-2 text-center"
          :style="{
            left: `${slotBoxes[frame.key]!.x}px`,
            top: `${slotBoxes[frame.key]!.y}px`,
            width: `${slotBoxes[frame.key]!.width}px`,
            height: `${slotBoxes[frame.key]!.height}px`,
            borderWidth: `${1.5 / viewport.zoom}px`,
            borderStyle: editor.selectedIds.includes(slotNodeId!) ? 'solid' : 'dashed',
            background: 'color-mix(in srgb, var(--editor-component) 12%, white)'
          }"
          data-layout-placeholder
        >
          <span class="flex items-center gap-1.5 text-[13px] font-medium text-(--editor-component)">
            <UIcon
              name="i-lucide-layout-template"
              class="size-4 shrink-0"
            />
            Page content — your page appears here
          </span>
        </div>
      </div>
      <!-- The board's dashed "+ Variant" tile, after the last variant. -->
      <button
        v-if="placement.add"
        type="button"
        class="absolute flex items-center justify-center rounded-xl border-dashed border-(--editor-context)/50 text-(--editor-context) hover:border-(--editor-context) hover:bg-(--editor-context)/8"
        :class="FOCUS_RING"
        :style="{ left: `${placement.add.x}px`, top: `${placement.add.y}px`, width: `${placement.add.width}px`, height: `${placement.add.height}px`, borderWidth: `${1.5 / viewport.zoom}px` }"
        aria-label="Add variant"
        title="Add a variant, starting like the primary"
        data-board-add
        @click="editor.addVariant()"
      >
        <span
          class="flex items-center gap-1.5 text-[13px] font-[550] whitespace-nowrap"
          :style="{ transform: `scale(${1 / viewport.zoom})` }"
        >
          <UIcon
            name="i-lucide-plus"
            class="size-4"
          />
          Variant
        </span>
      </button>
      <!-- A dashed "+ Hover / Pressed" tile under each base variant's column while it lacks one. -->
      <EditorMenu
        v-for="tile in boardPlaced?.stateAdds ?? []"
        :key="`state-${tile.base}`"
        :items="stateMenu(tile)"
      >
        <button
          type="button"
          class="absolute flex items-center justify-center rounded-xl border-dashed border-(--editor-context)/50 text-(--editor-context) hover:border-(--editor-context) hover:bg-(--editor-context)/8 aria-expanded:border-(--editor-context)"
          :class="FOCUS_RING"
          :style="{ left: `${tile.rect.x}px`, top: `${tile.rect.y}px`, width: `${tile.rect.width}px`, height: `${tile.rect.height}px`, borderWidth: `${1.5 / viewport.zoom}px` }"
          aria-label="Add a hover or pressed state"
          title="Add a state that shows while the pointer is over or pressing an instance"
          :data-board-state-add="tile.base"
        >
          <span
            class="flex items-center gap-1.5 text-[13px] font-[550] whitespace-nowrap"
            :style="{ transform: `scale(${1 / viewport.zoom})` }"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4"
            />
            Hover / Pressed
          </span>
        </button>
      </EditorMenu>
      <!-- The interactions, as curved purple arrows; the drag in progress as a dashed line. -->
      <svg
        v-if="board"
        class="pointer-events-none absolute top-0 left-0 overflow-visible"
        width="1"
        height="1"
        data-board-arrows
      >
        <g
          v-for="arrow in arrows"
          :key="arrow.id"
          class="cursor-pointer text-(--editor-context)"
          :data-interaction-arrow="arrow.id"
          :data-selected="arrow.id === editor.interactionId || undefined"
          @click="selectArrow(arrow.id)"
        >
          <path
            :d="arrow.d"
            fill="none"
            stroke="transparent"
            :stroke-width="14 / viewport.zoom"
            style="pointer-events: stroke"
          />
          <path
            :d="arrow.d"
            fill="none"
            stroke="currentColor"
            :stroke-width="(arrow.id === editor.interactionId ? 3 : 1.5) / viewport.zoom"
            stroke-linecap="round"
          />
          <polygon
            :points="arrow.head"
            fill="currentColor"
            style="pointer-events: fill"
          />
        </g>
        <line
          v-if="linking"
          :x1="linking.start.x"
          :y1="linking.start.y"
          :x2="linking.at.x"
          :y2="linking.at.y"
          stroke="var(--editor-context)"
          :stroke-width="2 / viewport.zoom"
          :stroke-dasharray="`${6 / viewport.zoom} ${4 / viewport.zoom}`"
          data-board-linking
        />
      </svg>
      <!-- Each arrow's event, at its middle: a larger target to select it. -->
      <button
        v-for="arrow in arrows"
        :key="`label-${arrow.id}`"
        type="button"
        class="absolute h-5 rounded-full px-2 text-[11px] leading-5 font-[550] whitespace-nowrap"
        :class="[FOCUS_RING, arrow.id === editor.interactionId ? 'bg-(--editor-context) text-white' : 'bg-(--editor-context)/15 text-(--editor-context) hover:bg-(--editor-context)/25']"
        :style="{ left: `${arrow.mid.x}px`, top: `${arrow.mid.y}px`, transform: `translate(-50%, -50%) scale(${1 / viewport.zoom})` }"
        :aria-label="`${arrow.label} interaction: edit`"
        :aria-pressed="arrow.id === editor.interactionId"
        :data-interaction-label="arrow.id"
        @click="selectArrow(arrow.id)"
      >
        {{ arrow.label }}
      </button>
      <EditorPopover
        v-if="board"
        v-model:open="arrowPopover"
        title="Interaction"
        :content="{ side: 'right', align: 'start' }"
        data-interaction-popover
      >
        <template #anchor>
          <div
            class="pointer-events-none absolute size-px"
            :style="{ left: `${selectedArrow?.mid.x ?? 0}px`, top: `${selectedArrow?.mid.y ?? 0}px` }"
          />
        </template>
        <EditorInteractionFields
          v-if="editor.interactionId && selectedArrow"
          :interaction-id="editor.interactionId"
          @removed="arrowPopover = false"
        />
      </EditorPopover>
    </div>
    <div
      v-if="panMode || panning"
      class="absolute inset-0 z-10"
      :class="panning ? 'cursor-grabbing' : 'cursor-grab'"
      data-pan-layer
    />
    <!-- Raised above the bottom edge, clear of the Nuxt DevTools pill in dev. -->
    <EditorFloatingBar
      :zoom="viewport.zoom"
      :zoom-items="zoomItems"
      class="absolute bottom-14 left-1/2 z-20 -translate-x-1/2"
    />
  </div>
</template>
