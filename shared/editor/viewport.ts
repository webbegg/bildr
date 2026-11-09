/**
 * Zoom and pan math for the editor canvas (Figma-style). A viewport maps a
 * content point `p` to the screen point `x + p * zoom` (likewise for y),
 * i.e. the CSS transform `translate(x, y) scale(zoom)` with origin 0 0.
 */

export interface Viewport { x: number, y: number, zoom: number }
export interface Point { x: number, y: number }
export interface Size { width: number, height: number }
export interface Rect extends Point, Size {}

/** A device frame is at least this tall; taller content makes it grow. */
export const FRAME_MIN_HEIGHT = 800
/** The space between frames side by side, in content pixels. */
export const FRAME_GAP = 80

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** The levels Cmd/Ctrl +/- step through. */
export const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

/** The next preset level above (1) or below (-1) `zoom`, or `zoom` at a limit. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = direction > 0 ? ZOOM_LEVELS.find(level => level > zoom + 1e-6) : ZOOM_LEVELS.findLast(level => level < zoom - 1e-6)
  return next ?? clampZoom(zoom)
}

/** The zoom after a Cmd/Ctrl + wheel or pinch of `deltaY` pixels: 100 px up doubles it. */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * 2 ** (-deltaY / 100))
}

/** A wheel delta in pixels, from its `WheelEvent.deltaMode` (0 pixels, 1 lines, 2 pages). */
export function wheelPixels(delta: number, mode: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? 800 : 1)
}

export type ZoomCommand = 'fit' | 'reset' | 'in' | 'out'

/** Figma's zoom keys: Shift+1 fit, Shift+0 100%, Cmd/Ctrl +/- step. Matched on `code`, so any layout works. */
export function zoomShortcut(event: { code: string, key: string, meta: boolean, shift: boolean }): ZoomCommand | null {
  if (event.meta) {
    if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+') return 'in'
    if (event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-') return 'out'
    return null
  }
  if (!event.shift) return null
  if (event.code === 'Digit1') return 'fit'
  if (event.code === 'Digit0') return 'reset'
  return null
}

/** Places frames left to right, top-aligned, `gap` apart, in content coordinates. */
export function layoutFrames(sizes: Size[], gap: number): Rect[] {
  let x = 0
  return sizes.map(({ width, height }) => {
    const rect = { x, y: 0, width, height }
    x += width + gap
    return rect
  })
}

/** The smallest rectangle holding every rect. */
export function boundsOf(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 }
  const left = Math.min(...rects.map(r => r.x))
  const top = Math.min(...rects.map(r => r.y))
  const right = Math.max(...rects.map(r => r.x + r.width))
  const bottom = Math.max(...rects.map(r => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The viewport showing all of `content` centred in `stage`, `padding` px from its edges. */
export function fitView(content: Rect, stage: Size, padding: number): Viewport {
  const room = { width: Math.max(1, stage.width - 2 * padding), height: Math.max(1, stage.height - 2 * padding) }
  const zoom = clampZoom(Math.min(room.width / Math.max(1, content.width), room.height / Math.max(1, content.height)))
  return {
    x: (stage.width - content.width * zoom) / 2 - content.x * zoom,
    y: (stage.height - content.height * zoom) / 2 - content.y * zoom,
    zoom
  }
}

/** Zooms to `zoom` (clamped) keeping the content under the screen point `at` in place. */
export function zoomAround(view: Viewport, zoom: number, at: Point): Viewport {
  const next = clampZoom(zoom)
  const ratio = next / view.zoom
  return { x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio, zoom: next }
}
