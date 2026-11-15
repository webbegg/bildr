import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { spacingBasePx } from '@bildr/codegen/design'
import type { Breakpoint, Theme } from '@bildr/codegen/design'
import type { ModelNode } from '@bildr/codegen/model'
import { changedPatch, fillSizes, gapRects, handleCursor, handlePoint, HANDLES, hitPoint, hitRadius, resizePatch, scaleLabel, spacingDragPatch, spacingHandles } from '@bildr/editor-core/handles'
import type { Axis, HandleId, Insets, ResizeDrag, SpacingHandle, SpacingTarget } from '@bildr/editor-core/handles'
import type { StylePatch } from '@bildr/editor-core/preview'
import { SCRUB_DEAD_ZONE } from '@bildr/editor-core/scrub'
import { containsNode, findNode } from '../design/tree.ts'
import type { DropSlot } from './drop.ts'
import { canDragNode, gestureTargetGone, isNoopMove, REORDER_THRESHOLD, startGesture, stepGesture } from './gesture.ts'
import type { GestureEffect, GestureEndReason, GestureState, Point } from './gesture.ts'
import type { CanvasMode, CanvasToEditor, SpacingOverlay } from './protocol.ts'

/**
 * The canvas's pointer gestures on the selection (the hosted `pages/canvas.vue`, direct
 * manipulation #23, over the module's `.bildr` file), in the active frame on a single unlocked
 * selection (not the root), in edit mode with no insert tool armed:
 *
 * - 8 resize handles (corners and edge midpoints): a drag previews the W/H scale step nearest
 *   the pointer (`resizePatch`), labelled e.g. `w-64 · 256px`, Shift by 4 stops; a Fit or Fill
 *   size becomes fixed.
 * - padding and gap overlays (hatched, accent) while the panel's Padding or Gap field is
 *   hovered (`bildr:overlay`), or both while the pointer is over a selected auto layout; their
 *   handles drag the padding key the side uses or `gap`, snapped the same way.
 * - a press on the selection that moves past 4 px drags it: the drop indicator shows the sibling
 *   slot or container under the pointer (locks respected), and the release moves it there
 *   (`bildr:drop`, one node_move).
 *
 * A handle drag previews through the editor (`bildr:style-preview`) and commits once on release
 * (`bildr:style-commit`), at this frame's breakpoint. Esc, a pointer cancel, losing focus, the
 * editor's `bildr:cancel-drag` or a move with the button up cancels any drag and drops its
 * preview; the click that ends a drag selects nothing. The lifecycle is `gesture.ts`.
 *
 * Module-specific (no hosted equivalent): the edit/preview mode gate, `cancel()` for the editor's
 * cancel-drag message, and the scrub dead zone of a spacing drag (a press that barely moves
 * changes no padding or gap).
 */

export interface Box { top: number, left: number, width: number, height: number }
export interface Indicator { top: number, left: number, width: number, height: number, line: boolean }

export interface GesturesContext {
  root: () => ModelNode | undefined
  /** The id of the file being edited: a gesture is gone when it changes. */
  fileId: () => string | undefined
  theme: () => Theme | undefined
  selectedIds: Ref<string[]>
  active: Ref<boolean>
  tool: Ref<string | null>
  mode: Ref<CanvasMode>
  view: () => string | undefined
  zoom: Ref<number>
  panelOverlay: Ref<SpacingOverlay | null>
  /** The breakpoint this frame's width renders at, where its handles write. */
  breakpoint: () => Breakpoint | undefined
  firstCopy: (id: string) => Element | null
  /** A node's box now, in canvas px. */
  boxOf: (id: string) => Box | null
  /** The node a pointer gesture on `target` reaches (its nearest unlocked ancestor). */
  reachableAt: (target: EventTarget | null) => string | null
  /** The drop slot under a viewport point, with where to draw it; the dragged node never drops into itself. */
  dropAt: (target: EventTarget | null, point: { x: number, y: number }, draggedId: string) => { slot: DropSlot, indicator: Indicator } | null
  /** Shows (or, with null, drops) a style patch on a node here. */
  setPreview: (nodeId: string, patch: StylePatch | null) => void
  setIndicator: (indicator: Indicator | null) => void
  post: (message: CanvasToEditor) => void
}

interface SpacingBox {
  /** The padding box (inside the border), its padding, and the gaps of its flex layout. */
  rect: { x: number, y: number, width: number, height: number }
  insets: Insets
  gaps: Array<{ x: number, y: number, width: number, height: number }>
  axis: Axis
  gapPx: number
  showPadding: boolean
  showGap: boolean
}

/** A drag's node, the file it started on, and its lifecycle (`stepGesture`: pending → active → done or cancelled). */
interface GestureBase { nodeId: string, pageId: string | undefined, state: GestureState }
type Gesture
  = | GestureBase & { kind: 'resize', drag: ResizeDrag, patch: Record<string, string>, cursor: string }
    | GestureBase & { kind: 'spacing', target: SpacingTarget, startPx: number, patch: Record<string, string>, cursor: string, shown: { padding: boolean, gap: boolean } }
    | GestureBase & { kind: 'reorder', slot: DropSlot | null }

/** Handle sizes in screen px (scaled back by the zoom): the drawn dot, the hit radius, and a spacing handle's least inset. */
export const HANDLE_PX = 7
const HANDLE_HIT_PX = 6
const HANDLE_INSET_PX = 8
const SPACING_CURSORS: Record<string, string> = { top: 'ns-resize', bottom: 'ns-resize', left: 'ew-resize', right: 'ew-resize', row: 'ew-resize', col: 'ns-resize' }

const px = (value: string) => Number.parseFloat(value) || 0
const toRect = (box: Box) => ({ x: box.left, y: box.top, width: box.width, height: box.height })
const inside = (point: Point, rect: { x: number, y: number, width: number, height: number }) =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height

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
function contentOf(target: Element) {
  const r = target.getBoundingClientRect()
  const c = getComputedStyle(target)
  return {
    x: r.left + window.scrollX + px(c.borderLeftWidth) + px(c.paddingLeft),
    y: r.top + window.scrollY + px(c.borderTopWidth) + px(c.paddingTop),
    width: r.width - px(c.borderLeftWidth) - px(c.borderRightWidth) - px(c.paddingLeft) - px(c.paddingRight),
    height: r.height - px(c.borderTopWidth) - px(c.borderBottomWidth) - px(c.paddingTop) - px(c.paddingBottom)
  }
}

export function useGestures(ctx: GesturesContext) {
  /** The node direct manipulation applies to: a single unlocked selection, not the root, in the active page-view frame in edit mode with Move. */
  const editable = computed(() => {
    const root = ctx.root()
    const id = ctx.selectedIds.value.length === 1 ? ctx.selectedIds.value[0] : undefined
    return root && id && ctx.view() === 'page' && ctx.mode.value === 'edit' && ctx.active.value && !ctx.tool.value && canDragNode(root, id) ? id : null
  })
  const editableBox = shallowRef<Box | null>(null)
  /** The spacing overlays shown on the editable node, measured each frame; null when none shows. */
  const spacing = shallowRef<SpacingBox | null>(null)
  /** The live token label of a handle drag, at the pointer (canvas px). */
  const dragLabel = ref<{ text: string, x: number, y: number } | null>(null)

  /** The drag in progress, from the press until it ends (`stepGesture`). */
  let gesture: Gesture | null = null
  /** The pointer in canvas px; null outside the frame. */
  let pointer: Point | null = null
  /** Set when a press ended a drag (or Esc cancelled one): the click that follows selects nothing. */
  let swallowClick = false

  const resizeHandles = computed(() => editableBox.value ? HANDLES.map(handle => ({ handle, ...handlePoint(toRect(editableBox.value!), handle) })) : [])
  const spacingHandleList = computed<SpacingHandle[]>(() => {
    const s = spacing.value
    return s ? spacingHandles(s.rect, s.insets, s.gaps, HANDLE_INSET_PX / ctx.zoom.value).filter(h => h.kind === 'padding' ? s.showPadding : s.showGap) : []
  })

  const canvasPoint = (event: MouseEvent): Point => ({ x: event.clientX + window.scrollX, y: event.clientY + window.scrollY })
  const spacingCursor = (handle: SpacingHandle) => SPACING_CURSORS[handle.kind === 'padding' ? handle.side : spacing.value?.axis ?? 'row']!

  /** The resize or spacing handle under a canvas point (the nearest within the hit radius), or null. */
  function handleAt(point: Point): { handle: HandleId } | { spacing: SpacingHandle } | null {
    const box = editableBox.value
    if (!box) return null
    const candidates = [
      ...resizeHandles.value.map(h => ({ x: h.x, y: h.y, hit: { handle: h.handle } as const })),
      ...spacingHandleList.value.map(h => ({ x: h.x, y: h.y, hit: { spacing: h } }))
    ]
    return hitPoint(candidates, point, hitRadius(toRect(box), point, HANDLE_HIT_PX / ctx.zoom.value))?.hit ?? null
  }

  /** The padding and flex gaps of node `id`'s element, in canvas px. */
  function measureSpacing(id: string, box: Box) {
    const el = ctx.firstCopy(id)
    if (!el) return null
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
        : ctx.panelOverlay.value
          ? { padding: ctx.panelOverlay.value === 'padding', gap: ctx.panelOverlay.value === 'gap' }
          : pointer && inside(pointer, toRect(box)) ? 'hover' as const : null
    const measured = want ? measureSpacing(id!, box!) : null
    if (!want || !measured || (want === 'hover' && !measured.flex)) {
      spacing.value = null
      return
    }
    const { flex, ...rest } = measured
    spacing.value = { ...rest, showPadding: want === 'hover' || want.padding, showGap: flex && (want === 'hover' || want.gap) }
  }

  /** Measured every frame by the canvas. */
  function track() {
    editableBox.value = editable.value ? ctx.boxOf(editable.value) : null
    trackSpacing()
  }

  /**
   * The sizes Fill (`full`) can snap node `id` to (`fillSizes`): its element measured with the axis at `100%` and at
   * `50%`, one axis at a time (a width change can rewrap text and change an auto height), then restored, before the next
   * paint. A percentage of an indefinite parent size (an auto-height Column) renders as auto, so Fill is left out there.
   */
  function fillSize(id: string): ResizeDrag['fill'] {
    const el = ctx.firstCopy(id) as HTMLElement | null
    if (!el?.style) return undefined
    const sizeAt = (prop: 'width' | 'height', value: string) => {
      const before = el.style.getPropertyValue(prop)
      const priority = el.style.getPropertyPriority(prop)
      el.style.setProperty(prop, value, 'important')
      const size = el.getBoundingClientRect()[prop]
      el.style.setProperty(prop, before, priority)
      return size
    }
    return fillSizes({ width: sizeAt('width', '100%'), height: sizeAt('height', '100%') }, { width: sizeAt('width', '50%'), height: sizeAt('height', '50%') })
  }

  /** A press becomes a drag: the pointer is captured (so it keeps dragging outside the frame), and the frame takes the keys (Esc). */
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
    const entries = Object.entries(patch)
    dragLabel.value = entries.length ? { text: entries.map(([key, value]) => scaleLabel(key, value, ctx.theme()?.spacing ?? 'default')).join(', '), x: at.x, y: at.y } : null
    if (JSON.stringify(patch) === JSON.stringify(g.patch)) return
    g.patch = patch
    ctx.setPreview(g.nodeId, entries.length ? patch : null)
    ctx.post({ type: 'bildr:style-preview', nodeId: g.nodeId, style: entries.length ? patch : null })
  }

  function onMove(event: PointerEvent) {
    const g = gesture
    const root = ctx.root()
    if (!g || !root) return
    const at = canvasPoint(event)
    // The threshold is screen px: scaled back by the editor zoom, like the handles.
    const step = stepGesture(g.state, { type: 'move', pointerId: event.pointerId, point: at, buttons: event.buttons }, REORDER_THRESHOLD / ctx.zoom.value)
    if (step.effect === 'ignore' || step.effect === 'wait') return
    if (!step.state) {
      finish(step.effect)
      return
    }
    g.state = step.state
    if (step.effect === 'activate') beginDrag(g)
    const delta = { dx: at.x - g.state.start.x, dy: at.y - g.state.start.y }
    if (g.kind === 'reorder') {
      // The pointer is captured, so the element under it comes from its position.
      const hit = ctx.dropAt(document.elementFromPoint(event.clientX, event.clientY), { x: event.clientX, y: event.clientY }, g.nodeId)
      g.slot = hit && !isNoopMove(root, g.nodeId, hit.slot) ? hit.slot : null
      ctx.setIndicator(hit && g.slot ? hit.indicator : null)
      return
    }
    const style = findNode(root, g.nodeId)?.style ?? {}
    const patch = g.kind === 'resize'
      ? resizePatch(g.drag, delta, event.shiftKey)
      : Math.hypot(delta.dx, delta.dy) < SCRUB_DEAD_ZONE
        ? {}
        : spacingDragPatch(style, g.target, g.startPx, delta, { breakpoint: ctx.breakpoint(), basePx: spacingBasePx(ctx.theme()?.spacing ?? 'default'), shift: event.shiftKey })
    showPatch(g, patch, at)
  }

  function onUp(event: PointerEvent) {
    if (!gesture) return
    const step = stepGesture(gesture.state, { type: 'up', pointerId: event.pointerId })
    if (!step.state) finish(step.effect)
  }
  const onCancel = (event: PointerEvent) => endBy('pointercancel', event.pointerId)
  const onBlur = () => endBy('blur')
  const onLostCapture = (event: PointerEvent) => endBy('lostcapture', event.pointerId)

  /** Ends the drag in progress: listeners, capture, cursor and label. */
  function endGesture(): Gesture | null {
    const g = gesture
    gesture = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('blur', onBlur)
    document.documentElement.removeEventListener('lostpointercapture', onLostCapture)
    try {
      if (g && document.documentElement.hasPointerCapture?.(g.state.pointerId)) document.documentElement.releasePointerCapture(g.state.pointerId)
    } catch {
      // The pointer is already gone.
    }
    setCursor(null)
    dragLabel.value = null
    return g
  }

  /** Ends the gesture for an exit (Esc, blur, lost capture…) if it applies; returns what that did (`cancel` for a running drag). */
  function endBy(reason: GestureEndReason, pointerId?: number): GestureEffect {
    if (!gesture) return 'ignore'
    const step = stepGesture(gesture.state, { type: 'end', reason, pointerId })
    if (!step.state) finish(step.effect)
    return step.effect
  }

  /** Ends the gesture by its outcome: `commit`, `cancel` (like Esc) or `abandon` (a press that never dragged: no effect, its click still selects). */
  function finish(effect: GestureEffect) {
    const g = endGesture()
    if (!g) return
    if (g.kind === 'reorder') ctx.setIndicator(null)
    if (effect === 'abandon') return
    swallowClick = true
    if (effect === 'cancel') {
      if (g.kind !== 'reorder' && Object.keys(g.patch).length) dropPreview(g.nodeId)
      return
    }
    commit(g)
  }

  /** The release: a handle drag commits its patch (one undo step), a reorder drag moves the node to the slot shown. */
  function commit(g: Gesture) {
    if (g.kind === 'reorder') {
      if (g.slot) ctx.post({ type: 'bildr:drop', parentId: g.slot.parentId, index: g.slot.index, payload: JSON.stringify({ kind: 'node', id: g.nodeId }) })
      return
    }
    const node = ctx.root() ? findNode(ctx.root()!, g.nodeId) : undefined
    const changed = node ? changedPatch(node.style ?? {}, g.patch) : {}
    if (Object.keys(changed).length) ctx.post({ type: 'bildr:style-commit', nodeId: g.nodeId, style: changed })
    else if (Object.keys(g.patch).length) dropPreview(g.nodeId)
  }

  function dropPreview(nodeId: string) {
    ctx.setPreview(nodeId, null)
    ctx.post({ type: 'bildr:style-preview', nodeId, style: null })
  }

  /**
   * A press in the active frame: on a handle it starts a resize or spacing drag (and is taken, so nothing
   * else sees it: true), on the selection a pending drag-to-reorder (not taken, so its click still selects).
   */
  function down(event: PointerEvent): boolean {
    if (event.button !== 0 || ctx.mode.value !== 'edit') return false
    swallowClick = false
    // A new press means the last one is over, even if its release never reached this frame.
    if (gesture) endBy('press')
    const root = ctx.root()
    const id = editable.value
    const box = editableBox.value
    if (!root || !id || !box) return false
    const start = canvasPoint(event)
    const hit = handleAt(start)
    const base = { nodeId: id, pageId: ctx.fileId(), state: startGesture(event.pointerId, start, !!hit) }
    if (hit && 'handle' in hit) {
      const drag: ResizeDrag = { handle: hit.handle, width: box.width, height: box.height, breakpoint: ctx.breakpoint(), basePx: spacingBasePx(ctx.theme()?.spacing ?? 'default'), fill: fillSize(id) }
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
      const reached = ctx.reachableAt(event.target)
      const node = findNode(root, id)
      if (!reached || !node || !containsNode(node, reached)) return false
      gesture = { kind: 'reorder', ...base, slot: null }
    }
    if (gesture.state.phase === 'active') beginDrag(gesture)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onBlur)
    document.documentElement.addEventListener('lostpointercapture', onLostCapture)
    return !!hit
  }

  /** The pointer moved over the frame: remembers it, and shows the resize cursor over a handle. True while a press or drag is running (the hover waits). */
  function moved(event: MouseEvent): boolean {
    pointer = canvasPoint(event)
    if (gesture) return true
    const over = ctx.mode.value === 'edit' ? handleAt(pointer) : null
    setCursor(over ? 'handle' in over ? handleCursor(over.handle) : spacingCursor(over.spacing) : null)
    return false
  }

  /** The pointer left the frame: a press that has not become a drag ends here (its release outside would never reach it). */
  function left() {
    pointer = null
    endBy('leave')
    if (!gesture) setCursor(null)
  }

  /** Esc cancels a drag in progress (also the editor's `bildr:cancel-drag`); true when there was one (the key is its own). */
  function cancel(): boolean {
    return endBy('escape') === 'cancel'
  }

  /** Whether the click that follows is the end of a drag, and so selects nothing; asking clears it. */
  function takesClick(): boolean {
    const taken = swallowClick
    swallowClick = false
    return taken
  }

  // The dragged node going (deselected, deleted, another file, locked, or no longer editable here) cancels the drag like Esc.
  watch([() => ctx.root(), ctx.selectedIds, editable], () => {
    const g = gesture
    if (g && (gestureTargetGone(g, { pageId: ctx.fileId(), root: ctx.root(), selectedIds: ctx.selectedIds.value }) || editable.value !== g.nodeId)) endBy('target-gone')
  })

  /** The frame going away mid-drag cancels it like Esc: the preview and the indicator are dropped, the listeners removed. */
  const dispose = () => {
    if (gesture) endBy('escape')
    else endGesture()
  }

  return { editable, editableBox, spacing, resizeHandles, spacingHandleList, dragLabel, track, down, moved, left, cancel, takesClick, dispose }
}
