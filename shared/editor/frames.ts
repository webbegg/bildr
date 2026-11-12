/**
 * Which device frames the editor shows, an editor preference (no format
 * change): the canvas frames, the Layers root rows, the floating bar's device
 * switch and the ⌥ + digit shortcuts all follow the visible frames. The
 * Primary (the device of the project's base style: Mobile mobile-first,
 * Desktop desktop-first) is always shown. A mobile-first project starts with
 * every frame but Large phone (`sm`); a desktop-first one starts with Desktop
 * only, and the frame bar's "+" adds the others as they are needed. Lists of
 * shown ids are kept in frame order (widest first). Every helper takes the
 * project's breakpoint base, mobile-first by default.
 */
import type { BreakpointBase } from '../design/tokens'
import type { Device, DeviceId } from './styleFields'
import { devicesFor } from './styleFields'
import { deviceForKey, deviceOrder, deviceShortcut } from './devices'

/** The base frame of a `base` project: its edits apply to every size unless overridden. */
export function primaryFrame(base: BreakpointBase = 'mobile'): DeviceId {
  return devicesFor(base).find(d => !d.breakpoint)!.id
}

/** The Primary of a mobile-first project. */
export const PRIMARY_FRAME: DeviceId = primaryFrame('mobile')

const MOBILE_HIDDEN_BY_DEFAULT: readonly DeviceId[] = ['large-phone']

/** The frames a project shows until its preference says otherwise. */
export function defaultFrames(base: BreakpointBase = 'mobile'): DeviceId[] {
  if (base === 'desktop') return [primaryFrame(base)]
  return deviceOrder(base).map(d => d.id).filter(id => !MOBILE_HIDDEN_BY_DEFAULT.includes(id))
}

/** The default frames of a mobile-first project. */
export const DEFAULT_FRAMES: readonly DeviceId[] = defaultFrames('mobile')

const inOrder = (ids: Iterable<DeviceId>): DeviceId[] => {
  const set = new Set(ids)
  // Frame order (widest first) is the same for both bases.
  return deviceOrder('mobile').map(d => d.id).filter(id => set.has(id))
}

/** The visible frames' devices in frame order; the Primary is always one. */
export function visibleFrames(shown: readonly DeviceId[], base: BreakpointBase = 'mobile'): Device[] {
  const ids = new Set([...shown, primaryFrame(base)])
  return deviceOrder(base).filter(d => ids.has(d.id))
}

/** The devices without a frame, in frame order: what "+" offers. */
export function hiddenFrames(shown: readonly DeviceId[], base: BreakpointBase = 'mobile'): Device[] {
  const visible = new Set(visibleFrames(shown, base).map(d => d.id))
  return deviceOrder(base).filter(d => !visible.has(d.id))
}

export function showFrame(shown: readonly DeviceId[], id: DeviceId, base: BreakpointBase = 'mobile'): DeviceId[] {
  return inOrder([...shown, id, primaryFrame(base)])
}

export function canHideFrame(id: DeviceId, base: BreakpointBase = 'mobile'): boolean {
  return id !== primaryFrame(base)
}

/** The shown frames without `id`; the Primary is never hidden. */
export function hideFrame(shown: readonly DeviceId[], id: DeviceId, base: BreakpointBase = 'mobile'): DeviceId[] {
  return inOrder([...shown, primaryFrame(base)].filter(other => other !== id || !canHideFrame(id, base)))
}

/** The narrowest viewport width each device's band starts at (Tailwind's sm, md, lg). */
const BAND_MIN: Record<DeviceId, number> = { 'mobile': 0, 'large-phone': 640, 'tablet': 768, 'desktop': 1024 }

/**
 * The viewport widths a frame's device covers, `max—min` as in Framer, e.g.
 * `1023—768` for Tablet; `1024+` for Desktop. Both bases split the widths
 * the same way.
 */
export function frameRange(device: Pick<Device, 'id'>): string {
  const min = BAND_MIN[device.id]
  const next = Object.values(BAND_MIN).filter(width => width > min).sort((a, b) => a - b)[0]
  return next === undefined ? `${min}+` : `${next - 1}—${min}`
}

/**
 * A Layers frame row's caption: the width range, or for the Primary
 * `Primary` (mobile-first, as before S37) or `Primary · 1024+` (desktop-first).
 */
export function frameCaption(device: Pick<Device, 'id' | 'breakpoint'>, base: BreakpointBase = 'mobile'): string {
  if (device.breakpoint) return frameRange(device)
  return base === 'desktop' ? `Primary · ${frameRange(device)}` : 'Primary'
}

/** A visible frame's ⌥ + digit as `UKbd` values; undefined for a hidden one. */
export function frameShortcut(shown: readonly DeviceId[], id: DeviceId, base: BreakpointBase = 'mobile'): string[] | undefined {
  const visible = visibleFrames(shown, base)
  const index = visible.findIndex(d => d.id === id)
  return index < 0 || index > 8 ? undefined : deviceShortcut(id, visible)
}

/** The visible frame Alt/Option + digit switches to, counting left to right. */
export function frameForKey(shown: readonly DeviceId[], event: { code: string, alt: boolean, meta: boolean, shift: boolean }, base: BreakpointBase = 'mobile'): DeviceId | null {
  return deviceForKey(event, visibleFrames(shown, base))
}

/** The stored preference: the shown ids, from `parseFrames`. */
export function serializeFrames(shown: readonly DeviceId[]): string {
  return JSON.stringify(inOrder(shown))
}

/** A stored preference read back; missing or malformed data gives the defaults, unknown ids are dropped. */
export function parseFrames(raw: string | null | undefined, base: BreakpointBase = 'mobile'): DeviceId[] {
  let value: unknown
  try {
    value = raw ? JSON.parse(raw) : undefined
  } catch {
    value = undefined
  }
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) return defaultFrames(base)
  const known = new Set<string>(devicesFor(base).map(d => d.id))
  return inOrder([...(value as string[]).filter(id => known.has(id)) as DeviceId[], primaryFrame(base)])
}
