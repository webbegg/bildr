import { ref } from 'vue'
import type { DropPosition } from './tree.ts'

/** The layer being dragged (a drag's data can't be read before the drop) and where the drop would go. */
export const draggingLayer = ref<string | null>(null)
export const dropMark = ref<{ id: string, position: DropPosition } | null>(null)

export const DRAG_MIME = 'application/x-bildr'

/** What a drag from the palette or the layers carries: JSON the canvas hands back as `bildr:drop`'s payload. */
export const dragPayload = (payload: { insert: string } | { component: string } | { move: string }): string => JSON.stringify(payload)

/**
 * The part of a row a pointer is over: the outer quarters drop before or after
 * it, the middle drops inside a container (a leaf splits at its middle).
 */
export function positionIn(offset: number, height: number, container: boolean): DropPosition {
  const ratio = height > 0 ? offset / height : 0.5
  if (container) return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
  return ratio < 0.5 ? 'before' : 'after'
}
