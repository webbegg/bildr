import type { DataRecord } from '../data/records'
import type { Theme } from '../design/theme'
import type { ComponentDefinition, Layout, Page } from '../document/schema'
import type { EnvValues } from '../env/variables'
import type { NodeBox } from './autoLayout'
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
 * outlines keep their screen size), plus its device's nominal viewport height,
 * which `screen` heights resolve to. Each page-view frame reports its content
 * height (`bildr:size`) and forwards the gestures that drive the editor's
 * zoom and pan: wheel at canvas viewport coordinates, pan drags (middle
 * button) as screen-pixel deltas, and the space key held or released.
 *
 * Selection is a list (`nodeIds`, Shift+click toggles); `nodeId` is the
 * primary (last) one, which the active frame labels. `accent` is the colour
 * the selection, handles and labels draw in (see `selectionAccent`). A click reports the
 * deepest element under the pointer and its modifiers; the editor decides
 * what it selects (drill). `bildr:measure` asks a frame for the on-canvas
 * boxes of nodes (Shift+A infers an auto layout from them); it answers with
 * `bildr:rects` and the same `requestId`, in canvas pixels. `bildr:alt` is
 * the Alt key held in the editor, which shows measurements to the hovered
 * element in the active frame.
 *
 * `bildr:tool` is the armed insert tool (a component type; null is Move):
 * frames show a crosshair and the insert slot under the pointer, and a click
 * reports that slot as `bildr:insert` instead of selecting.
 *
 * `bildr:render` carries the project's component definitions (`components`),
 * which Instance nodes render from, and its `layouts`, which wrap the page. It also carries the public variables (`env`), which the canvas
 * resolves `{{ env.NAME }}` with in props and theme colours; a missing one
 * shows as written.
 *
 * `bildr:dark` previews the project's dark colours: the frame puts `.dark` on
 * its `<html>`, which the theme CSS answers with its dark values.
 *
 * Direct manipulation (#23): `bildr:overlay` is the panel field being hovered
 * (Padding or Gap), whose overlay the active frame paints on the selection.
 * A handle drag in the active frame (resize, padding, gap) reports the style
 * patch it holds as `bildr:style-preview` (null when Esc cancels it) and the
 * one it ends on as `bildr:style-commit`, which the editor commits as one
 * undo step. A drag of a selected node reports its drop as `bildr:drop`.
 */

/** The spacing overlay a panel field asks for while hovered. */
export type SpacingOverlay = 'padding' | 'gap'

/** What a canvas shows: the page being edited, or the theme's token preview sheet. */
export type CanvasView = 'page' | 'tokens'

export type EditorToCanvas
  = | { type: 'bildr:render', page: Page, base: string, theme: Theme, view: CanvasView, lists: Record<string, DataRecord[]>, env: EnvValues, components: ComponentDefinition[], layouts: Layout[] }
    | { type: 'bildr:select', nodeId: string | null, nodeIds: string[], accent?: string }
    | { type: 'bildr:hover', nodeId: string | null }
    | { type: 'bildr:preview', nodeId: string, style: StylePatch | null }
    | { type: 'bildr:active', active: boolean, zoom: number, viewportHeight: number }
    | { type: 'bildr:measure', requestId: number, nodeIds: string[] }
    | { type: 'bildr:alt', down: boolean }
    | { type: 'bildr:tool', tool: string | null }
    | { type: 'bildr:dark', dark: boolean }
    | { type: 'bildr:overlay', overlay: SpacingOverlay | null }

export type CanvasToEditor
  = | { type: 'bildr:ready' }
    | { type: 'bildr:hover', nodeId: string | null }
    | { type: 'bildr:click', nodeId: string, shift: boolean, meta: boolean }
    | { type: 'bildr:rects', requestId: number, rects: NodeBox[] }
    | { type: 'bildr:contextmenu', nodeId: string, x: number, y: number }
    | { type: 'bildr:key', key: string, code: string, meta: boolean, shift: boolean, alt: boolean }
    | { type: 'bildr:drop', parentId: string, index: number, payload: string }
    | { type: 'bildr:insert', parentId: string, index: number }
    | { type: 'bildr:size', height: number }
    | { type: 'bildr:wheel', dx: number, dy: number, zoom: boolean, x: number, y: number }
    | { type: 'bildr:pan', dx: number, dy: number }
    | { type: 'bildr:space', down: boolean }
    | { type: 'bildr:style-preview', nodeId: string, style: StylePatch | null }
    | { type: 'bildr:style-commit', nodeId: string, style: StylePatch }

type KeyFields = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

/** The `bildr:key` message for a canvas key press: Cmd or Ctrl is `meta`; `alt` and the physical `code` let Alt shortcuts (Paste style) through. */
export function canvasKeyMessage(event: KeyFields): Extract<CanvasToEditor, { type: 'bildr:key' }> {
  return { type: 'bildr:key', key: event.key, code: event.code, meta: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey }
}

export function isCanvasMessage<T extends { type: string } = CanvasToEditor | EditorToCanvas>(data: unknown): data is T {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string'
    && (data as { type: string }).type.startsWith('bildr:')
}
