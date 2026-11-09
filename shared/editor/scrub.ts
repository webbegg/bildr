import { SHIFT_STOPS } from './scale'

/**
 * Drag-to-scrub over a token scale (after Stacki's useScrub): a press becomes a
 * drag past a small dead zone, every move reports the travel since the press,
 * and the click that ends a drag is swallowed so it does not also open a menu.
 * The callbacks decide what the travel means; nothing is written until `end`.
 */

/** Px of travel before a press counts as a drag rather than a click. */
export const SCRUB_DEAD_ZONE = 3
/** Px of travel per scale stop. */
export const PX_PER_STOP = 6

/** The scale stops a drag of `distance` px moves; Shift moves four times as many. */
export function scrubStops(distance: number, shift: boolean): number {
  const stops = Math.trunc(distance / PX_PER_STOP) * (shift ? SHIFT_STOPS : 1)
  return stops || 0
}

export interface ScrubMove {
  dx: number
  dy: number
  shiftKey: boolean
  altKey: boolean
}

export interface ScrubHandlers {
  /** The travel since the press, on every move once past the dead zone. */
  move: (move: ScrubMove) => void
  /** On release; `dragged` is false for a plain click. */
  end: (dragged: boolean) => void
  /** The resize cursor shown while dragging. */
  cursor?: 'ew-resize' | 'ns-resize'
}

/**
 * Starts tracking a press (browser only). The pointer is captured, so a drag
 * keeps scrubbing over the canvas iframe and outside the window.
 */
export function startScrub(event: PointerEvent, handlers: ScrubHandlers): void {
  if (event.button !== 0) return
  const target = event.currentTarget instanceof Element ? event.currentTarget : null
  const { clientX: x, clientY: y, pointerId } = event
  let dragged = false

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    const dx = e.clientX - x
    const dy = e.clientY - y
    if (!dragged) {
      if (Math.hypot(dx, dy) < SCRUB_DEAD_ZONE) return
      dragged = true
      target?.setPointerCapture?.(pointerId)
      document.body.style.cursor = handlers.cursor ?? 'ew-resize'
      document.body.style.userSelect = 'none'
    }
    e.preventDefault()
    handlers.move({ dx, dy, shiftKey: e.shiftKey, altKey: e.altKey })
  }
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (dragged) {
      // The press that ended a drag must not also count as a click.
      const swallow = (click: MouseEvent) => {
        click.preventDefault()
        click.stopPropagation()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    }
    handlers.end(dragged)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}
