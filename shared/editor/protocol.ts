import type { DataRecord } from '../data/records'
import type { Theme } from '../design/theme'
import type { Page } from '../document/schema'
import type { StylePatch } from './preview'

/**
 * postMessage protocol between the editor and its canvas iframe (the
 * Stacki frame-target idea). The editor owns the document and pushes it to
 * the canvas; the canvas reports pointer and keyboard gestures back.
 * `lists` carries each List's records by `listKey`; a List repeats its
 * children per record, and copies after the first carry `data-bildr-copy`.
 * `bildr:preview` shows a style patch on a node without saving it (null
 * clears it); a render that already shows the patch clears it too.
 * `bildr:contextmenu` is a right-click on a node, at canvas viewport coordinates.
 *
 * The editor shows one canvas per device frame and sends every frame the
 * same messages; `bildr:active` tells a frame whether it is the active one
 * (only that frame labels the selection) and the zoom it is shown at (so
 * outlines keep their screen size). Each page-view frame reports its content
 * height (`bildr:size`) and forwards the gestures that drive the editor's
 * zoom and pan: wheel at canvas viewport coordinates, pan drags (middle
 * button) as screen-pixel deltas, and the space key held or released.
 */

/** What a canvas shows: the page being edited, or the theme's token preview sheet. */
export type CanvasView = 'page' | 'tokens'

export type EditorToCanvas
  = | { type: 'bildr:render', page: Page, base: string, theme: Theme, view: CanvasView, lists: Record<string, DataRecord[]> }
    | { type: 'bildr:select', nodeId: string | null }
    | { type: 'bildr:hover', nodeId: string | null }
    | { type: 'bildr:preview', nodeId: string, style: StylePatch | null }
    | { type: 'bildr:active', active: boolean, zoom: number }

export type CanvasToEditor
  = | { type: 'bildr:ready' }
    | { type: 'bildr:hover', nodeId: string | null }
    | { type: 'bildr:click', nodeId: string }
    | { type: 'bildr:contextmenu', nodeId: string, x: number, y: number }
    | { type: 'bildr:key', key: string, code: string, meta: boolean, shift: boolean }
    | { type: 'bildr:drop', parentId: string, index: number, payload: string }
    | { type: 'bildr:size', height: number }
    | { type: 'bildr:wheel', dx: number, dy: number, zoom: boolean, x: number, y: number }
    | { type: 'bildr:pan', dx: number, dy: number }
    | { type: 'bildr:space', down: boolean }

export function isCanvasMessage<T extends { type: string } = CanvasToEditor | EditorToCanvas>(data: unknown): data is T {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string'
    && (data as { type: string }).type.startsWith('bildr:')
}
