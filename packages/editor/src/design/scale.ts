import { clampZoom } from '@bildr/editor-core/viewport'

/**
 * Framing a device in the stage. The canvas always lays out at the device's
 * width, so its breakpoints match the device; when the stage is narrower the
 * frame is scaled down visually (a CSS transform, origin top left), never
 * laid out narrower. Everything the canvas measures and draws (rects,
 * outlines, click points) is in its own, unscaled coordinates: the browser
 * maps pointer events through the transform, and the canvas gets the zoom
 * (`bildr:active`) to keep its 1 px lines and labels at their size on screen.
 */

/** The stage's padding on each side, in px. */
export const STAGE_PADDING = 24

/** The scale showing a `deviceWidth` frame in `stageWidth` px of stage: 1 when it fits (or the stage is not measured), else what fits, down to the editor's zoom floor. */
export function fitScale(deviceWidth: number, stageWidth: number): number {
  const room = stageWidth - 2 * STAGE_PADDING
  if (stageWidth <= 0 || room >= deviceWidth) return 1
  return clampZoom(Math.max(0, room) / deviceWidth)
}

/** The on-screen label of a scale: `74%`. */
export const zoomLabel = (scale: number): string => `${Math.round(scale * 100)}%`
