/**
 * The selection's measured sizes for the style panel's greyed auto W and H
 * (see `measuredSize`). The canvas is measured a moment after each change,
 * once it has re-rendered; a new selection, device or tree (`sizeContext`)
 * clears the sizes at once, so the fields never show the previous node's px
 * while the new measurement is on its way. A measurement that comes back
 * after a newer one was asked for is dropped.
 */

export interface MeasuredSizes {
  w: number[]
  h: number[]
}

/** No sizes: the fields show their plain placeholder. Never mutated. */
export const EMPTY_SIZES: MeasuredSizes = { w: [], h: [] }

/** Ms after a change before measuring, once the canvas has rendered it. */
export const MEASURE_DELAY = 80

/** What the sizes belong to: the selected ids, the device and the tree being edited. */
export function sizeContext(ids: readonly string[], deviceId: string, treeId: string | undefined): string {
  return JSON.stringify([ids, deviceId, treeId ?? null])
}

export function createSizeMeasurer(
  measure: (ids: string[]) => Promise<{ width: number, height: number }[]>,
  onChange: (sizes: MeasuredSizes) => void,
  delay = MEASURE_DELAY
) {
  let run = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let context: string | undefined

  async function measureNow(ids: string[]) {
    const current = ++run
    const boxes = ids.length ? await measure(ids) : []
    if (current !== run) return
    // A missing (hidden) box would make the shared size a guess.
    const all = boxes.length === ids.length && ids.length > 0
    onChange(all ? { w: boxes.map(b => b.width), h: boxes.map(b => b.height) } : EMPTY_SIZES)
  }

  return {
    /** Re-measures `ids` after the delay; a `nextContext` other than the last clears the sizes now. */
    schedule(ids: string[], nextContext: string): void {
      if (nextContext !== context) {
        context = nextContext
        run++
        onChange(EMPTY_SIZES)
      }
      clearTimeout(timer)
      timer = setTimeout(() => void measureNow(ids), delay)
    },
    stop(): void {
      clearTimeout(timer)
      run++
    }
  }
}
