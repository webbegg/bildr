/**
 * Zoom and pan math for the editor canvas (Figma-style). A viewport maps a
 * content point `p` to the screen point `x + p * zoom` (likewise for y),
 * i.e. the CSS transform `translate(x, y) scale(zoom)` with origin 0 0.
 */
import type { Breakpoint } from '../design/tokens'
import { cascadeTo } from '../design/tokens'
import type { EditorToCanvas } from './protocol'
import type { DeviceId } from './styleFields'

export interface Viewport { x: number, y: number, zoom: number }
export interface Point { x: number, y: number }
export interface Size { width: number, height: number }
export interface Rect extends Point, Size {}

/** A device frame is at least this tall; taller content makes it grow. */
export const FRAME_MIN_HEIGHT = 800
/**
 * Each frame's nominal screen height, like the real device's viewport: the
 * canvas resolves `screen` heights to it, since a frame as tall as its
 * content would otherwise grow with them. Other frames get FRAME_MIN_HEIGHT.
 */
const VIEWPORT_HEIGHTS: Record<DeviceId, number> = { 'desktop': 800, 'tablet': 1024, 'large-phone': 900, 'mobile': 844 }

export function viewportHeight(device: string): number {
  return VIEWPORT_HEIGHTS[device as DeviceId] ?? FRAME_MIN_HEIGHT
}

/** The `bildr:active` message for a device's frame. */
export function activeMessage(device: string, activeDevice: string, zoom: number): EditorToCanvas {
  return { type: 'bildr:active', active: device === activeDevice, zoom, viewportHeight: viewportHeight(device) }
}

const SCREEN_SIZES = [['h', 'height'], ['min-h', 'min-height'], ['max-h', 'max-height']] as const

/**
 * CSS sending the `screen` height tokens inside `scope` to `variable` in a
 * frame at `breakpoint`. A rule yields to the same property set at a later
 * active level of the cascade (`cascadeTo`), as Tailwind's later variants
 * do. The yields match whole class names (at the start of the attribute or
 * after a space), so `md:h-` never matches `max-md:h-`.
 */
export function viewportUnitRules(breakpoint: Breakpoint | undefined, scope: string, variable: string): string[] {
  const levels = cascadeTo(breakpoint)
  return levels.flatMap((level, i) => SCREEN_SIZES.map(([prefix, property]) => {
    const yields = levels.slice(i + 1).map(later => `:not([class^="${later}:${prefix}-"]):not([class*=" ${later}:${prefix}-"])`).join('')
    return `${scope} .${level ? `${level}\\:` : ''}${prefix}-screen${yields} { ${property}: var(${variable}) }`
  }))
}

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

export type ZoomCommand = 'fit' | 'reset' | 'in' | 'out' | 'selection'

/** Figma's zoom keys: Shift+1 fit, Shift+2 the selection, Shift+0 100%, Cmd/Ctrl +/- step. Matched on `code`, so any layout works. */
export function zoomShortcut(event: { code: string, key: string, meta: boolean, shift: boolean }): ZoomCommand | null {
  if (event.meta) {
    if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+') return 'in'
    if (event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-') return 'out'
    return null
  }
  if (!event.shift) return null
  if (event.code === 'Digit1') return 'fit'
  if (event.code === 'Digit2') return 'selection'
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

/**
 * The device frames left to right, Framer-style: widest (Desktop) first and
 * the narrowest, the mobile-first base, last. Storage stays mobile-first.
 */
export function frameOrder<T extends { width: number }>(devices: readonly T[]): T[] {
  return [...devices].sort((a, b) => b.width - a.width)
}

/** The tooltip on the Primary frame's header bar. */
export const PRIMARY_FRAME_HINT = 'Edits here apply to all sizes unless overridden.'

/** A frame header bar's height on screen, at any zoom. */
export const FRAME_BAR_HEIGHT = 28

export interface FrameBar {
  name: string
  size: string
  /** The base frame (no breakpoint): its edits apply to every size. */
  primary: boolean
  /** The bar's width inside the zoomed content: drawn at `scale`, it spans the frame on screen. */
  width: number
  /** Undoes the zoom, so the bar keeps its height and font size. */
  scale: number
  showSize: boolean
  showPrimary: boolean
  showAdd: boolean
}

/**
 * A frame's header bar, Framer's `▶ Desktop 1280  +`: as wide as the frame on
 * screen and a fixed height, so it reads at any zoom. A narrow bar drops the
 * Primary note, then the width, then the `+`, so the name stays readable.
 */
export function frameBar(device: { label: string, width: number, breakpoint?: string }, zoom: number): FrameBar {
  const width = device.width * zoom
  return {
    name: device.label,
    size: String(device.width),
    primary: !device.breakpoint,
    width,
    scale: 1 / zoom,
    showSize: width >= 140,
    showPrimary: width >= 200,
    showAdd: width >= 120
  }
}

/** The `window.open` features of a frame's draft preview: a popup at the frame width, at most 900 px tall. */
export function previewWindowFeatures(width: number, screenHeight: number): string {
  return `popup,width=${width},height=${Math.min(900, screenHeight)}`
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

/**
 * Shift+2: the viewport fitting the selection's `boxes` (measured in their
 * frame's canvas pixels) on the `frame` placed at its content rect; null
 * without boxes.
 */
export function selectionView(boxes: Rect[], frame: Rect, stage: Size, padding: number): Viewport | null {
  if (!boxes.length) return null
  const bounds = boundsOf(boxes)
  return fitView({ ...bounds, x: frame.x + bounds.x, y: frame.y + bounds.y }, stage, padding)
}

/** The viewport after a pan drag from screen point `from` to `to` (Hand tool, Space or middle drag): the content follows the pointer. */
export function panView(view: Viewport, from: Point, to: Point): Viewport {
  return { ...view, x: view.x + to.x - from.x, y: view.y + to.y - from.y }
}

/** Zooms to `zoom` (clamped) keeping the content under the screen point `at` in place. */
export function zoomAround(view: Viewport, zoom: number, at: Point): Viewport {
  const next = clampZoom(zoom)
  const ratio = next / view.zoom
  return { x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio, zoom: next }
}
