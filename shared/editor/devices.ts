/**
 * The device switch on the canvas's floating bar: the devices in frame order,
 * their Alt/Option + digit shortcuts, and the pan that brings a device's frame
 * into view without changing the zoom.
 */
import type { Device, DeviceId } from './styleFields'
import { DEVICES } from './styleFields'
import type { Rect, Size, Viewport } from './viewport'
import { frameOrder } from './viewport'

/**
 * Every device, widest first, as the frames sit: Desktop, Tablet, Large phone,
 * then the Primary Mobile. The editor shows the visible ones
 * (`visibleFrames` in ./frames), and ⌥ + digit follows those.
 */
export const DEVICE_ORDER: Device[] = frameOrder(DEVICES)

/** A device's shortcut in `order` as `UKbd` values, e.g. `['alt', '2']` for Tablet. */
export function deviceShortcut(id: DeviceId, order: readonly Pick<Device, 'id'>[] = DEVICE_ORDER): string[] {
  return ['alt', String(order.findIndex(d => d.id === id) + 1)]
}

/**
 * The device in `order` Alt/Option + 1, 2, 3… switches to. Matched on `code`,
 * since on macOS Option + digit types a symbol (`¡`, `™`, `£`) as the `key`.
 */
export function deviceForKey(event: { code: string, alt: boolean, meta: boolean, shift: boolean }, order: readonly Pick<Device, 'id'>[] = DEVICE_ORDER): DeviceId | null {
  if (!event.alt || event.meta || event.shift) return null
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1]
  return digit ? order[Number(digit) - 1]?.id ?? null : null
}

/** A device's name and width, e.g. `Tablet · 768`. */
export function deviceHint(device: Pick<Device, 'label' | 'width'>): string {
  return `${device.label} · ${device.width}`
}

/**
 * The viewport showing `rect` (content coordinates) in `stage`, at the same
 * zoom. A frame already in view horizontally stays put; otherwise it is
 * centred, or its left edge goes to `padding` when it is wider than the stage.
 * The view only moves vertically when the frame is out of sight, bringing
 * its top to `padding`.
 */
export function revealFrame(view: Viewport, rect: Rect, stage: Size, padding: number): Viewport {
  const left = view.x + rect.x * view.zoom
  const width = rect.width * view.zoom
  const top = view.y + rect.y * view.zoom
  const height = rect.height * view.zoom
  let { x, y } = view
  if (left < padding || left + width > stage.width - padding) {
    x = (width <= stage.width - 2 * padding ? (stage.width - width) / 2 : padding) - rect.x * view.zoom
  }
  if (top + height < padding || top > stage.height - padding) y = padding - rect.y * view.zoom
  return { x, y, zoom: view.zoom }
}
