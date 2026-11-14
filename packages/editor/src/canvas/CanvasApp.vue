<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useTemplateRef } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { resolveThemeColors, themeCss } from '@bildr/codegen/design'
import type { Breakpoint, BreakpointBase } from '@bildr/codegen/design'
import type { ComponentFile, ModelNode as TreeNode, Value } from '@bildr/codegen/model'
import type { NodeBox } from '@bildr/editor-core/autoLayout'
import { editorTakesKey, hasTextSelection } from '@bildr/editor-core/clipboardKeys'
import { gapRects, paddingRects } from '@bildr/editor-core/handles'
import { labelPlacement } from '@bildr/editor-core/labelPlacement'
import { measure as measureLines } from '@bildr/editor-core/measure'
import type { MeasureLine } from '@bildr/editor-core/measure'
import { applyStylePreview, showsPatch } from '@bildr/editor-core/preview'
import type { StylePatch } from '@bildr/editor-core/preview'
import { FRAME_MIN_HEIGHT, viewportUnitRules, wheelPixels, zoomShortcut } from '@bildr/editor-core/viewport'
import ModelNode from './ModelNode.vue'
import { dropTarget, nearestUnlocked } from './drop.ts'
import type { Box, DropSlot } from './drop.ts'
import { canvasKeyMessage, isCanvasMessage } from './protocol.ts'
import type { CanvasMode, CanvasToEditor, EditorToCanvas, RenderMessage, SpacingOverlay } from './protocol.ts'
import { pageNodeId, renderPlan } from './render.ts'
import type { CanvasFile, PlanChild, PlanElement } from './render.ts'

/**
 * The canvas (P4a): the editor frames it at `/__bildr/canvas` and drives it
 * with postMessage (`protocol.ts`), as the hosted `pages/canvas.vue` did. It
 * renders the `.bildr` file of `bildr:render` with its data through the
 * render plan (`render.ts`, the generator's rules) and `ModelNode.vue`, and
 * draws no editor chrome beyond its overlays: hover and selection outlines
 * (a single selection's parent dashed, the primary one labelled in the
 * active frame), Alt measurements to the hovered element, the padding and
 * gap overlays a hovered panel field asks for, and the drop indicator.
 *
 * Elements map to nodes through `data-node`. Gestures report the node of the
 * file being edited (`pageNodeId`: an instance for its parts, the page root
 * for its layout's), or its nearest unlocked ancestor; List copies report
 * the node they repeat, and outlines, rects and drops use the first copy.
 * In edit mode a click selects and nothing in the page runs (links don't
 * navigate, buttons don't act). In preview mode (`bildr:mode`) interactions
 * run: component variants and toasts here; navigate, runAction and setState
 * steps are reported (`bildr:interaction`). Style previews from the editor
 * show over the file until it clears them or a render shows their values.
 * Not yet ported: handle drags (resize, padding and gap), drag-to-reorder
 * from the canvas, the insert slot math of armed tools (a click inserts at
 * the drop slot under the pointer) and the token sheet view (P4c).
 */

const SELECTION_ACCENT = '#09f'
const ACCENT_VAR = '--canvas-accent'
const VIEWPORT_VAR = '--canvas-vh'
const DRAG_MIME = 'application/x-bildr'

const render = shallowRef<RenderMessage | null>(null)
const mode = ref<CanvasMode>('edit')
/** Preview mode: the variant each interactive instance shows, by its root's `data-node` id. */
const shown = reactive<Record<string, string>>({})
const selectedId = ref<string | null>(null)
const selectedIds = ref<string[]>([])
/** The node under the pointer here, or the one the editor's layers hover. */
const hoveredId = ref<string | null>(null)
const accent = ref(SELECTION_ACCENT)
const active = ref(true)
const zoom = ref(1)
const viewportHeight = ref(FRAME_MIN_HEIGHT)
const alt = ref(false)
const tool = ref<string | null>(null)
const panelOverlay = ref<SpacingOverlay | null>(null)
/** Uncommitted style patches by node id. */
const previews = shallowRef<Record<string, StylePatch>>({})
const root = useTemplateRef<HTMLDivElement>('root')
const toast = useToast()

const withPreviews = (node: TreeNode, patches: Record<string, StylePatch>): TreeNode => {
  const patch = patches[node.id]
  const children = node.children?.map(child => withPreviews(child, patches))
  const changed = children?.some((child, i) => child !== node.children![i])
  if (!patch && !changed) return node
  return { ...node, ...(patch ? { style: applyStylePreview(node.style ?? {}, patch) } : {}), ...(children ? { children } : {}) }
}

const file = computed<CanvasFile | null>(() => {
  const current = render.value?.file
  if (!current) return null
  const tree = withPreviews(current.root, previews.value)
  return tree === current.root ? current : { ...current, root: tree } as CanvasFile
})

const plan = computed<PlanElement[]>(() => {
  const message = render.value
  if (!message || !file.value || message.view !== 'page') return []
  return renderPlan({ file: file.value, components: message.components, layouts: message.layouts, data: message.data, variant: message.variant ?? null, shown: { ...shown } })
})

/** The first (non-copy) plan element of each node id, for interactions and labels. */
const elements = computed(() => {
  const map = new Map<string, PlanElement>()
  const visit = (children: PlanChild[]) => {
    for (const child of children) {
      if (typeof child === 'string') continue
      if (child.node && !child.copy && !map.has(child.node)) map.set(child.node, child)
      visit(child.children)
    }
  }
  visit(plan.value)
  return map
})

// ── Theme and viewport ─────────────────────────────────────────────────

const headStyle = (id: string, css: string) => {
  let style = document.getElementById(id)
  if (!style) {
    style = document.createElement('style')
    style.id = id
    document.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
}

const BREAKPOINT_WIDTHS: Array<[Breakpoint, number]> = [['sm', 640], ['md', 768], ['lg', 1024]]
const MAX_WIDTHS: Array<[Breakpoint, number]> = [['max-sm', 640], ['max-md', 768], ['max-lg', 1024]]
/** The breakpoint this frame renders at (its width is the device's). */
const frameBreakpoint = (base: BreakpointBase = render.value?.breakpointBase ?? 'mobile'): Breakpoint | undefined => base === 'desktop'
  ? MAX_WIDTHS.find(([, below]) => window.innerWidth < below)?.[0]
  : BREAKPOINT_WIDTHS.filter(([, min]) => window.innerWidth >= min).at(-1)?.[0]

/** `screen` heights resolve to the device's nominal viewport height, not the frame's (as tall as its content). */
const applyViewportRules = () => headStyle('bildr-canvas-viewport', viewportUnitRules(frameBreakpoint(), '[data-canvas-viewport]', VIEWPORT_VAR).join('\n'))

// ── Messages ───────────────────────────────────────────────────────────

function post(message: CanvasToEditor) {
  window.parent.postMessage(message, window.location.origin)
}

const nodeOf = (target: EventTarget | null): Element | null => (target as Element | null)?.closest?.('[data-node]') ?? null
/** The node of the edited file a gesture on `target` reaches. */
function reachableAt(target: EventTarget | null): string | null {
  const id = nodeOf(target)?.getAttribute('data-node')
  const tree = file.value?.root
  if (!id || !tree) return null
  return nearestUnlocked(tree, pageNodeId(id))
}

const firstCopy = (id: string) => document.querySelector(`[data-node="${CSS.escape(id)}"]:not([data-copy])`)

interface Outline { id: string, top: number, left: number, width: number, height: number, label: string }

const findNode = (node: TreeNode, id: string): TreeNode | undefined => node.id === id ? node : node.children?.map(child => findNode(child, id)).find(Boolean)
const findParent = (node: TreeNode, id: string): TreeNode | undefined =>
  node.children?.some(child => child.id === id) ? node : node.children?.map(child => findParent(child, id)).find(Boolean)

function labelOf(id: string): string {
  const element = elements.value.get(id)
  const node = file.value ? findNode(file.value.root, id) : undefined
  if (node?.type === 'Instance') return node.name ?? render.value?.components.find(entry => entry.id === node.props?.component)?.name ?? 'Instance'
  return node?.name ?? element?.type ?? node?.type ?? ''
}

function outline(id: string | null): Outline | null {
  const el = id ? firstCopy(id) : null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { id: id!, top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height, label: labelOf(id!) }
}

const toRect = (box: { top: number, left: number, width: number, height: number }) => ({ x: box.left, y: box.top, width: box.width, height: box.height })

function nodeBoxes(ids: string[]): NodeBox[] {
  return ids.map(outline).filter((box): box is Outline => !!box && (box.width > 0 || box.height > 0)).map(box => ({ id: box.id, ...toRect(box) }))
}

const settlePreviews = (current: Record<string, StylePatch>, tree: TreeNode) => {
  const kept = Object.entries(current).filter(([id, patch]) => {
    const node = findNode(tree, id)
    return node ? !showsPatch(node.style ?? {}, patch) : false
  })
  return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept)
}

function onMessage(event: MessageEvent) {
  if (event.source !== window.parent || !isCanvasMessage<EditorToCanvas>(event.data)) return
  const message = event.data
  if (message.type === 'bildr:render') {
    const base = render.value?.breakpointBase
    render.value = message
    if (Object.keys(previews.value).length) previews.value = settlePreviews(previews.value, message.file.root)
    headStyle('bildr-canvas-theme', themeCss(resolveThemeColors(message.theme, {})))
    if (message.breakpointBase !== base) applyViewportRules()
  } else if (message.type === 'bildr:mode') {
    mode.value = message.mode
    for (const key of Object.keys(shown)) Reflect.deleteProperty(shown, key)
  } else if (message.type === 'bildr:select') {
    selectedId.value = message.nodeId
    selectedIds.value = message.nodeIds
    accent.value = message.accent ?? SELECTION_ACCENT
  } else if (message.type === 'bildr:hover') {
    hoveredId.value = message.nodeId
  } else if (message.type === 'bildr:measure') {
    post({ type: 'bildr:rects', requestId: message.requestId, rects: nodeBoxes(message.nodeIds) })
  } else if (message.type === 'bildr:alt') {
    alt.value = message.down
  } else if (message.type === 'bildr:tool') {
    tool.value = message.tool
    indicator.value = null
  } else if (message.type === 'bildr:dark') {
    document.documentElement.classList.toggle('dark', message.dark)
    document.documentElement.classList.toggle('light', !message.dark)
  } else if (message.type === 'bildr:active') {
    active.value = message.active
    zoom.value = message.zoom
    viewportHeight.value = message.viewportHeight
    applyViewportRules()
  } else if (message.type === 'bildr:overlay') {
    panelOverlay.value = message.overlay
  } else if (message.type === 'bildr:preview') {
    const { [message.nodeId]: _, ...others } = previews.value
    previews.value = message.style ? { ...others, [message.nodeId]: message.style } : others
  }
}

// ── Outlines and overlays, measured every frame ─────────────────────────

const boxes = reactive<{ hover: Outline | null, selected: Outline[], parent: Outline | null }>({ hover: null, selected: [], parent: null })
const parentId = computed(() => {
  const tree = file.value?.root
  const id = selectedIds.value.length === 1 ? selectedIds.value[0] : undefined
  return tree && id ? findParent(tree, id)?.id ?? null : null
})

interface Spacing { padding: Array<Box & { side: string }>, gaps: Box[] }
const spacing = shallowRef<Spacing | null>(null)

function measureSpacing(id: string, box: Outline): Spacing | null {
  const el = firstCopy(id)
  if (!el) return null
  const px = (value: string) => Number.parseFloat(value) || 0
  const css = getComputedStyle(el)
  const border = { top: px(css.borderTopWidth), right: px(css.borderRightWidth), bottom: px(css.borderBottomWidth), left: px(css.borderLeftWidth) }
  const rect = { x: box.left + border.left, y: box.top + border.top, width: box.width - border.left - border.right, height: box.height - border.top - border.bottom }
  const insets = { top: px(css.paddingTop), right: px(css.paddingRight), bottom: px(css.paddingBottom), left: px(css.paddingLeft) }
  const flex = css.display.includes('flex')
  const axis = css.flexDirection.startsWith('column') ? 'col' : 'row'
  const children = flex
    ? [...el.children].filter(child => getComputedStyle(child).display !== 'none').map((child) => {
        const r = child.getBoundingClientRect()
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
      })
    : []
  const content = { x: rect.x + insets.left, y: rect.y + insets.top, width: rect.width - insets.left - insets.right, height: rect.height - insets.top - insets.bottom }
  return {
    padding: panelOverlay.value === 'padding' ? paddingRects(rect, insets).filter(area => area.width > 0 && area.height > 0) : [],
    gaps: panelOverlay.value === 'gap' && flex ? gapRects(content, children, axis).filter(gap => gap.width > 0 && gap.height > 0) : []
  }
}

let frame = 0
function track() {
  boxes.hover = hoveredId.value && !selectedIds.value.includes(hoveredId.value) ? outline(hoveredId.value) : null
  boxes.selected = selectedIds.value.map(outline).filter((box): box is Outline => !!box)
  boxes.parent = active.value && parentId.value ? outline(parentId.value) : null
  const one = selectedIds.value.length === 1 ? boxes.selected[0] : undefined
  spacing.value = panelOverlay.value && one && active.value ? measureSpacing(one.id, one) : null
  frame = requestAnimationFrame(track)
}

const LABEL_PX = 16
const labelInside = (box: Outline) => labelPlacement(box.top, LABEL_PX / zoom.value) === 'inside'
const measurement = computed(() => {
  const target = boxes.hover
  if (!alt.value || !active.value || !target || !boxes.selected.length) return null
  const rects = boxes.selected.map(toRect)
  const x = Math.min(...rects.map(r => r.x))
  const y = Math.min(...rects.map(r => r.y))
  const from = { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y }
  return measureLines(from, toRect(target))
})
const rectStyle = (rect: Box) => ({ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` })
const boxStyle = (box: Outline) => ({ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, outlineWidth: `${1 / zoom.value}px`, outlineOffset: `${-1 / zoom.value}px` })
const hatch = () => ({
  backgroundColor: `color-mix(in srgb, var(${ACCENT_VAR}) 10%, transparent)`,
  backgroundImage: `repeating-linear-gradient(-45deg, color-mix(in srgb, var(${ACCENT_VAR}) 45%, transparent) 0 ${1 / zoom.value}px, transparent ${1 / zoom.value}px ${5 / zoom.value}px)`
})
const lineStyle = (line: MeasureLine) => line.y1 === line.y2
  ? { left: `${line.x1}px`, top: `${line.y1 - 0.5 / zoom.value}px`, width: `${line.length}px`, height: `${1 / zoom.value}px` }
  : { left: `${line.x1 - 0.5 / zoom.value}px`, top: `${line.y1}px`, width: `${1 / zoom.value}px`, height: `${line.length}px` }

// ── Drops and inserts ───────────────────────────────────────────────────

interface Indicator { top: number, left: number, width: number, height: number, line: boolean }
const indicator = ref<Indicator | null>(null)

const rectOf = (id: string): Box | null => {
  const r = firstCopy(id)?.getBoundingClientRect()
  return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null
}
const isRow = (id: string) => {
  const el = firstCopy(id)
  if (!el) return false
  const css = getComputedStyle(el)
  return css.display.includes('grid') || (css.display.includes('flex') && css.flexDirection.startsWith('row'))
}

/** The drop slot at a viewport point over `target`, and where to draw it. */
function slotAt(target: EventTarget | null, point: { x: number, y: number }, draggedId?: string): { slot: DropSlot, indicator: Indicator } | null {
  const tree = file.value?.root
  const el = nodeOf(target)
  if (!tree || !el || el.closest('[data-copy]')) return null
  const slot = dropTarget(tree, pageNodeId(el.getAttribute('data-node')!), point, rectOf, isRow, draggedId)
  const mark = slot ? rectOf(slot.markId) : null
  if (!slot || !mark) return null
  const box = { top: mark.y + window.scrollY, left: mark.x + window.scrollX, width: mark.width, height: mark.height }
  if (slot.position === 'inside') return { slot, indicator: { ...box, line: false } }
  const end = slot.position === 'after'
  return {
    slot,
    indicator: slot.horizontal
      ? { top: box.top, left: box.left + (end ? box.width : 0) - 1, width: 2, height: box.height, line: true }
      : { top: box.top + (end ? box.height : 0) - 1, left: box.left, width: box.width, height: 2, line: true }
  }
}

const NODE_DRAG_PREFIX = `${DRAG_MIME}-node;`
const draggedNodeId = (types: readonly string[]) => types.find(type => type.startsWith(NODE_DRAG_PREFIX))?.slice(NODE_DRAG_PREFIX.length)

function dropAt(event: DragEvent) {
  const types = [...(event.dataTransfer?.types ?? [])]
  if (!types.includes(DRAG_MIME)) return null
  return slotAt(event.target, { x: event.clientX, y: event.clientY }, draggedNodeId(types))
}

function onDragOver(event: DragEvent) {
  const drop = dropAt(event)
  indicator.value = drop?.indicator ?? null
  if (!drop) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = draggedNodeId([...event.dataTransfer!.types]) ? 'move' : 'copy'
}

function onDrop(event: DragEvent) {
  const drop = dropAt(event)
  indicator.value = null
  if (!drop) return
  event.preventDefault()
  post({ type: 'bildr:drop', parentId: drop.slot.parentId, index: drop.slot.index, payload: event.dataTransfer!.getData(DRAG_MIME) })
}

const clearIndicator = () => {
  indicator.value = null
}
const onDragLeave = (event: DragEvent) => {
  if (!event.relatedTarget) clearIndicator()
}

// ── Preview: interactions ───────────────────────────────────────────────

type Step = Record<string, Value>

/** Runs a node's steps for `on`: toasts here, everything else reported to the editor. */
function runSteps(nodeId: string, on: string, steps: Step[]) {
  for (const step of steps) {
    if (step.kind === 'toast') toast.add({ title: String(step.title ?? ''), ...(typeof step.description === 'string' ? { description: step.description } : {}), ...(typeof step.color === 'string' ? { color: step.color as 'primary' } : {}), ...(typeof step.icon === 'string' ? { icon: step.icon } : {}) })
    else post({ type: 'bildr:interaction', nodeId, on, step })
  }
}

const variantName = (component: ComponentFile, id: string) => id === '' ? 'default' : component.variants.find(variant => variant.id === id)?.name ?? 'default'
const timers = new Set<ReturnType<typeof setTimeout>>()

/** Switches an interactive instance's variant for `on` (its current variant's interactions), after their delay. */
function runVariant(root: PlanElement, on: string): boolean {
  const info = root.variantRoot!
  const current = shown[info.key] ?? info.variant
  const owner = current === 'default' ? info.component.interactions : info.component.variants.find(variant => variant.name === current)?.interactions
  const interaction = owner?.find(entry => entry.on === on)
  if (!interaction) return false
  const { to, delay } = interaction.do[0]
  const apply = () => {
    shown[info.key] = variantName(info.component, to)
  }
  if (delay) {
    const timer = setTimeout(() => {
      timers.delete(timer)
      apply()
    }, delay * 1000)
    timers.add(timer)
  } else {
    apply()
  }
  return true
}

/**
 * The hover or pressed state an instance shows over its base variant. Shown
 * as that variant here even where the app uses CSS (`hover:` classes): the
 * canvas stylesheet has every token class, not their state variants.
 */
function pointerState(root: PlanElement, kind: 'hover' | 'pressed' | null) {
  const info = root.variantRoot!
  const base = info.variant
  const baseId = base === 'default' ? '' : info.component.variants.find(variant => variant.name === base)?.id ?? ''
  const state = kind ? info.component.variants.find(variant => variant.state?.of === baseId && variant.state.kind === kind) : undefined
  if (state) shown[info.key] = state.name
  else if (!kind) Reflect.deleteProperty(shown, info.key)
}

/** The plan elements from `target` up to the document, nearest first. */
function planChain(target: EventTarget | null): PlanElement[] {
  const chain: PlanElement[] = []
  for (let el = nodeOf(target); el; el = nodeOf(el.parentElement)) {
    const element = elements.value.get(el.getAttribute('data-node')!)
    if (element) chain.push(element)
  }
  return chain
}

/** A preview event: the nearest node with an interaction for it runs it, and the nearest interactive instance switches variant. */
function preview(event: Event, on: string) {
  const chain = planChain(event.target)
  const own = chain.find(element => element.interactions?.some(interaction => interaction.on === on))
  if (own) {
    for (const interaction of own.interactions!.filter(entry => entry.on === on)) runSteps(pageNodeId(own.node!), on, interaction.do as Step[])
  }
  for (const element of chain) {
    if (element.variantRoot && runVariant(element, on)) break
  }
}

let hoveredRoots: PlanElement[] = []
function previewPointer(event: MouseEvent) {
  const roots = planChain(event.target).filter(element => element.variantRoot)
  for (const left of hoveredRoots.filter(element => !roots.includes(element))) {
    pointerState(left, null)
    runVariant(left, 'mouseleave')
  }
  for (const entered of roots.filter(element => !hoveredRoots.includes(element))) {
    pointerState(entered, 'hover')
    runVariant(entered, 'mouseenter')
  }
  hoveredRoots = roots
}

// ── Pointer and keys ────────────────────────────────────────────────────

function onPointerMove(event: MouseEvent) {
  alt.value = event.altKey
  if (mode.value === 'preview') return previewPointer(event)
  if (tool.value) indicator.value = slotAt(event.target, { x: event.clientX, y: event.clientY })?.indicator ?? null
  const id = reachableAt(event.target)
  if (id === hoveredId.value) return
  hoveredId.value = id
  post({ type: 'bildr:hover', nodeId: id })
}

function onPointerLeave() {
  if (tool.value) indicator.value = null
  if (mode.value === 'preview') {
    for (const left of hoveredRoots) pointerState(left, null)
    hoveredRoots = []
    return
  }
  hoveredId.value = null
  post({ type: 'bildr:hover', nodeId: null })
}

const variantField = () => (render.value?.variant ? { variantId: render.value.variant.id } : {})

function onClick(event: MouseEvent) {
  // The canvas never navigates or submits, in either mode.
  event.preventDefault()
  if (mode.value === 'preview') return preview(event, 'click')
  event.stopPropagation()
  if (tool.value) {
    const insert = slotAt(event.target, { x: event.clientX, y: event.clientY })
    indicator.value = null
    if (insert) post({ type: 'bildr:insert', parentId: insert.slot.parentId, index: insert.slot.index })
    return
  }
  const id = reachableAt(event.target)
  if (id) post({ type: 'bildr:click', nodeId: id, shift: event.shiftKey, meta: event.metaKey || event.ctrlKey, ...variantField() })
}

function onPress(event: MouseEvent, kind: 'pressed' | null) {
  if (mode.value !== 'preview') return
  for (const element of planChain(event.target)) {
    if (element.variantRoot) pointerState(element, kind ?? 'hover')
  }
}
const onMouseDown = (event: MouseEvent) => {
  if (mode.value === 'preview') return onPress(event, 'pressed')
  event.preventDefault()
  if (event.button === 1) pan = { x: event.screenX, y: event.screenY }
}
const onMouseUp = (event: MouseEvent) => {
  pan = null
  onPress(event, null)
}

let pan: { x: number, y: number } | null = null
function onPanMove(event: MouseEvent) {
  if (!pan) return
  post({ type: 'bildr:pan', dx: event.screenX - pan.x, dy: event.screenY - pan.y })
  pan = { x: event.screenX, y: event.screenY }
}
const onAuxClick = (event: MouseEvent) => event.preventDefault()

function onWheel(event: WheelEvent) {
  if (render.value?.view === 'tokens') return
  event.preventDefault()
  post({ type: 'bildr:wheel', dx: wheelPixels(event.deltaX, event.deltaMode), dy: wheelPixels(event.deltaY, event.deltaMode), zoom: event.ctrlKey || event.metaKey, x: event.clientX, y: event.clientY })
}

function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  const id = reachableAt(event.target)
  if (id) post({ type: 'bildr:contextmenu', nodeId: id, x: event.clientX, y: event.clientY, ...variantField() })
}

const SHORTCUT_KEYS = new Set(['Delete', 'Backspace', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
function onKeyDown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (event.key === 'Alt') alt.value = true
  if (event.code === 'Space') {
    event.preventDefault()
    if (!event.repeat) post({ type: 'bildr:space', down: true })
    return
  }
  const lower = event.key.toLowerCase()
  const zooms = zoomShortcut({ code: event.code, key: event.key, meta, shift: event.shiftKey })
  const editorMeta = meta && (event.altKey ? ['KeyV', 'KeyK', 'KeyB'].includes(event.code) : ['z', 'y', 'd', 'a', 'g', 'p', 'f', 'k', 'c', 'v', 'r', 'l'].includes(lower))
  const takes = editorTakesKey(
    { key: event.key, code: event.code, meta, shift: event.shiftKey, alt: event.altKey },
    { focus: 'canvas', textSelected: hasTextSelection(window), hasSelection: selectedIds.value.length > 0 }
  )
  if (!takes || (!zooms && !SHORTCUT_KEYS.has(event.key) && !editorMeta && !(event.shiftKey && !meta && lower === 'a'))) return
  event.preventDefault()
  post(canvasKeyMessage(event))
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === 'Alt') alt.value = false
  if (event.code !== 'Space') return
  event.preventDefault()
  post({ type: 'bildr:space', down: false })
}

const sizeObserver = typeof ResizeObserver === 'undefined'
  ? null
  : new ResizeObserver(() => render.value?.view !== 'tokens' && post({ type: 'bildr:size', height: Math.ceil(root.value?.offsetHeight ?? 0) }))

const listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions | boolean | undefined]> = [
  [window, 'message', onMessage as EventListener, undefined],
  [document, 'dragover', onDragOver as EventListener, undefined],
  [document, 'dragleave', onDragLeave as EventListener, undefined],
  [document, 'drop', onDrop as EventListener, undefined],
  [document, 'dragend', clearIndicator, undefined],
  [document, 'mousemove', onPointerMove as EventListener, true],
  [document, 'click', onClick as EventListener, true],
  [document, 'mousedown', onMouseDown as EventListener, true],
  [document, 'mouseup', onMouseUp as EventListener, true],
  [document, 'contextmenu', onContextMenu as EventListener, true],
  [document, 'keydown', onKeyDown as EventListener, undefined],
  [document, 'keyup', onKeyUp as EventListener, undefined],
  [document, 'mousemove', onPanMove as EventListener, undefined],
  [document, 'auxclick', onAuxClick as EventListener, true],
  [document, 'wheel', onWheel as EventListener, { passive: false }]
]

onMounted(() => {
  for (const [target, name, listener, options] of listeners) target.addEventListener(name, listener, options)
  document.documentElement.addEventListener('mouseleave', onPointerLeave)
  frame = requestAnimationFrame(track)
  applyViewportRules()
  if (root.value) sizeObserver?.observe(root.value)
  post({ type: 'bildr:ready' })
})

onBeforeUnmount(() => {
  for (const [target, name, listener, options] of listeners) target.removeEventListener(name, listener, options)
  document.documentElement.removeEventListener('mouseleave', onPointerLeave)
  cancelAnimationFrame(frame)
  sizeObserver?.disconnect()
  for (const timer of timers) clearTimeout(timer)
})
</script>

<template>
  <UApp>
    <div
      ref="root"
      class="relative"
      :class="{ 'cursor-crosshair': tool && mode === 'edit' }"
      :data-canvas-viewport="render?.view === 'page' || undefined"
      :data-canvas-mode="mode"
      :style="{ minHeight: `${FRAME_MIN_HEIGHT}px`, [VIEWPORT_VAR]: `${viewportHeight}px`, [ACCENT_VAR]: accent }"
    >
      <p
        v-if="render?.view === 'tokens'"
        class="p-6 text-sm text-muted"
      >
        The token sheet comes with the Design screen.
      </p>
      <ModelNode
        v-for="(element, i) in plan"
        :key="element.node ?? i"
        :element="element"
      />
      <template v-if="mode === 'edit'">
        <div
          v-if="boxes.parent"
          class="pointer-events-none absolute z-50 outline-dashed"
          :style="{ ...boxStyle(boxes.parent), outlineColor: `color-mix(in srgb, var(${ACCENT_VAR}) 60%, transparent)` }"
          :data-selection-parent="boxes.parent.id"
        />
        <div
          v-for="box in boxes.selected"
          :key="box.id"
          class="pointer-events-none absolute z-50 outline-solid"
          :style="{ ...boxStyle(box), outlineColor: `var(${ACCENT_VAR})` }"
          :data-selection-box="box.id"
        >
          <span
            v-if="box.id === selectedId && active"
            class="absolute left-0 px-1 text-[10px] leading-4 font-medium whitespace-nowrap text-white"
            :class="labelInside(box) ? 'top-0 origin-top-left rounded-sm' : 'bottom-full origin-bottom-left rounded-t-sm'"
            :style="{ backgroundColor: `var(${ACCENT_VAR})`, transform: labelInside(box) ? `translate(${2 / zoom}px, ${2 / zoom}px) scale(${1 / zoom})` : `scale(${1 / zoom})` }"
            data-selection-label
          >{{ box.label }}</span>
        </div>
        <div
          v-if="boxes.hover"
          class="pointer-events-none absolute z-50 outline-solid"
          :style="{ ...boxStyle(boxes.hover), outlineColor: measurement ? '#f24822' : `color-mix(in srgb, var(${ACCENT_VAR}) 50%, transparent)` }"
          :data-hover-box="boxes.hover.id"
        />
        <div
          v-if="spacing && spacing.padding.length"
          class="contents"
          data-spacing-overlay="padding"
        >
          <div
            v-for="area in spacing.padding"
            :key="area.side"
            class="pointer-events-none absolute z-50"
            :style="{ ...rectStyle(area), ...hatch() }"
          />
        </div>
        <div
          v-if="spacing && spacing.gaps.length"
          class="contents"
          data-spacing-overlay="gap"
        >
          <div
            v-for="(gap, i) in spacing.gaps"
            :key="i"
            class="pointer-events-none absolute z-50"
            :style="{ ...rectStyle(gap), ...hatch() }"
          />
        </div>
        <div
          v-for="(line, i) in measurement ?? []"
          :key="i"
          class="pointer-events-none absolute z-50 bg-[#f24822]"
          :style="lineStyle(line)"
          data-measure-line
          :data-measure-px="Math.round(line.length)"
        />
        <div
          v-if="indicator"
          class="pointer-events-none absolute z-50 rounded-sm"
          :style="{ top: `${indicator.top}px`, left: `${indicator.left}px`, width: `${indicator.width}px`, height: `${indicator.height}px`, ...(indicator.line ? { backgroundColor: `var(${ACCENT_VAR})` } : { outline: `2px solid var(${ACCENT_VAR})`, outlineOffset: '-2px' }) }"
          data-drop-indicator
        />
      </template>
    </div>
  </UApp>
</template>
