/**
 * The keys of a roving-tabindex widget, shared by the Data tree (vertical, stops at the ends) and
 * the Data tab strip (horizontal, wraps): the arrows of the widget's axis move one item, Home and
 * End go to the first and the last. Returns the index to move to, or null for any other key
 * (the caller then leaves the event alone).
 */
export interface RovingOptions {
  axis: 'horizontal' | 'vertical'
  /** Goes round at the ends instead of stopping there. */
  wrap?: boolean
}

const STEPS = {
  horizontal: { ArrowLeft: -1, ArrowRight: 1 },
  vertical: { ArrowUp: -1, ArrowDown: 1 }
} as const

export function rovingTarget(key: string, at: number, count: number, { axis, wrap = false }: RovingOptions): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  const step = (STEPS[axis] as Record<string, number | undefined>)[key]
  if (step === undefined) return null
  const to = at + step
  return wrap ? (to + count) % count : Math.min(count - 1, Math.max(0, to))
}
