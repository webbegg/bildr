import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { spacingBasePx } from '@bildr/codegen/design'
import type { Breakpoint, Theme } from '@bildr/codegen/design'
import type { ModelNode } from '@bildr/codegen/model'
import { changedPatch, fillSizes, gapRects, handleCursor, handlePoint, HANDLES, hitPoint, hitRadius, resizePatch, scaleLabel, spacingDragPatch, spacingHandles } from '@bildr/editor-core/handles'
import type { Axis, HandleId, Insets, Point, ResizeDrag, SpacingHandle, SpacingTarget } from '@bildr/editor-core/handles'
import type { StylePatch } from '@bildr/editor-core/preview'
import { SCRUB_DEAD_ZONE } from '@bildr/editor-core/scrub'
import { nearestUnlocked } from './drop.ts'
import type { CanvasMode, CanvasToEditor, SpacingOverlay } from './protocol.ts'

/**
 * Direct manipulation in the canvas (hosted #23, P4c): the resize handles of a
 * single selected node, and the padding and gap overlays with their handles.
 * A press on a handle starts a drag; every move snaps to the token scale
 * (`resizePatch`, `spacingDragPatch`: a drag never writes a length), shows the
 * patch on the node here at once and reports it as `bildr:style-preview`; the
 * release reports the changed tokens once as `bildr:style-commit` (one undo
 * step); Esc, a pointer cancel, losing focus or a move with the button up
 * cancels it and drops the preview. The click that ends a drag selects
 * nothing. Handles are drawn only in the active frame, in edit mode, on a
 * single unlocked node that is not the root, and write at the breakpoint of
 * the frame's width. Rects and points are canvas px (the frame's CSS px).
 */

export interface Box { top: number, left: number, width: number, height: number }

export interface HandlesContext {
  root: () => ModelNode | undefined
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
  /** Shows (or, with null, drops) a style patch on a node here. */
  setPreview: (nodeId: string, patch: StylePatch | null) => void
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

type Gesture
  = | { kind: 'resize', nodeId: string, pointerId: number, start: Point, patch: Record<string, string>, cursor: string, drag: ResizeDrag }
    | { kind: 'spacing', nodeId: string, pointerId: number, start: Point, patch: Record<string, string>, cursor: string, target: SpacingTarget, startPx: number, shown: { padding: boolean, gap: boolean } }

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

export function useHandles(ctx: HandlesContext) {
  /** The node direct manipulation applies to: a single unlocked selection, not the root, in the active frame in edit mode. */
  const editable = computed(() => {
    const root = ctx.root()
    const id = ctx.selectedIds.value.length === 1 ? ctx.selectedIds.value[0] : undefined
    return root && id && id !== root.id && ctx.view() === 'page' && ctx.mode.value === 'edit' && ctx.active.value && !ctx.tool.value && nearestUnlocked(root, id) === id ? id : null
  })
  const editableBox = shallowRef<Box | null>(null)
  const spacing = shallowRef<SpacingBox | null>(null)
  const dragLabel = ref<{ text: string, x: number, y: number } | null>(null)

  let gesture: Gesture | null = null
  let pointer: Point | null = null
  /** Set when a drag ended: the click that follows selects nothing. */
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

  /** Shows a drag's patch on the node at once, and reports it to the editor. */
  function showPatch(g: Gesture, patch: Record<string, string>, at: Point) {
    const entries = Object.entries(patch)
    dragLabel.value = entries.length ? { text: entries.map(([key, value]) => scaleLabel(key, value, ctx.theme()?.spacing ?? 'default')).join(', '), x: at.x, y: at.y } : null
    if (JSON.stringify(patch) === JSON.stringify(g.patch)) return
    g.patch = patch
    ctx.setPreview(g.nodeId, entries.length ? patch : null)
    ctx.post({ type: 'bildr:style-preview', nodeId: g.nodeId, style: entries.length ? patch : null })
  }

  /** A measurement of the Fill (`full`) sizes node `id` can snap to: its element at 100% and at 50% of each axis, then restored. */
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

  function onMove(event: PointerEvent) {
    const g = gesture
    if (!g || event.pointerId !== g.pointerId) return
    // The release happened outside the frame: the drag is over.
    if ((event.buttons & 1) === 0) return end('cancel')
    const at = canvasPoint(event)
    const delta = { dx: at.x - g.start.x, dy: at.y - g.start.y }
    const style = findNodeStyle(g.nodeId)
    const patch = g.kind === 'resize'
      ? resizePatch(g.drag, delta, event.shiftKey)
      : Math.hypot(delta.dx, delta.dy) < SCRUB_DEAD_ZONE
        ? {}
        : spacingDragPatch(style, g.target, g.startPx, delta, { breakpoint: ctx.breakpoint(), basePx: spacingBasePx(ctx.theme()?.spacing ?? 'default'), shift: event.shiftKey })
    showPatch(g, patch, at)
  }
  const onUp = (event: PointerEvent) => {
    if (gesture && event.pointerId === gesture.pointerId) end('commit')
  }
  const onCancel = (event: PointerEvent) => {
    if (gesture && event.pointerId === gesture.pointerId) end('cancel')
  }
  const onBlur = () => end('cancel')

  function findNodeStyle(id: string): Record<string, string> {
    const find = (node: ModelNode): ModelNode | undefined => node.id === id ? node : node.children?.map(find).find(Boolean)
    const root = ctx.root()
    return (root && find(root)?.style) ?? {}
  }

  /** Ends the drag in progress: it commits its patch (one undo step), or is cancelled and its preview dropped. */
  function end(how: 'commit' | 'cancel') {
    const g = gesture
    if (!g) return
    gesture = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('blur', onBlur)
    try {
      if (document.documentElement.hasPointerCapture?.(g.pointerId)) document.documentElement.releasePointerCapture(g.pointerId)
    } catch {
      // The pointer is already gone.
    }
    setCursor(null)
    dragLabel.value = null
    const dragged = Object.keys(g.patch).length > 0
    swallowClick = dragged || how === 'cancel'
    if (!dragged) return
    const changed = how === 'commit' ? changedPatch(findNodeStyle(g.nodeId), g.patch) : {}
    if (Object.keys(changed).length) {
      ctx.post({ type: 'bildr:style-commit', nodeId: g.nodeId, style: changed })
    } else {
      ctx.setPreview(g.nodeId, null)
      ctx.post({ type: 'bildr:style-preview', nodeId: g.nodeId, style: null })
    }
  }

  /** A press: on a handle it starts a drag (and is taken, so nothing else sees it); anywhere else it is not ours. */
  function down(event: PointerEvent): boolean {
    if (event.button !== 0 || ctx.mode.value !== 'edit') return false
    // A new press means the last one is over, even if its release never reached this frame.
    if (gesture) end('cancel')
    swallowClick = false
    const id = editable.value
    const box = editableBox.value
    if (!id || !box) return false
    const start = canvasPoint(event)
    const hit = handleAt(start)
    if (!hit) return false
    const base = { nodeId: id, pointerId: event.pointerId, start, patch: {} }
    if ('handle' in hit) {
      const drag: ResizeDrag = { handle: hit.handle, width: box.width, height: box.height, breakpoint: ctx.breakpoint(), basePx: spacingBasePx(ctx.theme()?.spacing ?? 'default'), fill: fillSize(id) }
      gesture = { kind: 'resize', ...base, drag, cursor: handleCursor(hit.handle) }
    } else {
      const s = spacing.value!
      const handle = hit.spacing
      gesture = {
        kind: 'spacing',
        ...base,
        target: handle.kind === 'padding' ? { kind: 'padding', side: handle.side } : { kind: 'gap', axis: s.axis },
        startPx: handle.kind === 'padding' ? s.insets[handle.side] : s.gapPx,
        cursor: spacingCursor(handle),
        shown: { padding: s.showPadding, gap: s.showGap }
      }
    }
    try {
      document.documentElement.setPointerCapture(event.pointerId)
    } catch {
      // The pointer is already gone; its pointerup ends the drag.
    }
    setCursor(gesture.cursor)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onBlur)
    return true
  }

  /** The pointer moved over the frame (not during a drag): remembers it, and shows the resize cursor over a handle. */
  function moved(event: MouseEvent) {
    pointer = canvasPoint(event)
    if (gesture) return
    const over = ctx.mode.value === 'edit' ? handleAt(pointer) : null
    setCursor(over ? 'handle' in over ? handleCursor(over.handle) : spacingCursor(over.spacing) : null)
  }
  function left() {
    pointer = null
    if (!gesture) setCursor(null)
  }

  /** Esc cancels a drag in progress; true when there was one (the key is its own). */
  function cancel(): boolean {
    if (!gesture) return false
    end('cancel')
    return true
  }

  /** Whether the click that follows is the end of a drag, and so selects nothing; asking clears it. */
  function takesClick(): boolean {
    const taken = swallowClick
    swallowClick = false
    return taken
  }

  // The dragged node going (deselected, or no longer editable here) cancels the drag like Esc.
  watch(editable, (id) => {
    if (gesture && gesture.nodeId !== id) end('cancel')
  })

  const dispose = () => end('cancel')

  return { editable, editableBox, spacing, resizeHandles, spacingHandleList, dragLabel, track, down, moved, left, cancel, takesClick, dispose }
}
