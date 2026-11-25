import { breakpointsOf, styleKey, STYLE_TOKENS } from '@bildr/codegen/design'
import type { Breakpoint, BreakpointBase } from '@bildr/codegen/design'
import type { Delta, HandleId, Rect } from './handles.ts'
import { handleAxes } from './handles.ts'

/**
 * Grid edit mode (layout-containers L6, after Penpot, Figma Grid and Webflow
 * Quick Stack): a selected grid shows its tracks with headers, + and − add or
 * remove a track, dragging a child's edge spans it across tracks, and Fill
 * cells appends empty stacks to the cells left in its last row. Pure: the
 * canvas measures, these work out what to draw and what to write.
 */

/** The value of token `key` where a frame renders at `breakpoint`: the base key, overridden by each breakpoint of the cascade up to it. */
export function tokenAt(style: Record<string, string>, key: string, breakpoint: Breakpoint | undefined, base: BreakpointBase): string | undefined {
  let value = style[key]
  if (!breakpoint) return value
  for (const level of breakpointsOf(base)) {
    value = style[styleKey(key, level)] ?? value
    if (level === breakpoint) break
  }
  return value
}

/** The px sizes of a resolved `grid-template-columns`/`-rows` (as `getComputedStyle` gives them); none for `none`. */
export function trackSizes(template: string): number[] {
  return template.trim() === '' || template === 'none' ? [] : template.trim().split(/\s+/).map(Number.parseFloat).filter(Number.isFinite)
}

/** The rect of each track inside the content box: columns side by side, rows stacked, `gap` apart. */
export function trackRects(content: Rect, sizes: readonly number[], gap: number, axis: 'col' | 'row'): Rect[] {
  let at = axis === 'col' ? content.x : content.y
  return sizes.map((size) => {
    const rect = axis === 'col' ? { x: at, y: content.y, width: size, height: content.height } : { x: content.x, y: at, width: content.width, height: size }
    at += size + gap
    return rect
  })
}

const numericValues = (key: 'cols' | 'rows' | 'colSpan' | 'rowSpan') =>
  (STYLE_TOKENS.find(token => token.key === key)?.values ?? []).filter(value => /^\d+$/.test(value)).map(Number)

/**
 * The `cols` or `rows` value one track more (`dir` 1) or less (−1): the next
 * number the token has from the count set, or from the `measured` count when
 * none is set (a Grid's default columns, a grid's implicit rows). Undefined
 * when there is none (past the scale, auto-fit, or implicit rows to remove);
 * null when a set row count of one goes back to auto.
 */
export function trackStep(key: 'cols' | 'rows', current: string | undefined, measured: number, dir: 1 | -1): string | null | undefined {
  if (current !== undefined && !/^\d+$/.test(current)) return undefined
  if (key === 'rows' && dir < 0 && current === undefined) return undefined
  const count = current === undefined ? measured : Number(current)
  const values = numericValues(key)
  const next = dir > 0 ? values.find(value => value > count) : values.toReversed().find(value => value < count)
  if (next === undefined) return key === 'rows' && dir < 0 && count <= 1 ? null : undefined
  return String(next)
}

/** One axis of a span drag: the track and gap px, the tracks there are, and the child's span when it started. */
export interface SpanAxis { track: number, gap: number, count: number, span: number }

export interface SpanDrag {
  handle: HandleId
  breakpoint: Breakpoint | undefined
  col: SpanAxis
  row: SpanAxis
}

/** `n`, or the value of the token's numbers nearest it (the lower on a tie). */
const nearestValue = (values: readonly number[], n: number) =>
  values.reduce((best, value) => (Math.abs(value - n) < Math.abs(best - n) ? value : best), values[0] ?? n)

/**
 * The span tokens a grid child's edge drag holds: per axis the handle moves,
 * the tracks its new size covers (rounded, at least one), written at the
 * breakpoint. Every column is `full`; a count the token lacks snaps to the
 * nearest it has. Nothing for an axis whose span doesn't change.
 */
export function spanPatch(drag: SpanDrag, delta: Delta): Record<string, string> {
  const axes = handleAxes(drag.handle)
  const patch: Record<string, string> = {}
  const axis = (key: 'colSpan' | 'rowSpan', sign: number, travel: number, at: SpanAxis) => {
    if (!sign || at.track <= 0) return
    const size = at.span * at.track + (at.span - 1) * at.gap + sign * travel
    const covered = Math.max(1, Math.round((size + at.gap) / (at.track + at.gap)))
    if (covered === at.span) return
    patch[styleKey(key, drag.breakpoint)] = key === 'colSpan' && covered >= at.count ? 'full' : String(nearestValue(numericValues(key), covered))
  }
  axis('colSpan', axes.x, delta.dx, drag.col)
  axis('rowSpan', axes.y, delta.dy, drag.row)
  return patch
}

/** A grid child's spans, as tokens (`full` is every column). */
export interface CellSpan { colSpan?: string, rowSpan?: string }

/**
 * How many one-cell children appended to a grid of `cols` columns fill it:
 * the cells after the last child (CSS auto-placement, row by row, never
 * backfilling), up to its last row or the `rows` set, whichever is more.
 */
export function fillCount(cols: number, rows: number | undefined, children: readonly CellSpan[]): number {
  const taken = new Set<string>()
  const free = (r: number, c: number, cs: number, rs: number) => {
    for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (taken.has(`${r + i},${c + j}`)) return false
    return true
  }
  let cursor = { r: 0, c: 0 }
  let used = 0
  /** Places a cs×rs item at the first free spot from the cursor; returns its row. */
  const place = (cs: number, rs: number) => {
    for (let r = cursor.r; ; r++) {
      for (let c = r === cursor.r ? cursor.c : 0; c + cs <= cols; c++) {
        if (!free(r, c, cs, rs)) continue
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) taken.add(`${r + i},${c + j}`)
        cursor = { r, c: c + cs }
        used = Math.max(used, r + rs)
        return r
      }
    }
  }
  const spanOf = (value: string | undefined, full: number) => (value === 'full' ? full : Math.max(1, Number(value) || 1))
  for (const child of children) place(Math.min(cols, spanOf(child.colSpan, cols)), spanOf(child.rowSpan, 1))
  const target = Math.max(rows ?? 0, used)
  let count = 0
  while (count < target * cols) {
    const before = { cursor, used }
    if (place(1, 1) >= target) {
      ({ cursor, used } = before)
      break
    }
    count++
  }
  return count
}
