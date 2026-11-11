/**
 * The variant board's pure parts (Framer's variants side by side): in the
 * component view, one labelled frame per variant at the active breakpoint,
 * laid out as a grid. Base variants go in columns, the primary first, then
 * each variant in order, with a dashed "+ Variant" tile after the last
 * column; each base's hover and pressed states go under it in its column,
 * joined to it by a purple line, with a dashed "+ Hover / Pressed" tile
 * under the column while a kind is missing. Frames are keyed by variant
 * (`primary` for the definition itself). The board is on by default once
 * there are two variants, counting the primary; a choice made with the
 * toggle wins.
 */
import type { StateKind } from '../document/schema'
import type { Point, Rect } from './viewport'

export interface BoardFrame {
  /** The frame's key: `primary`, or the variant's id. */
  key: string
  /** The variant the frame shows; null is the primary. */
  variantId: string | null
  label: string
  primary: boolean
  /** For a state: its base's frame key and its kind. */
  state?: { base: string, kind: StateKind }
}

/** What the board reads of a variant. */
export interface BoardVariant {
  id: string
  name: string
  /** A state's base (`''` for the primary) and kind. */
  state?: { of: string, kind: StateKind }
}

const PRIMARY_KEY = 'primary'
const KIND_ORDER: StateKind[] = ['hover', 'pressed']

export function boardFrameKey(variantId: string | null): string {
  return variantId || PRIMARY_KEY
}

/**
 * The board's frames: each base (Primary, then each variant that is no
 * state) followed by its states, hover before pressed, labelled by name.
 * A state whose base is gone shows as a base.
 */
export function boardFrames(variants: readonly BoardVariant[]): BoardFrame[] {
  const ids = new Set(variants.map(v => v.id))
  const isState = (v: BoardVariant) => !!v.state && (v.state.of === '' || ids.has(v.state.of))
  const statesOf = (baseId: string, key: string): BoardFrame[] => variants
    .filter(v => isState(v) && v.state!.of === baseId)
    .sort((a, b) => KIND_ORDER.indexOf(a.state!.kind) - KIND_ORDER.indexOf(b.state!.kind))
    .map(v => ({ key: boardFrameKey(v.id), variantId: v.id, label: v.name, primary: false, state: { base: key, kind: v.state!.kind } }))
  return [
    { key: PRIMARY_KEY, variantId: null, label: 'Primary', primary: true },
    ...statesOf('', PRIMARY_KEY),
    ...variants.filter(v => !isState(v)).flatMap((v) => {
      const key = boardFrameKey(v.id)
      return [{ key, variantId: v.id, label: v.name, primary: false }, ...statesOf(v.id, key)]
    })
  ]
}

/** The variant a frame key shows (null: the primary); undefined when no frame has that key. */
export function boardVariantAt(frames: readonly BoardFrame[], key: string): string | null | undefined {
  const frame = frames.find(f => f.key === key)
  return frame ? frame.variantId : undefined
}

/** Whether the board shows: the remembered choice, else on with 2 or more variants (the primary and `variantCount` others). */
export function boardShown(remembered: boolean | undefined, variantCount: number): boolean {
  return remembered ?? variantCount + 1 >= 2
}

/** The "+ Variant" tile's largest size, in content pixels. */
export const ADD_TILE_MAX = { width: 240, height: 160 } as const
/** The "+ Hover / Pressed" tile's height, in content pixels (it is as wide as its column). */
export const STATE_TILE_HEIGHT = 120

export interface BoardPlacement {
  /** Where each frame goes, in the order of the frames. */
  frames: Rect[]
  /** The "+ Variant" tile, after the last column. */
  add: Rect
  /** A "+ Hover / Pressed" tile under each column missing a state kind, with the kinds its base has. */
  stateAdds: { base: string, variantId: string | null, taken: StateKind[], rect: Rect }[]
  /** The purple line joining a base to its states: one vertical segment per gap, through the column's centre. */
  links: { base: string, x: number, y1: number, y2: number }[]
}

/**
 * Where the board's frames go (see `boardFrames`): one column per base,
 * `width` wide and `gap` apart, top-aligned, its states stacked under it
 * `gap` apart, then the tiles: "+ Variant" no larger than a frame,
 * "+ Hover / Pressed" as wide as its column.
 */
export function boardLayout(frames: readonly BoardFrame[], heights: readonly number[], width: number, gap: number): BoardPlacement {
  const rects: Rect[] = []
  const columns: { base: BoardFrame, rects: Rect[], kinds: StateKind[] }[] = []
  frames.forEach((frame, i) => {
    const height = heights[i] ?? 0
    const column = frame.state ? columns.find(c => c.base.key === frame.state!.base) : undefined
    let rect: Rect
    if (column) {
      const last = column.rects.at(-1)!
      rect = { x: last.x, y: last.y + last.height + gap, width, height }
      column.kinds.push(frame.state!.kind)
      column.rects.push(rect)
    } else {
      rect = { x: columns.length * (width + gap), y: 0, width, height }
      columns.push({ base: frame, rects: [rect], kinds: [] })
    }
    rects.push(rect)
  })
  const tileWidth = Math.min(width, ADD_TILE_MAX.width)
  const baseHeights = columns.map(c => c.rects[0]!.height)
  return {
    frames: rects,
    add: {
      x: columns.length * (width + gap),
      y: 0,
      width: tileWidth,
      height: Math.min(Math.min(...baseHeights), ADD_TILE_MAX.height)
    },
    stateAdds: columns.filter(c => c.kinds.length < KIND_ORDER.length).map((c) => {
      const last = c.rects.at(-1)!
      return { base: c.base.key, variantId: c.base.variantId, taken: KIND_ORDER.filter(k => c.kinds.includes(k)), rect: { x: last.x, y: last.y + last.height + gap, width, height: STATE_TILE_HEIGHT } }
    }),
    links: columns.flatMap(c => c.rects.slice(1).map((rect, i) => {
      const above = c.rects[i]!
      return { base: c.base.key, x: above.x + width / 2, y1: above.y + above.height, y2: rect.y }
    }))
  }
}

const inside = (rect: Rect, { x, y }: Point) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height

/** The frame an interaction dragged from `sourceKey` would go to at `point`: a base frame other than the source (states show from the pointer). */
export function boardDropTarget(frames: readonly BoardFrame[], rects: readonly Rect[], point: Point, sourceKey: string): BoardFrame | undefined {
  const i = rects.findIndex(rect => inside(rect, point))
  const frame = i < 0 ? undefined : frames[i]
  return frame && !frame.state && frame.key !== sourceKey ? frame : undefined
}
