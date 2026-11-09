import { getStyleToken } from '../design/tokens'
import { spacingBasePx } from '../design/theme'
import type { Theme } from '../design/theme'
import type { Rect } from './viewport'

/**
 * Figma's "Add auto layout" (Shift+A) guess: from the on-canvas boxes of the
 * nodes to group, whether they sit side by side (a Row) or stacked (a
 * Column), their order along that axis, and the gap between them as the
 * nearest spacing token.
 */

export interface NodeBox extends Rect {
  id: string
}

export interface AutoLayout {
  direction: 'row' | 'col'
  gapPx: number
  /** Node ids in visual order along the direction. */
  order: string[]
}

/** How much of the smaller of two spans [a0, a1] and [b0, b1] they share, 0 to 1. */
function overlap(a0: number, a1: number, b0: number, b1: number): number {
  const shared = Math.min(a1, b1) - Math.max(a0, b0)
  const smaller = Math.min(a1 - a0, b1 - b0)
  return shared > 0 && smaller > 0 ? shared / smaller : 0
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const spread = (values: number[]) => Math.max(...values) - Math.min(...values)

/**
 * Boxes sharing more of their heights than of their widths sit side by side
 * (a Row); otherwise they are stacked (a Column). A tie (e.g. diagonal boxes)
 * goes to the axis their centres spread along most. The gap is the median of
 * the gaps between consecutive boxes, overlaps counting as 0.
 */
export function inferAutoLayout(boxes: NodeBox[]): AutoLayout {
  let rows = 0
  let cols = 0
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      rows += overlap(a.y, a.y + a.height, b.y, b.y + b.height)
      cols += overlap(a.x, a.x + a.width, b.x, b.x + b.width)
    }
  }
  const dx = spread(boxes.map(b => b.x + b.width / 2))
  const dy = spread(boxes.map(b => b.y + b.height / 2))
  const direction = rows > cols || (rows === cols && dx > dy) ? 'row' : 'col'
  const start = (b: NodeBox) => (direction === 'row' ? b.x : b.y)
  const end = (b: NodeBox) => (direction === 'row' ? b.x + b.width : b.y + b.height)
  const cross = (b: NodeBox) => (direction === 'row' ? b.y : b.x)
  const sorted = [...boxes].sort((a, b) => start(a) - start(b) || cross(a) - cross(b))
  const gaps = sorted.slice(1).map((b, i) => Math.max(0, start(b) - end(sorted[i]!)))
  return { direction, gapPx: median(gaps), order: sorted.map(b => b.id) }
}

/** The `gap` token whose size at the spacing density is nearest `px`; the smaller one on a tie. */
export function nearestSpacingToken(px: number, density: Theme['spacing']): string {
  const base = spacingBasePx(density)
  const values = getStyleToken('gap')!.values.filter(v => !Number.isNaN(Number(v)))
  let best = values[0]!
  for (const value of values) {
    if (Math.abs(Number(value) * base - px) < Math.abs(Number(best) * base - px)) best = value
  }
  return best
}
