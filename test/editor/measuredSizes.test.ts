import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSizeMeasurer, EMPTY_SIZES, sizeContext } from '#shared/editor/measuredSizes'
import type { MeasuredSizes } from '#shared/editor/measuredSizes'

/** A measurer whose boxes resolve when the test says so. */
function setup() {
  const pending: { ids: string[], resolve: (boxes: { width: number, height: number }[]) => void }[] = []
  const measure = (ids: string[]) => new Promise<{ width: number, height: number }[]>(resolve => pending.push({ ids, resolve }))
  const shown: MeasuredSizes[] = []
  let sizes: MeasuredSizes = EMPTY_SIZES
  const measurer = createSizeMeasurer(measure, (next) => {
    sizes = next
    shown.push(next)
  })
  return { pending, measurer, shown, sizes: () => sizes }
}

describe('createSizeMeasurer (RELIABILITY-008)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('measures the selection after the delay', async () => {
    const { pending, measurer, sizes } = setup()
    measurer.schedule(['a'], sizeContext(['a'], 'mobile', 'page'))
    expect(pending).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(80)
    pending[0]!.resolve([{ width: 120, height: 40 }])
    await vi.runAllTimersAsync()
    expect(sizes()).toEqual({ w: [120], h: [40] })
  })

  it('clears the sizes at once when the selection, device or tree changes, until the new measurement arrives', async () => {
    const { pending, measurer, sizes } = setup()
    measurer.schedule(['a'], sizeContext(['a'], 'mobile', 'page'))
    await vi.advanceTimersByTimeAsync(80)
    pending[0]!.resolve([{ width: 120, height: 40 }])
    await vi.runAllTimersAsync()

    for (const [ids, device, tree] of [[['b'], 'mobile', 'page'], [['b'], 'desktop', 'page'], [['b'], 'desktop', 'other']] as const) {
      measurer.schedule([...ids], sizeContext([...ids], device, tree))
      expect(sizes()).toEqual(EMPTY_SIZES)
      await vi.advanceTimersByTimeAsync(80)
      pending.at(-1)!.resolve([{ width: 300, height: 50 }])
      await vi.runAllTimersAsync()
      expect(sizes()).toEqual({ w: [300], h: [50] })
    }
  })

  it('keeps the shown sizes while the same context re-measures (a style edit)', async () => {
    const { pending, measurer, sizes } = setup()
    const context = sizeContext(['a'], 'mobile', 'page')
    measurer.schedule(['a'], context)
    await vi.advanceTimersByTimeAsync(80)
    pending[0]!.resolve([{ width: 120, height: 40 }])
    await vi.runAllTimersAsync()
    measurer.schedule(['a'], context)
    expect(sizes()).toEqual({ w: [120], h: [40] })
  })

  it('drops a measurement that comes back after the context changed', async () => {
    const { pending, measurer, sizes } = setup()
    measurer.schedule(['a'], sizeContext(['a'], 'mobile', 'page'))
    await vi.advanceTimersByTimeAsync(80)
    measurer.schedule(['b'], sizeContext(['b'], 'mobile', 'page'))
    pending[0]!.resolve([{ width: 120, height: 40 }])
    await vi.advanceTimersByTimeAsync(0)
    expect(sizes()).toEqual(EMPTY_SIZES)
  })

  it('shows nothing when a box is missing (a hidden node), and stops on stop()', async () => {
    const { pending, measurer, sizes } = setup()
    measurer.schedule(['a', 'b'], sizeContext(['a', 'b'], 'mobile', 'page'))
    await vi.advanceTimersByTimeAsync(80)
    pending[0]!.resolve([{ width: 120, height: 40 }])
    await vi.runAllTimersAsync()
    expect(sizes()).toEqual(EMPTY_SIZES)
    measurer.schedule(['c'], sizeContext(['c'], 'mobile', 'page'))
    measurer.stop()
    await vi.advanceTimersByTimeAsync(200)
    expect(pending).toHaveLength(1)
  })
})
