/**
 * The variant board's pure parts (Framer's variants side by side): in the
 * component view, one labelled frame per variant at the active breakpoint,
 * the primary first, then each variant in order, and a dashed "+ Variant"
 * tile at the end. Frames are keyed by variant (`primary` for the
 * definition itself). The board is on by default once there are two
 * variants, counting the primary; a choice made with the toggle wins.
 */
import type { Rect } from './viewport'
import { layoutFrames } from './viewport'

export interface BoardFrame {
  /** The frame's key: `primary`, or the variant's id. */
  key: string
  /** The variant the frame shows; null is the primary. */
  variantId: string | null
  label: string
  primary: boolean
}

const PRIMARY_KEY = 'primary'

export function boardFrameKey(variantId: string | null): string {
  return variantId ?? PRIMARY_KEY
}

/** The board's frames: Primary, then each variant, labelled by its name. */
export function boardFrames(variants: readonly { id: string, name: string }[]): BoardFrame[] {
  return [
    { key: PRIMARY_KEY, variantId: null, label: 'Primary', primary: true },
    ...variants.map(v => ({ key: boardFrameKey(v.id), variantId: v.id, label: v.name, primary: false }))
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

/**
 * Where the board's frames go (left to right, top-aligned, `gap` apart, all
 * `width` wide) and the "+ Variant" tile after them, no larger than a frame.
 */
export function boardLayout(heights: readonly number[], width: number, gap: number): { frames: Rect[], add: Rect } {
  const frames = layoutFrames(heights.map(height => ({ width, height })), gap)
  const last = frames.at(-1)
  return {
    frames,
    add: {
      x: last ? last.x + last.width + gap : 0,
      y: 0,
      width: Math.min(width, ADD_TILE_MAX.width),
      height: Math.min(Math.min(...heights), ADD_TILE_MAX.height)
    }
  }
}
