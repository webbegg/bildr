<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import UApp from '@nuxt/ui/components/App.vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { resolveThemeColors, themeCss } from '@bildr/codegen/design'
import type { Breakpoint, BreakpointBase } from '@bildr/codegen/design'
import type { ComponentFile, ModelNode as TreeNode, Value } from '@bildr/codegen/model'
import type { NodeBox } from '@bildr/editor-core/autoLayout'
import { editorTakesKey, hasTextSelection } from '@bildr/editor-core/clipboardKeys'
import { paddingRects } from '@bildr/editor-core/handles'
import type { SpacingHandle } from '@bildr/editor-core/handles'
import { labelPlacement } from '@bildr/editor-core/labelPlacement'
import { measure as measureLines } from '@bildr/editor-core/measure'
import type { MeasureLine } from '@bildr/editor-core/measure'
import { applyStylePreview, showsPatch } from '@bildr/editor-core/preview'
import type { StylePatch } from '@bildr/editor-core/preview'
import { FRAME_MIN_HEIGHT, viewportUnitRules, wheelPixels, zoomShortcut } from '@bildr/editor-core/viewport'
import EditorTokenSheet from '../components/editor/EditorTokenSheet.vue'
import { toolForKey } from '../editor/tools.ts'
import ModelNode from './ModelNode.vue'
import { dropTarget, insertTarget, nearestUnlocked } from './drop.ts'
import type { Box, DropSlot } from './drop.ts'
import { canvasKeyMessage, isCanvasMessage } from './protocol.ts'
import { HANDLE_PX, useGestures } from './useGestures.ts'
import type { Indicator } from './useGestures.ts'
import type { CanvasMode, CanvasToEditor, EditorToCanvas, RenderMessage, SpacingOverlay } from './protocol.ts'
import { isCheckbox, pageNodeId, renderPlan, stepValue } from './render.ts'
import type { CanvasFile, PlanChild, PlanElement } from './render.ts'

/**
 * The canvas (P4a): the editor frames it at `/__bildr/canvas` and drives it
 * with postMessage (`protocol.ts`), as the hosted `pages/canvas.vue` did. It
 * renders the `.bildr` file of `bildr:render` with its data through the
 * render plan (`render.ts`, the generator's rules) and `ModelNode.vue`, and
 * draws no editor chrome beyond the hosted overlays: hover and selection outlines
 * (a single selection's parent dashed, the primary one labelled in the
 * active frame), Alt measurements to the hovered element (with their px),
 * the padding and gap overlays a hovered panel field asks for, the resize and
 * spacing handles, the drop indicator and the armed insert tool's slot.
 *
 * Elements map to nodes through `data-node`. Gestures report the node of the
 * file being edited (`pageNodeId`: an instance for its parts, the page root
 * for its layout's), or its nearest unlocked ancestor; List copies report
 * the node they repeat, and outlines, rects and drops use the first copy.
 * In edit mode a click selects and nothing in the page runs (links don't
 * navigate, buttons don't act). In preview mode (`bildr:mode`) interactions
 * run: component variants and toasts here; navigate, runAction and setState
 * steps are reported (`bildr:interaction`; a Checkbox click is its `change`, and a
 * setState step goes with its value worked out here, `protocol.ts`). Style previews from the editor
 * show over the file until it clears them or a render shows their values.
 * Handle drags (resize, padding and gap) and the drag-to-reorder of the
 * selection (`useGestures.ts`, the hosted gesture lifecycle) preview live and
 * commit once on release. The token sheet view (`view: 'tokens'`,
 * `EditorTokenSheet`, the Design view's style guide) shows the theme in place of the file.
 */

const SELECTION_ACCENT = '#09f'
const ACCENT_VAR = '--canvas-accent'
const VIEWPORT_VAR = '--canvas-vh'
const DRAG_MIME = 'application/x-bildr'

const render = shallowRef<RenderMessage | null>(null)
const mode = ref<CanvasMode>('edit')
/** Preview mode: the variant each interactive instance's interactions switched it to, by its root's `data-node` id. It stays until another interaction changes it. */
const shown = reactive<Record<string, string>>({})
/** Preview mode: how many records each List shows after its Load more clicks, by the List's `data-node` id. */
const listShown = reactive<Record<string, number>>({})
/** Preview mode: the hover or pressed state each instance under the pointer shows over its variant; it ends with the pointer. */
const pointer = reactive<Record<string, string>>({})
/** Preview mode: what each Checkbox that has no value of its own shows, by its slot (`placed`): off at first, then alternating as the app's does. It ends with preview. */
const unboundChecked = reactive<Record<string, boolean>>({})
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
const router = useRouter()

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

const built = computed<PlanElement[]>(() => {
  const message = render.value
  if (!message || !file.value || message.view !== 'page') return []
  return renderPlan({ file: file.value, components: message.components, layouts: message.layouts, data: message.data, ...(message.paths ? { paths: message.paths } : {}), ...(message.formSelects ? { formSelects: message.formSelects } : {}), ...(message.formats ? { formats: message.formats } : {}), ...(message.breakpointBase ? { base: message.breakpointBase } : {}), variant: message.variant ?? null, shown: { ...shown, ...pointer }, listShown: { ...listShown } })
})

/**
 * The plan as drawn, and where each element is in it. A node a List repeats is drawn once per row, in plan order: the nth element
 * of a node id is the nth `data-node` of that id in the document, so a click finds the exact element it was on (`planAt`), with
 * the row's own scope. In preview a Checkbox with no value to show (a `field` or nothing: the app's own toggles it, off at first)
 * is drawn from `unboundChecked` by its slot, the node id and which of its rows it is.
 */
const placed = computed(() => {
  const rendered = new Map<string, PlanElement[]>()
  const slots = new WeakMap<PlanElement, string>()
  const unbound = new WeakSet<PlanElement>()
  const place = (children: PlanChild[]): PlanChild[] => children.map((child) => {
    if (typeof child === 'string') return child
    const own: PlanElement = { ...child }
    if (child.node) {
      const same = rendered.get(child.node) ?? []
      same.push(own)
      rendered.set(child.node, same)
      const slot = `${child.node}#${same.length - 1}`
      slots.set(own, slot)
      if (mode.value === 'preview' && isCheckbox(child) && !('modelValue' in child.attrs)) {
        own.attrs = { ...child.attrs, modelValue: unboundChecked[slot] === true }
        unbound.add(own)
      }
    }
    own.children = place(child.children)
    return own
  })
  return { plan: place(built.value) as PlanElement[], rendered, slots, unbound }
})
const plan = computed(() => placed.value.plan)

/** The first (non-copy) plan element of each node id, for labels (and what a node is, which its copies share). */
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

/** The interactive instances' roots by `variantRoot.key`: a render builds new plan elements, but a key names the same instance. */
const variantRoots = computed(() => {
  const map = new Map<string, PlanElement>()
  const visit = (children: PlanChild[]) => {
    for (const child of children) {
      if (typeof child === 'string') continue
      if (child.variantRoot && !map.has(child.variantRoot.key)) map.set(child.variantRoot.key, child)
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
  if (event.source !== window.parent || event.origin !== window.location.origin || !isCanvasMessage<EditorToCanvas>(event.data)) return
  const message = event.data
  if (message.type === 'bildr:render') {
    const base = render.value?.breakpointBase
    render.value = message
    if (Object.keys(previews.value).length) previews.value = settlePreviews(previews.value, message.file.root)
    headStyle('bildr-canvas-theme', themeCss(resolveThemeColors(message.theme, {})))
    if (message.breakpointBase !== base) applyViewportRules()
    // Links to the page being edited are active: the router sits on its path.
    if (router.currentRoute.value.fullPath !== (message.path ?? '/')) void router.replace(message.path ?? '/')
  } else if (message.type === 'bildr:mode') {
    mode.value = message.mode
    for (const key of Object.keys(shown)) Reflect.deleteProperty(shown, key)
    for (const key of Object.keys(listShown)) Reflect.deleteProperty(listShown, key)
    for (const key of Object.keys(pointer)) Reflect.deleteProperty(pointer, key)
    for (const key of Object.keys(unboundChecked)) Reflect.deleteProperty(unboundChecked, key)
  } else if (message.type === 'bildr:cancel-drag') {
    handles.cancel()
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

const handles = useGestures({
  root: () => render.value?.file.root,
  fileId: () => render.value?.file.id,
  theme: () => render.value?.theme,
  selectedIds,
  active,
  tool,
  mode,
  view: () => render.value?.view,
  zoom,
  panelOverlay,
  breakpoint: () => frameBreakpoint(),
  firstCopy,
  boxOf: id => boxes.selected.find(box => box.id === id) ?? outline(id),
  reachableAt,
  dropAt: (target, point, draggedId) => slotAt(target, point, draggedId),
  setPreview: (nodeId, patch) => {
    const { [nodeId]: _, ...others } = previews.value
    previews.value = patch ? { ...others, [nodeId]: patch } : others
  },
  setIndicator: (next) => {
    indicator.value = next
  },
  post
})
const { spacing, resizeHandles, spacingHandleList, dragLabel } = handles

/** The white ring around a handle, `px` wide on screen. */
const ringShadow = (width: number) => `0 0 0 ${width / zoom.value}px #fff`
/** A spacing handle: a pill across the side or gap it drags (12 × 4 on screen). */
function spacingHandleStyle(handle: SpacingHandle) {
  const across = handle.kind === 'padding' ? handle.side === 'left' || handle.side === 'right' : spacing.value?.axis === 'row'
  const [w, h] = (across ? [4, 12] : [12, 4]).map(n => n / zoom.value) as [number, number]
  return { left: `${handle.x - w / 2}px`, top: `${handle.y - h / 2}px`, width: `${w}px`, height: `${h}px`, boxShadow: ringShadow(1) }
}

let frame = 0
function track() {
  boxes.hover = hoveredId.value && !selectedIds.value.includes(hoveredId.value) ? outline(hoveredId.value) : null
  boxes.selected = selectedIds.value.map(outline).filter((box): box is Outline => !!box)
  boxes.parent = active.value && parentId.value ? outline(parentId.value) : null
  handles.track()
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

/** Where to draw a drop slot: its mark's outline inside it, else a line on the side of its mark. */
function indicatorOf(slot: DropSlot): Indicator | null {
  const mark = rectOf(slot.markId)
  if (!mark) return null
  const box = { top: mark.y + window.scrollY, left: mark.x + window.scrollX, width: mark.width, height: mark.height }
  if (slot.position === 'inside') return { ...box, line: false }
  const end = slot.position === 'after'
  return slot.horizontal
    ? { top: box.top, left: box.left + (end ? box.width : 0) - 1, width: 2, height: box.height, line: true }
    : { top: box.top + (end ? box.height : 0) - 1, left: box.left, width: box.width, height: 2, line: true }
}

/** The drop slot at a viewport point over `target`, and where to draw it. */
function slotAt(target: EventTarget | null, point: { x: number, y: number }, draggedId?: string): { slot: DropSlot, indicator: Indicator } | null {
  const tree = file.value?.root
  const el = nodeOf(target)
  if (!tree || !el || el.closest('[data-copy]')) return null
  const slot = dropTarget(tree, pageNodeId(el.getAttribute('data-node')!), point, rectOf, isRow, draggedId)
  const drawn = slot ? indicatorOf(slot) : null
  return slot && drawn ? { slot, indicator: drawn } : null
}

/**
 * The insert slot of the armed tool under the pointer, plus where to draw it (the hosted `insertAt`): a
 * container takes the component between the children around the pointer, a leaf right after itself.
 * Lock-aware: a click on a locked node (or inside a lock) inserts into its nearest unlocked ancestor.
 */
function insertAt(event: MouseEvent): { slot: DropSlot, indicator: Indicator } | null {
  const tree = file.value?.root
  const id = reachableAt(event.target)
  const node = tree && id && render.value?.view === 'page' ? findNode(tree, id) : undefined
  if (!tree || !node) return null
  const childRects = (node.children ?? []).map(child => firstCopy(child.id)?.getBoundingClientRect() ?? null)
  const hit = insertTarget(tree, node.id, { x: event.clientX, y: event.clientY }, childRects, isRow(node.id))
  if (!hit) return null
  const slot = { ...hit, horizontal: isRow(hit.parentId) }
  const drawn = indicatorOf(slot)
  return drawn ? { slot, indicator: drawn } : null
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

/**
 * Runs a node's steps for `on`, in order: toasts here, everything else reported to the editor. A Set state step is reported with
 * its value worked out here, where the node's scope (the row's own) and the event are (`checked`: a Checkbox's new value). One that
 * can't be worked out stops the steps after it, as a failed action does: the message after it does not show.
 */
function runSteps(element: PlanElement, on: string, steps: Step[], checked?: boolean) {
  const nodeId = pageNodeId(element.node!)
  for (const step of steps) {
    if (step.kind === 'setState') {
      const value = element.scope ? stepValue(step.value, element.scope, checked) : undefined
      if (value === undefined) return
      post({ type: 'bildr:interaction', nodeId, on, step: { ...step, value } })
    } else if (step.kind === 'toast') toast.add({ title: String(step.title ?? ''), ...(typeof step.description === 'string' ? { description: step.description } : {}), ...(typeof step.color === 'string' ? { color: step.color as 'primary' } : {}), ...(typeof step.icon === 'string' ? { icon: step.icon } : {}) })
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
    // The state the pointer showed was of the variant it left: show the one of the new variant, if the pointer is still there.
    Reflect.deleteProperty(pointer, info.key)
    if (hoveredRoots.includes(info.key)) pointerState(root, 'hover')
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
  const base = shown[info.key] ?? info.variant
  const baseId = base === 'default' ? '' : info.component.variants.find(variant => variant.name === base)?.id ?? ''
  const state = kind ? info.component.variants.find(variant => variant.state?.of === baseId && variant.state.kind === kind) : undefined
  if (state) pointer[info.key] = state.name
  else if (!kind) Reflect.deleteProperty(pointer, info.key)
}

/** The plan element a node's DOM element was drawn from: that row's, for a node a List repeats (its first one when the document and the plan disagree). */
function planAt(el: Element): PlanElement | undefined {
  const id = el.getAttribute('data-node')!
  const drawn = placed.value.rendered.get(id)
  const here = document.querySelectorAll(`[data-node="${CSS.escape(id)}"]`)
  return drawn && drawn.length === here.length ? drawn[[...here].indexOf(el)] : elements.value.get(id)
}

/** The plan elements from `target` up to the document, nearest first. */
function planChain(target: EventTarget | null): PlanElement[] {
  const chain: PlanElement[] = []
  for (let el = nodeOf(target); el; el = nodeOf(el.parentElement)) {
    const element = planAt(el)
    if (element) chain.push(element)
  }
  return chain
}

/** What a preview click reaches: a Checkbox's label is its control (the label is beside the control's element, and the canvas stops its own activation). */
function previewTarget(target: EventTarget | null): EventTarget | null {
  const label = target instanceof Element ? target.closest('label[for]') : null
  const control = label ? document.getElementById(label.getAttribute('for')!) : null
  return control && nodeOf(control) === control ? control : target
}

/** Whether a Checkbox shows as checked now (in preview every Checkbox is drawn with its value, `placed`). */
const isChecked = (element: PlanElement): boolean => element.attrs.modelValue === true

/** A preview event: the nearest node with an interaction for it runs it, and the nearest interactive instance switches variant. */
function preview(event: Event, on: string) {
  // A List's Load more shows a page more records, as the generated page's button does.
  const button = on === 'click' && event.target instanceof Element ? event.target.closest('[data-load-more]') : null
  if (button) {
    const key = button.getAttribute('data-load-more')!
    const size = Number(button.getAttribute('data-load-more-size'))
    listShown[key] = (listShown[key] ?? size) + size
    return
  }
  const chain = planChain(previewTarget(event.target))
  const own = chain.find(element => element.interactions?.some(interaction => interaction.on === on))
  if (own) {
    for (const interaction of own.interactions!.filter(entry => entry.on === on)) runSteps(own, on, interaction.do as Step[])
  }
  // A click on a Checkbox is its `change`: to the value it is not now.
  const box = on === 'click' ? chain.find(isCheckbox) : undefined
  if (box) {
    const checked = !isChecked(box)
    if (placed.value.unbound.has(box)) unboundChecked[placed.value.slots.get(box)!] = checked
    for (const interaction of (box.interactions ?? []).filter(entry => entry.on === 'change')) runSteps(box, 'change', interaction.do as Step[], checked)
  }
  for (const element of chain) {
    if (element.variantRoot && runVariant(element, on)) break
  }
}

/**
 * The keys of the interactive instances under the pointer. Keys, not plan
 * elements: a click that switches a variant renders a new plan, and elements
 * compared by identity would read every instance as left and entered again,
 * resetting the variant the click had just set.
 */
let hoveredRoots: string[] = []
function previewPointer(event: MouseEvent) {
  const roots = planChain(event.target).filter(element => element.variantRoot)
  const keys = roots.map(element => element.variantRoot!.key)
  for (const key of hoveredRoots.filter(entry => !keys.includes(entry))) {
    const left = variantRoots.value.get(key)
    if (!left) continue
    pointerState(left, null)
    runVariant(left, 'mouseleave')
  }
  for (const entered of roots.filter(element => !hoveredRoots.includes(element.variantRoot!.key))) {
    pointerState(entered, 'hover')
    runVariant(entered, 'mouseenter')
  }
  hoveredRoots = keys
}

// ── Pointer and keys ────────────────────────────────────────────────────

function onPointerMove(event: MouseEvent) {
  alt.value = event.altKey
  if (mode.value === 'preview') return previewPointer(event)
  // A press or drag is running: the hover waits (the hosted canvas does the same).
  if (handles.moved(event)) return
  if (tool.value) indicator.value = insertAt(event)?.indicator ?? null
  const id = reachableAt(event.target)
  if (id === hoveredId.value) return
  hoveredId.value = id
  post({ type: 'bildr:hover', nodeId: id })
}

function onPointerLeave() {
  handles.left()
  if (tool.value) indicator.value = null
  if (mode.value === 'preview') {
    for (const key of hoveredRoots) {
      const left = variantRoots.value.get(key)
      if (left) pointerState(left, null)
    }
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
  // The click that ends a handle drag selects nothing.
  if (handles.takesClick()) return
  if (tool.value) {
    const insert = insertAt(event)
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
/** A press on a handle starts a drag; nothing else sees it (no text selection, no focus change). */
const onPointerDown = (event: PointerEvent) => {
  if (!handles.down(event)) return
  event.preventDefault()
  event.stopPropagation()
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

const CONTROLS = 'button, input, select, textarea, a[href], [role="checkbox"], [role="switch"], [role="button"]'
/**
 * In preview Space and Enter on a focused control are the control's: a Checkbox toggles (its `change` runs), any other control keeps
 * its own click. They don't pan (Space) and aren't the editor's keys (Enter). Space pans when no control is focused, and in edit mode.
 */
function controlKey(event: KeyboardEvent): boolean {
  if (mode.value !== 'preview' || (event.code !== 'Space' && event.key !== 'Enter') || !(event.target instanceof Element) || !event.target.closest(CONTROLS)) return false
  const el = nodeOf(event.target)
  const element = el ? planAt(el) : undefined
  if (element && isCheckbox(element)) {
    event.preventDefault()
    if (event.type === 'keydown' && !event.repeat) preview(event, 'click')
  }
  return true
}

const SHORTCUT_KEYS = new Set(['Delete', 'Backspace', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
function onKeyDown(event: KeyboardEvent) {
  // Esc is a drag's own: it must not also clear the editor's selection.
  if (event.key === 'Escape' && handles.cancel()) {
    event.preventDefault()
    return
  }
  if (controlKey(event)) return
  const meta = event.metaKey || event.ctrlKey
  if (event.key === 'Alt') alt.value = true
  if (event.code === 'Space') {
    event.preventDefault()
    if (!event.repeat) post({ type: 'bildr:space', down: true })
    return
  }
  const lower = event.key.toLowerCase()
  const zooms = zoomShortcut({ code: event.code, key: event.key, meta, shift: event.shiftKey })
  const armsTool = !!toolForKey({ key: event.key, meta, shift: event.shiftKey, alt: event.altKey })
  const editorMeta = meta && (event.altKey ? ['KeyV', 'KeyK', 'KeyB'].includes(event.code) : ['z', 'y', 'd', 'a', 'g', 'p', 'f', 'k', 'c', 'v', 'r', 'l'].includes(lower))
  const takes = editorTakesKey(
    { key: event.key, code: event.code, meta, shift: event.shiftKey, alt: event.altKey },
    { focus: 'canvas', textSelected: hasTextSelection(window), hasSelection: selectedIds.value.length > 0 }
  )
  if (!takes || (!zooms && !armsTool && !SHORTCUT_KEYS.has(event.key) && !editorMeta && !(event.shiftKey && !meta && lower === 'a'))) return
  event.preventDefault()
  post(canvasKeyMessage(event))
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === 'Alt') alt.value = false
  if (controlKey(event)) return
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
  [document, 'pointerdown', onPointerDown as EventListener, true],
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
  handles.dispose()
  sizeObserver?.disconnect()
  for (const timer of timers) clearTimeout(timer)
})
</script>

<template>
  <UApp>
    <div
      ref="root"
      class="relative"
      :class="{ 'min-h-screen': render?.view === 'tokens', 'cursor-crosshair! **:cursor-crosshair!': tool && mode === 'edit' && render?.view === 'page' }"
      :data-armed-tool="tool ?? undefined"
      :data-canvas-viewport="render?.view === 'page' || undefined"
      :data-canvas-mode="mode"
      :data-canvas-accent="accent"
      :data-board-variant="render?.variant ? (render.variant.id ?? 'primary') : undefined"
      :style="render?.view === 'tokens' ? { [ACCENT_VAR]: accent } : { minHeight: `${FRAME_MIN_HEIGHT}px`, [VIEWPORT_VAR]: `${viewportHeight}px`, [ACCENT_VAR]: accent }"
    >
      <EditorTokenSheet
        v-if="render?.view === 'tokens'"
        :theme="render.theme"
      />
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
            :data-selection-label="labelInside(box) ? 'inside' : 'above'"
          >{{ box.label }}</span>
        </div>
        <div
          v-if="boxes.hover"
          class="pointer-events-none absolute z-50 outline-solid"
          :style="{ ...boxStyle(boxes.hover), outlineColor: measurement ? '#f24822' : `color-mix(in srgb, var(${ACCENT_VAR}) 50%, transparent)` }"
          :data-hover-box="boxes.hover.id"
        />
        <template v-if="spacing">
          <div
            v-if="spacing.showPadding"
            class="contents"
            data-spacing-overlay="padding"
          >
            <div
              v-for="area in paddingRects(spacing.rect, spacing.insets).filter(entry => entry.width > 0 && entry.height > 0)"
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
              v-for="(gap, i) in spacing.gaps.filter(entry => entry.width > 0 && entry.height > 0)"
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
        <div
          v-for="(line, i) in measurement ?? []"
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
        <div
          v-if="indicator"
          class="pointer-events-none absolute z-50"
          :class="indicator.line ? 'rounded-full bg-(--canvas-accent)' : 'rounded-sm bg-(--canvas-accent)/5 outline-2 -outline-offset-2 outline-(--canvas-accent)'"
          :style="{ top: `${indicator.top}px`, left: `${indicator.left}px`, width: `${indicator.width}px`, height: `${indicator.height}px` }"
          data-drop-indicator
        />
      </template>
    </div>
  </UApp>
</template>
