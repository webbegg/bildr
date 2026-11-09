<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CanvasToEditor, CanvasView, EditorToCanvas } from '#shared/editor/protocol'
import { isCanvasMessage } from '#shared/editor/protocol'
import { createThrottle, PREVIEW_INTERVAL } from '#shared/editor/preview'
import type { PreviewState } from '#shared/editor/preview'
import type { NodeBox } from '#shared/editor/autoLayout'
import type { DeviceId } from '#shared/editor/styleFields'
import { DEVICES } from '#shared/editor/styleFields'
import type { Point, Viewport, ZoomCommand } from '#shared/editor/viewport'
import { isInsertTool, pointerMode } from '#shared/editor/insertTools'
import { boundsOf, fitView, FRAME_BAR_HEIGHT, FRAME_GAP, FRAME_MIN_HEIGHT, frameOrder, layoutFrames, panView, stepZoom, wheelPixels, wheelZoom, zoomAround, zoomShortcut } from '#shared/editor/viewport'

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
 */
const { view = 'page' } = defineProps<{ view?: CanvasView }>()
const editor = useEditor()
const emit = defineEmits<{ key: [message: Extract<CanvasToEditor, { type: 'bildr:key' }>] }>()
const stage = useTemplateRef<HTMLDivElement>('stage')
const tokenFrame = useTemplateRef<HTMLIFrameElement>('tokenFrame')

/** The mounted frame iframes by device; null keys the token preview. */
const frames = new Map<DeviceId | null, HTMLIFrameElement>()
function frameRef(id: DeviceId) {
  return (el: unknown) => {
    if (el) frames.set(id, el as HTMLIFrameElement)
    else frames.delete(id)
  }
}

const FRAMES_KEY = 'bildr:canvas-frames'
/** All frames, or only the active one (small screens, performance); remembered across reloads. */
const singleFrame = ref(view === 'page' && localStorage.getItem(FRAMES_KEY) === 'single')
const heights = reactive<Partial<Record<DeviceId, number>>>({})
const shownDevices = computed(() => (singleFrame.value ? [editor.device] : frameOrder(DEVICES)))
const layout = computed(() => {
  const rects = layoutFrames(shownDevices.value.map(d => ({ width: d.width, height: Math.max(FRAME_MIN_HEIGHT, heights[d.id] ?? 0) })), FRAME_GAP)
  return shownDevices.value.map((device, i) => ({ device, rect: rects[i]! }))
})

const viewport = ref<Viewport>({ x: 0, y: 0, zoom: 1 })
const stageSize = reactive({ width: 0, height: 0 })
const observer = import.meta.client
  ? new ResizeObserver(([entry]) => Object.assign(stageSize, { width: entry!.contentRect.width, height: entry!.contentRect.height }))
  : null
/** Room around fitted content, in screen px; the frame header bars sit in it. */
const FIT_PADDING = 48 + FRAME_BAR_HEIGHT
/** Until the user zooms or pans, the view keeps fitting the frames as they load and grow. */
let autoFit = true

function fit() {
  viewport.value = fitView(boundsOf(layout.value.map(f => f.rect)), stageSize, FIT_PADDING)
}

watch([layout, () => stageSize.width, () => stageSize.height], () => {
  if (autoFit && stageSize.width) fit()
})

function zoomTo(zoom: number, at: Point = { x: stageSize.width / 2, y: stageSize.height / 2 }) {
  autoFit = false
  viewport.value = zoomAround(viewport.value, zoom, at)
}

function zoomCommand(command: ZoomCommand) {
  autoFit = false
  if (command === 'fit') fit()
  else if (command === 'reset') zoomTo(1)
  else zoomTo(stepZoom(viewport.value.zoom, command === 'in' ? 1 : -1))
}

// Zooms asked for elsewhere, e.g. from the quick actions.
watch(() => editor.zoomRequest, (request) => {
  if (request && view === 'page') zoomCommand(request.command)
})

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
    { label: 'Zoom to 50%', onSelect: () => zoomTo(0.5) },
    { label: 'Zoom to 100%', kbds: ['shift', '0'], onSelect: () => zoomTo(1) },
    { label: 'Zoom to 200%', onSelect: () => zoomTo(2) }
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

function activate(id: DeviceId | null) {
  if (id) editor.deviceId = id
}

function frameTitle(id: DeviceId, label: string): string {
  // The active frame keeps the plain "Canvas" title the e2e scripts and assistive tech look for.
  return id === editor.deviceId ? 'Canvas' : `Canvas ${label}`
}

function post(el: HTMLIFrameElement, message: EditorToCanvas) {
  // The document lives in reactive proxies, which postMessage cannot clone.
  el.contentWindow?.postMessage(JSON.parse(JSON.stringify(message)), window.location.origin)
}

function broadcast(message: EditorToCanvas) {
  for (const el of frames.values()) post(el, message)
}

function renderMessage(): EditorToCanvas | null {
  if (!editor.page || !editor.project || !editor.theme) return null
  return { type: 'bildr:render', page: editor.page, base: `/p/${editor.project.slug}`, theme: editor.theme, view, lists: editor.lists }
}

function selectMessage(): EditorToCanvas {
  return { type: 'bildr:select', nodeId: editor.selectedId, nodeIds: editor.selectedIds }
}

function toolMessage(): EditorToCanvas {
  return { type: 'bildr:tool', tool: view === 'page' && isInsertTool(editor.tool) ? editor.tool : null }
}

function render() {
  const message = renderMessage()
  if (!message) return
  broadcast(message)
  broadcast(selectMessage())
}

/** Brings a frame that just loaded up to date with the others. */
function sync(id: DeviceId | null, el: HTMLIFrameElement) {
  const message = renderMessage()
  if (!message) return
  post(el, message)
  post(el, selectMessage())
  post(el, { type: 'bildr:hover', nodeId: editor.hoveredId })
  post(el, toolMessage())
  post(el, { type: 'bildr:dark', dark: editor.previewDark })
  if (id) post(el, { type: 'bildr:active', active: id === editor.deviceId, zoom: viewport.value.zoom })
  const preview = editor.stylePreview
  if (preview) for (const nodeId of previewTargets(preview)) post(el, { type: 'bildr:preview', nodeId, style: preview.style })
}

/** Pending `bildr:measure` requests by id; a frame that never answers resolves with no boxes. */
const measures = new Map<number, (rects: NodeBox[]) => void>()
let measureId = 0

/** The boxes of nodes in the active frame, in its canvas pixels. */
function measureNodes(nodeIds: string[]): Promise<NodeBox[]> {
  const el = frames.get(editor.deviceId)
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
  const [id, el] = [...frames].find(([, frame]) => frame.contentWindow === event.source) ?? []
  if (!el || !isCanvasMessage<CanvasToEditor>(event.data)) return
  const message = event.data
  if (message.type === 'bildr:ready') sync(id ?? null, el)
  else if (message.type === 'bildr:hover') editor.hoveredId = message.nodeId
  else if (message.type === 'bildr:click') {
    editor.canvasClick(message.nodeId, message)
    activate(id ?? null)
  } else if (message.type === 'bildr:insert') {
    activate(id ?? null)
    editor.insertWithTool({ parentId: message.parentId, index: message.index })
  } else if (message.type === 'bildr:rects') measures.get(message.requestId)?.(message.rects)
  else if (message.type === 'bildr:key') {
    const command = view === 'page' ? zoomShortcut(message) : null
    if (command) zoomCommand(command)
    else emit('key', message)
  } else if (message.type === 'bildr:contextmenu') {
    activate(id ?? null)
    openNodeMenu(el, message)
  } else if (message.type === 'bildr:drop') {
    activate(id ?? null)
    editor.drop(message.payload, { parentId: message.parentId, index: message.index })
  } else if (id && message.type === 'bildr:size') heights[id] = message.height
  else if (id && message.type === 'bildr:wheel') onFrameWheel(el, message)
  else if (id && message.type === 'bildr:pan') panBy(message.dx, message.dy)
  else if (id && message.type === 'bildr:space') spaceHeld.value = message.down
}

watch(() => [editor.page, editor.theme, editor.lists], render, { deep: true })
watch(() => editor.selectedIds, () => broadcast(selectMessage()))
watch(() => editor.hoveredId, nodeId => broadcast({ type: 'bildr:hover', nodeId }))
watch(() => editor.tool, () => broadcast(toolMessage()))
watch(() => editor.previewDark, dark => broadcast({ type: 'bildr:dark', dark }))
watch([() => editor.deviceId, () => viewport.value.zoom], ([deviceId, zoom]) => {
  for (const [id, el] of frames) if (id) post(el, { type: 'bildr:active', active: id === deviceId, zoom })
})

type PreviewMessage = Extract<EditorToCanvas, { type: 'bildr:preview' }>
const previewTargets = (state: PreviewState) => state.nodeIds ?? [state.nodeId]
// Style previews move with a drag, so they are throttled (one batch per selection); a clear goes at once and drops any pending one.
const previews = createThrottle<PreviewMessage[]>(batch => batch.forEach(broadcast), PREVIEW_INTERVAL)
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
})
</script>

<template>
  <iframe
    v-if="view === 'tokens'"
    ref="tokenFrame"
    src="/canvas"
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
      <div
        v-for="{ device, rect } in layout"
        :key="device.id"
        class="absolute"
        :style="{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
        :data-frame="device.id"
        :data-active="device.id === editor.deviceId || undefined"
      >
        <!-- The header bar and the active outline keep their screen size at any zoom. -->
        <EditorFrameBar
          :device="device"
          :zoom="viewport.zoom"
          :active="device.id === editor.deviceId"
          @activate="activate(device.id)"
          @preview="editor.openPreview(device.width)"
        />
        <iframe
          :ref="frameRef(device.id)"
          src="/canvas"
          :title="frameTitle(device.id, device.label)"
          :data-device="device.id"
          class="block size-full bg-white"
          :style="device.id === editor.deviceId ? { outline: `${2 / viewport.zoom}px solid var(--editor-selection)` } : undefined"
        />
      </div>
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
