/**
 * Which device frames the editor shows, an editor preference (no format
 * change): the canvas frames, the Layers root rows, the floating bar's device
 * switch and the ⌥ + digit shortcuts all follow the visible frames. The
 * Primary (Mobile, the mobile-first base) is always shown; Large phone (`sm`)
 * starts hidden and the frame bar's "+" adds it back. Lists of shown ids are
 * kept in frame order (widest first).
 */
import type { Device, DeviceId } from './styleFields'
import { DEVICES } from './styleFields'
import { DEVICE_ORDER, deviceForKey, deviceShortcut } from './devices'
import { BREAKPOINT_WIDTHS } from './dropTarget'

/** The base frame: its edits apply to every size unless overridden. */
export const PRIMARY_FRAME: DeviceId = DEVICES.find(d => !d.breakpoint)!.id

const HIDDEN_BY_DEFAULT: readonly DeviceId[] = ['large-phone']

/** The frames a project shows until its preference says otherwise. */
export const DEFAULT_FRAMES: readonly DeviceId[] = DEVICE_ORDER.map(d => d.id).filter(id => !HIDDEN_BY_DEFAULT.includes(id))

const inOrder = (ids: Iterable<DeviceId>): DeviceId[] => {
  const set = new Set(ids)
  return DEVICE_ORDER.map(d => d.id).filter(id => set.has(id))
}

/** The visible frames' devices in frame order; the Primary is always one. */
export function visibleFrames(shown: readonly DeviceId[]): Device[] {
  const ids = new Set([...shown, PRIMARY_FRAME])
  return DEVICE_ORDER.filter(d => ids.has(d.id))
}

/** The devices without a frame, in frame order: what "+" offers. */
export function hiddenFrames(shown: readonly DeviceId[]): Device[] {
  const visible = visibleFrames(shown)
  return DEVICE_ORDER.filter(d => !visible.includes(d))
}

export function showFrame(shown: readonly DeviceId[], id: DeviceId): DeviceId[] {
  return inOrder([...shown, id, PRIMARY_FRAME])
}

export function canHideFrame(id: DeviceId): boolean {
  return id !== PRIMARY_FRAME
}

/** The shown frames without `id`; the Primary is never hidden. */
export function hideFrame(shown: readonly DeviceId[], id: DeviceId): DeviceId[] {
  return inOrder([...shown, PRIMARY_FRAME].filter(other => other !== id || !canHideFrame(id)))
}

/**
 * The viewport widths a frame's breakpoint is the widest one applying to,
 * `max—min` as in Framer, e.g. `1023—768` for Tablet; `1024+` for the widest.
 */
export function frameRange(device: Pick<Device, 'breakpoint'>): string {
  const index = device.breakpoint ? BREAKPOINT_WIDTHS.findIndex(([b]) => b === device.breakpoint) : -1
  const min = index < 0 ? 0 : BREAKPOINT_WIDTHS[index]![1]
  const next = BREAKPOINT_WIDTHS[index + 1]
  return next ? `${next[1] - 1}—${min}` : `${min}+`
}

/** A visible frame's ⌥ + digit as `UKbd` values; undefined for a hidden one. */
export function frameShortcut(shown: readonly DeviceId[], id: DeviceId): string[] | undefined {
  const visible = visibleFrames(shown)
  const index = visible.findIndex(d => d.id === id)
  return index < 0 || index > 8 ? undefined : deviceShortcut(id, visible)
}

/** The visible frame Alt/Option + digit switches to, counting left to right. */
export function frameForKey(shown: readonly DeviceId[], event: { code: string, alt: boolean, meta: boolean, shift: boolean }): DeviceId | null {
  return deviceForKey(event, visibleFrames(shown))
}

/** The stored preference: the shown ids, from `parseFrames`. */
export function serializeFrames(shown: readonly DeviceId[]): string {
  return JSON.stringify(inOrder(shown))
}

/** A stored preference read back; missing or malformed data gives the defaults, unknown ids are dropped. */
export function parseFrames(raw: string | null | undefined): DeviceId[] {
  let value: unknown
  try {
    value = raw ? JSON.parse(raw) : undefined
  } catch {
    value = undefined
  }
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) return [...DEFAULT_FRAMES]
  const known = new Set<string>(DEVICES.map(d => d.id))
  return inOrder([...(value as string[]).filter(id => known.has(id)) as DeviceId[], PRIMARY_FRAME])
}
