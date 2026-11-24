import { parseStyleKey, styleKey } from '@bildr/codegen/design'
import type { Breakpoint, Theme } from '@bildr/codegen/design'
import type { StylePatch } from './preview.ts'
import { scalePx, scaleStops, scaleValues, SHIFT_STOPS } from './scale.ts'
import { SCRUB_DEAD_ZONE } from './scrub.ts'
import type { Side } from './spacing.ts'
import { sideKey, spacingSide } from './spacing.ts'

/**
 * Canvas direct manipulation (#23), the pure part: the resize handles of a
 * selected node, the padding and gap overlays of an auto layout and their
 * handles, and how a drag of either snaps to the token scale. A drag never
 * writes a length: it picks the scale stop whose px size (at the project
 * density) is nearest the size under the pointer, like the panel's scrub,
 * and Shift moves by `SHIFT_STOPS` stops from where the drag started.
 * Rects and points are canvas px (the iframe's CSS px, before the editor zoom).
 */

export interface Rect { x: number, y: number, width: number, height: number }
export interface Point { x: number, y: number }
export interface Delta { dx: number, dy: number }

/** The 8 resize handles: corners and edge midpoints, clockwise from the top left. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandleId = typeof HANDLES[number]

/** Where a handle sits on each axis: -1 the left or top edge, 1 the right or bottom one, 0 the middle (it doesn't resize that axis). */
export function handleAxes(handle: HandleId): { x: -1 | 0 | 1, y: -1 | 0 | 1 } {
  return {
    x: handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0,
    y: handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0
  }
}

export function handlePoint(rect: Rect, handle: HandleId): Point {
  const { x, y } = handleAxes(handle)
  return { x: rect.x + rect.width * (x + 1) / 2, y: rect.y + rect.height * (y + 1) / 2 }
}

/** The point nearest `point` within `radius`, or null. */
export function hitPoint<T extends Point>(points: readonly T[], point: Point, radius: number): T | null {
  let best: T | null = null
  let distance = radius
  for (const candidate of points) {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y)
    if (d <= distance) {
      best = candidate
      distance = d
    }
  }
  return best
}

/**
 * The handle hit radius at `point`: `radius` outside the box, and inside it
 * at most a quarter of its smaller side, so the middle of a box that is small
 * on screen (zoomed out) still starts a drag of the node, not a resize. Never
 * less than `floor` (half the drawn handle): a handle you can see can be pressed.
 */
export function hitRadius(rect: Rect, point: Point, radius: number, floor = 0): number {
  const inside = point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height
  return inside ? Math.max(floor, Math.min(radius, Math.min(rect.width, rect.height) / 4)) : radius
}

/** The resize handle of `rect` under `point` (the nearest within `radius`), or null. */
export function hitHandle(rect: Rect, point: Point, radius: number): HandleId | null {
  return hitPoint(HANDLES.map(handle => ({ handle, ...handlePoint(rect, handle) })), point, radius)?.handle ?? null
}

export function handleCursor(handle: HandleId): string {
  const { x, y } = handleAxes(handle)
  if (!x) return 'ns-resize'
  if (!y) return 'ew-resize'
  return x === y ? 'nwse-resize' : 'nesw-resize'
}

/**
 * The stop of a token's scale (breakpoint-prefixed or not; its numbers, see
 * `scaleStops`) nearest `targetPx` at `basePx` per unit. With `shift`, the
 * stop moves from the one nearest `startPx` in steps of `SHIFT_STOPS`.
 */
export function nearestStop(key: string, targetPx: number, basePx: number, { shift = false, startPx }: { shift?: boolean, startPx?: number } = {}): string | undefined {
  const stops = scaleStops(key)
  if (!stops.length) return undefined
  const nearest = (px: number) => stops.reduce((best, stop, i) => (Math.abs(Number(stop) * basePx - px) < Math.abs(Number(stops[best]) * basePx - px) ? i : best), 0)
  let at = nearest(targetPx)
  if (shift && startPx !== undefined) {
    const from = nearest(startPx)
    at = Math.min(stops.length - 1, Math.max(0, from + Math.round((at - from) / SHIFT_STOPS) * SHIFT_STOPS))
  }
  return stops[at]
}

/** The live label of a dragged value: its class and px size, e.g. `w-64 · 256px`. */
export function scaleLabel(key: string, value: string, spacing: Theme['spacing']): string {
  const token = parseStyleKey(key)?.token
  const name = token?.prefix ? `${token.prefix}-${value}` : value
  const px = scalePx(key, value, spacing)
  return px ? `${name} · ${px}` : name
}

export interface ResizeDrag {
  handle: HandleId
  /** The node's box when the drag started, in px. */
  width: number
  height: number
  /** The edited breakpoint; the keys are written there. */
  breakpoint: Breakpoint | undefined
  /** Px per scale unit (the project's `--spacing`). */
  basePx: number
  /**
   * The px size Fill (`full`) renders the node at, per axis, given only where
   * the parent's size is definite there (see `fillSizes`); an axis without it
   * has no `full` candidate, so a drag there always writes a fixed step.
   */
  fill?: { width?: number, height?: number }
}

export interface Size { width: number, height: number }

/**
 * The sizes Fill can snap to, from the node measured at `100%` and at `50%`
 * of each axis (one axis at a time): where the parent's size is definite the
 * two differ, and `full` renders at the `100%` size; where it is indefinite
 * (an auto-height Column) both resolve to the auto size, so Fill would show
 * no change and is left out.
 */
export function fillSizes(full: Size, half: Size): ResizeDrag['fill'] {
  const fill: NonNullable<ResizeDrag['fill']> = {}
  if (Math.abs(full.width - half.width) >= 0.5) fill.width = full.width
  if (Math.abs(full.height - half.height) >= 0.5) fill.height = full.height
  return fill
}

/**
 * A double-click on a resize handle (Figma's edge gesture, layout-containers
 * L3): the axes the handle resizes become Fit, or Fill with Alt, at the
 * edited breakpoint.
 */
export function edgeSizePatch(handle: HandleId, breakpoint: Breakpoint | undefined, alt: boolean): Record<string, string> {
  const axes = handleAxes(handle)
  const value = alt ? 'fill' : 'fit'
  return { ...(axes.x ? { [styleKey('w', breakpoint)]: value } : {}), ...(axes.y ? { [styleKey('h', breakpoint)]: value } : {}) }
}

/** The 100% stop of a size scale (Relative), measured as the parent's content size. */
const FILL = 'full'

/**
 * The W/H tokens a resize drag holds: for each axis the handle resizes and
 * the pointer has moved along (past the scrub dead zone), the candidate
 * nearest the start size plus the travel (a left or top handle grows as it
 * moves out), Shift by 4 candidates from the start's. The candidates are the
 * scale's numbers and Fill (`full`, at the size it renders, only on an axis
 * `fill` gives: a parent of definite size), so a Fit size becomes a fixed one
 * or Fill. `delta` is in canvas px: the canvas iframe is scaled by the
 * editor's zoom transform, so its pointer coordinates are already divided by
 * the zoom (once), and the size follows the pointer at any zoom. A snap never
 * goes against the drag: a candidate smaller than the start on an outward
 * drag (or larger on an inward one) leaves the axis unpatched, e.g. an
 * outward drag of a node wider than the scale and its parent.
 */
export function resizePatch(drag: ResizeDrag, delta: Delta, shift: boolean): Record<string, string> {
  const axes = handleAxes(drag.handle)
  const patch: Record<string, string> = {}
  const axis = (base: 'w' | 'h', sign: number, travel: number, start: number, fillPx: number | undefined) => {
    if (!sign || Math.abs(travel) < SCRUB_DEAD_ZONE) return
    const key = styleKey(base, drag.breakpoint)
    const candidates = scaleStops(key).map(value => ({ value, px: Number(value) * drag.basePx }))
    if (fillPx !== undefined && scaleValues(key).includes(FILL)) candidates.push({ value: FILL, px: fillPx })
    candidates.sort((a, b) => a.px - b.px)
    if (!candidates.length) return
    const nearest = (px: number) => candidates.reduce((best, c, i) => (Math.abs(c.px - px) < Math.abs(candidates[best]!.px - px) ? i : best), 0)
    const grow = sign * travel > 0
    let at = nearest(start + sign * travel)
    if (shift) {
      const from = nearest(start)
      at = Math.min(candidates.length - 1, Math.max(0, from + Math.round((at - from) / SHIFT_STOPS) * SHIFT_STOPS))
    }
    const pick = candidates[at]!
    if (grow ? pick.px < start : pick.px > start) return
    patch[key] = pick.value
  }
  axis('w', axes.x, delta.dx, drag.width, drag.fill?.width)
  axis('h', axes.y, delta.dy, drag.height, drag.fill?.height)
  return patch
}

/** `patch` without the keys `style` already has at that value; empty when the drag changed nothing. */
export function changedPatch(style: Record<string, string>, patch: StylePatch): StylePatch {
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => (value === null ? style[key] !== undefined : style[key] !== value)))
}

export type Insets = Record<Side, number>

/** The four padding areas of a box (border-box `rect`, padding `insets`), for the hatched overlay. */
export function paddingRects(rect: Rect, padding: Insets): (Rect & { side: Side })[] {
  const inner = rect.height - padding.top - padding.bottom
  return [
    { side: 'top', x: rect.x, y: rect.y, width: rect.width, height: padding.top },
    { side: 'right', x: rect.x + rect.width - padding.right, y: rect.y + padding.top, width: padding.right, height: inner },
    { side: 'bottom', x: rect.x, y: rect.y + rect.height - padding.bottom, width: rect.width, height: padding.bottom },
    { side: 'left', x: rect.x, y: rect.y + padding.top, width: padding.left, height: inner }
  ]
}

export type Axis = 'row' | 'col'

/**
 * The gaps of a flex layout: between each pair of children (`children` in
 * visual order along the main `axis`) that sit on one line, spanning the
 * content box across. A zero gap is kept (as a zero-wide area, so its handle
 * can still be dragged); a wrap to the next line is not a gap.
 */
export function gapRects(content: Rect, children: readonly Rect[], axis: Axis): Rect[] {
  const row = axis === 'row'
  const gaps: Rect[] = []
  for (let i = 1; i < children.length; i++) {
    const prev = children[i - 1]!
    const next = children[i]!
    const end = row ? prev.x + prev.width : prev.y + prev.height
    const size = (row ? next.x : next.y) - end
    const sameLine = row
      ? next.y < prev.y + prev.height && prev.y < next.y + next.height
      : next.x < prev.x + prev.width && prev.x < next.x + next.width
    if (size < -0.5 || !sameLine) continue
    const width = Math.max(0, size)
    gaps.push(row ? { x: end, y: content.y, width, height: content.height } : { x: content.x, y: end, width: content.width, height: width })
  }
  return gaps
}

export type SpacingHandle
  = | { kind: 'padding', side: Side, x: number, y: number }
    | { kind: 'gap', index: number, x: number, y: number }

/**
 * The drag handles of the spacing overlays: one in the middle of each padding
 * area (at least `inset` in from the edge, clear of the resize handles, so a
 * zero padding can be dragged too), and one in the middle of each gap.
 */
export function spacingHandles(rect: Rect, padding: Insets, gaps: readonly Rect[], inset: number): SpacingHandle[] {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const into = (side: Side) => Math.max(padding[side] / 2, inset)
  const sides: SpacingHandle[] = [
    { kind: 'padding', side: 'top', x: cx, y: rect.y + into('top') },
    { kind: 'padding', side: 'right', x: rect.x + rect.width - into('right'), y: cy },
    { kind: 'padding', side: 'bottom', x: cx, y: rect.y + rect.height - into('bottom') },
    { kind: 'padding', side: 'left', x: rect.x + into('left'), y: cy }
  ]
  return [...sides, ...gaps.map((gap, index): SpacingHandle => ({ kind: 'gap', index, x: gap.x + gap.width / 2, y: gap.y + gap.height / 2 }))]
}

/**
 * The padding key a side's drag writes, as the node uses it at the edited
 * breakpoint: the key its value is set with there (`p`, `py` or `pt`, so
 * the sides that share it move together), else the side's own key (an
 * unset or inherited side changes alone).
 */
export function paddingDragKey(style: Record<string, string>, side: Side, breakpoint: Breakpoint | undefined): string {
  const resolved = spacingSide(style, 'p', side, breakpoint)
  return resolved?.state === 'set' ? resolved.via : sideKey('p', side)
}

export type SpacingTarget = { kind: 'padding', side: Side } | { kind: 'gap', axis: Axis }

const INWARD: Record<Side, (delta: Delta) => number> = {
  top: d => d.dy,
  bottom: d => -d.dy,
  left: d => d.dx,
  right: d => -d.dx
}

/**
 * The spacing token a padding or gap drag holds: the nearest step to the
 * start size (`startPx`) plus the travel, inward for a padding side, along
 * the main axis for a gap; written at the edited breakpoint.
 */
export function spacingDragPatch(style: Record<string, string>, target: SpacingTarget, startPx: number, delta: Delta, opts: { breakpoint: Breakpoint | undefined, basePx: number, shift: boolean }): Record<string, string> {
  const base = target.kind === 'gap' ? 'gap' : paddingDragKey(style, target.side, opts.breakpoint)
  const travel = target.kind === 'gap' ? (target.axis === 'row' ? delta.dx : delta.dy) : INWARD[target.side](delta)
  const key = styleKey(base, opts.breakpoint)
  const value = nearestStop(key, startPx + travel, opts.basePx, { shift: opts.shift, startPx })
  return value === undefined ? {} : { [key]: value }
}
