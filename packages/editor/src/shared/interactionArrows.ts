/**
 * The variant board's interaction arrows (the hosted `shared/editor/interactionArrows.ts`),
 * Framer's curved purple arrows from one variant's frame to another's, as pure geometry in
 * board (content) pixels. An arrow to a frame on the right leaves the right edge and enters
 * the target's left edge near their tops, bowing up; one back to the left
 * goes half a lane lower and bows down, so a pair both ways stays apart.
 * Between frames of one column (a state and its base) it loops out of the
 * right edges. Repeated arrows between the same frames take a lane each.
 *
 * An interaction has no id in the model: an arrow's `id` is its `<variant>:<index>` key
 * (`interactionKey`), which `boardArrows` reads through `interactionRows`.
 */
import type { Point, Rect } from '@bildr/editor-core/viewport'
import type { BoardFrame } from './variantBoard.ts'
import { boardFrameKey } from './variantBoard.ts'
import { interactionRows } from './interactionPanel.ts'
import type { InteractionRow, VariantEvent } from './interactionPanel.ts'

/** How far below a frame's top arrows attach, by the ⚡ handle. */
export const ARROW_TOP = 56
/** The spacing of repeated arrows between the same frames. */
export const ARROW_LANE = 28
/** How far a sideways arrow bows. */
export const ARROW_BOW = 32
/** How far an arrow within a column loops out to the right. */
export const ARROW_LOOP = 80

export interface ArrowGeometry {
  start: Point
  end: Point
  /** The SVG path: one cubic curve. */
  d: string
  /** The arrowhead's polygon `points`: the tip, then the two wings. */
  head: string
  /** The curve's midpoint, for a label or a hit target. */
  mid: Point
}

const round = (n: number) => Math.round(n * 100) / 100
const anchor = (rect: Rect, offset: number) => rect.y + Math.min(offset, rect.height / 2)

/** The arrow from frame `from` to frame `to`; `head` is the arrowhead's length. */
export function arrowGeometry(from: Rect, to: Rect, { lane = 0, head = 10 }: { lane?: number, head?: number } = {}): ArrowGeometry {
  const offset = ARROW_TOP + lane * ARROW_LANE
  let start: Point, end: Point, c1: Point, c2: Point
  if (to.x >= from.x + from.width) {
    start = { x: from.x + from.width, y: anchor(from, offset) }
    end = { x: to.x, y: anchor(to, offset) }
    const dx = (end.x - start.x) / 2
    c1 = { x: start.x + dx, y: start.y - ARROW_BOW }
    c2 = { x: end.x - dx, y: end.y - ARROW_BOW }
  } else if (to.x + to.width <= from.x) {
    start = { x: from.x, y: anchor(from, offset + ARROW_LANE / 2) }
    end = { x: to.x + to.width, y: anchor(to, offset + ARROW_LANE / 2) }
    const dx = (start.x - end.x) / 2
    c1 = { x: start.x - dx, y: start.y + ARROW_BOW }
    c2 = { x: end.x + dx, y: end.y + ARROW_BOW }
  } else {
    const loop = ARROW_LOOP + lane * ARROW_LANE
    start = { x: from.x + from.width, y: anchor(from, offset) }
    end = { x: to.x + to.width, y: anchor(to, offset) }
    c1 = { x: start.x + loop, y: start.y }
    c2 = { x: end.x + loop, y: end.y }
  }
  const at = (key: 'x' | 'y') => round((start[key] + 3 * c1[key] + 3 * c2[key] + end[key]) / 8)
  const p = (point: Point) => `${round(point.x)} ${round(point.y)}`
  return {
    start,
    end,
    d: `M ${p(start)} C ${p(c1)} ${p(c2)} ${p(end)}`,
    head: arrowHead(end, c2, head),
    mid: { x: at('x'), y: at('y') }
  }
}

/** A triangle with its tip at `tip`, pointing away from `from`, `size` long and as wide. */
function arrowHead(tip: Point, from: Point, size: number): string {
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const base = { x: tip.x - ux * size, y: tip.y - uy * size }
  const half = size / 2
  return [tip, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }]
    .map(point => `${round(point.x)},${round(point.y)}`)
    .join(' ')
}

export interface BoardArrow {
  /** The interaction's key (`<variant>:<index>`). */
  id: string
  /** The frame keys it goes between. */
  from: string
  to: string
  on: VariantEvent
  /** Its place among the arrows between the same two frames, in that direction. */
  lane: number
}

type ArrowSource = Parameters<typeof interactionRows>[0]

/** Every interaction of `def` (the primary's, then each variant's) as an arrow between frames on the board; ones with a frame missing are left out. */
export function boardArrows(def: ArrowSource, frames: readonly BoardFrame[]): BoardArrow[] {
  const keys = new Set(frames.map(f => f.key))
  const lanes = new Map<string, number>()
  const owners = [{ owner: '', rows: interactionRows(def, '') }, ...def.variants.map(v => ({ owner: v.id, rows: interactionRows(def, v.id) }))]
  return owners.flatMap(({ owner, rows }) => rows.flatMap((row: InteractionRow) => {
    const from = boardFrameKey(owner || null)
    const to = boardFrameKey(row.to || null)
    if (!keys.has(from) || !keys.has(to)) return []
    const pair = `${from}>${to}`
    const lane = lanes.get(pair) ?? 0
    lanes.set(pair, lane + 1)
    return [{ id: row.key, from, to, on: row.on, lane }]
  }))
}
