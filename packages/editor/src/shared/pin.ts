/**
 * The pin picker of a positioned node (layout-containers L5): per axis, the
 * side it is pinned to, both sides (stretch), or the centre, over the inset
 * tokens. Centre is both sides at zero with an auto margin, which centres a
 * node of its own size without a transform; it stretches unless the node has
 * a size, so centring an unsized node makes it fit.
 */

export type PinAxis = 'h' | 'v'
export type Pin = 'start' | 'center' | 'end' | 'stretch'

const AXES = {
  h: { start: 'left', end: 'right', both: 'insetX', margin: 'mx', size: 'w', other: 'insetY' },
  v: { start: 'top', end: 'bottom', both: 'insetY', margin: 'my', size: 'h', other: 'insetX' }
} as const

/** The tokens the picker reads (their values at the edited device). */
export type PinValues = Partial<Record<'inset' | 'insetX' | 'insetY' | 'top' | 'right' | 'bottom' | 'left' | 'mx' | 'my' | 'w' | 'h', string>>

const axisPin = (values: PinValues, axis: PinAxis): Pin | undefined => {
  const keys = AXES[axis]
  const both = values.inset === '0' || values[keys.both] === '0' || (values[keys.start] !== undefined && values[keys.end] !== undefined)
  if (both) return values[keys.margin] === 'auto' ? 'center' : 'stretch'
  if (values[keys.start] !== undefined) return 'start'
  if (values[keys.end] !== undefined) return 'end'
  return undefined
}

/** Where each axis is pinned; undefined where no inset is set (the node stays where the flow put it). */
export function pinOf(values: PinValues): { h: Pin | undefined, v: Pin | undefined } {
  return { h: axisPin(values, 'h'), v: axisPin(values, 'v') }
}

/** The patch (base keys) that pins `axis` to `pin`; an all-sides inset is first split so the other axis keeps it. */
export function pinWrite(values: PinValues, axis: PinAxis, pin: Pin): Record<string, string | null> {
  const keys = AXES[axis]
  const patch: Record<string, string | null> = values.inset !== undefined ? { inset: null, [keys.other]: values.inset } : {}
  if (pin === 'start' || pin === 'end') {
    const side = keys[pin]
    const away = keys[pin === 'start' ? 'end' : 'start']
    return { ...patch, [side]: values[side] ?? '0', [away]: null, [keys.both]: null, [keys.margin]: null }
  }
  return {
    ...patch,
    [keys.both]: '0',
    [keys.start]: null,
    [keys.end]: null,
    [keys.margin]: pin === 'center' ? 'auto' : null,
    ...(pin === 'center' && values[keys.size] === undefined ? { [keys.size]: 'fit' } : {})
  }
}
