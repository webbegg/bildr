import type { Rect } from './viewport'

/**
 * Figma's Alt (Option) measurements between the selection box `a` and the
 * hovered box `b`, in canvas pixels: the gaps between them when they are
 * apart, or the distances between their matching edges when they overlap
 * (one inside the other).
 */

/** A horizontal (y1 = y2) or vertical (x1 = x2) distance line, its ends in increasing order. */
export interface MeasureLine {
  x1: number
  y1: number
  x2: number
  y2: number
  length: number
}

interface Span { start: number, end: number }

const spanX = (r: Rect): Span => ({ start: r.x, end: r.x + r.width })
const spanY = (r: Rect): Span => ({ start: r.y, end: r.y + r.height })
const overlaps = (a: Span, b: Span) => Math.min(a.end, b.end) > Math.max(a.start, b.start)
/** The middle of the shared part of two spans, or of `a` when they share none. */
const middle = (a: Span, b: Span) => (overlaps(a, b) ? (Math.max(a.start, b.start) + Math.min(a.end, b.end)) / 2 : (a.start + a.end) / 2)

const horizontal = (x1: number, x2: number, y: number): MeasureLine => ({ x1: Math.min(x1, x2), y1: y, x2: Math.max(x1, x2), y2: y, length: Math.abs(x2 - x1) })
const vertical = (y1: number, y2: number, x: number): MeasureLine => ({ x1: x, y1: Math.min(y1, y2), x2: x, y2: Math.max(y1, y2), length: Math.abs(y2 - y1) })

/** The gap between two spans that do not overlap: from the end of the first one to the start of the other. */
const gap = (a: Span, b: Span): [number, number] => (b.start >= a.end ? [a.end, b.start] : [b.end, a.start])

export function measure(a: Rect, b: Rect): MeasureLine[] {
  const [ax, ay, bx, by] = [spanX(a), spanY(a), spanX(b), spanY(b)]
  const cx = middle(ax, bx)
  const cy = middle(ay, by)
  const lines = overlaps(ax, bx) && overlaps(ay, by)
    ? [
        vertical(ay.start, by.start, cx),
        vertical(ay.end, by.end, cx),
        horizontal(ax.start, bx.start, cy),
        horizontal(ax.end, bx.end, cy)
      ]
    : [
        ...(overlaps(ax, bx) ? [] : [horizontal(...gap(ax, bx), cy)]),
        ...(overlaps(ay, by) ? [] : [vertical(...gap(ay, by), cx)])
      ]
  return lines.filter(line => line.length > 0)
}
