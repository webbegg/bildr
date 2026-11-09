import type { Theme } from '../design/theme'
import type { Page } from '../document/schema'

/**
 * postMessage protocol between the editor and its canvas iframe (the
 * Stacki frame-target idea). The editor owns the document and pushes it to
 * the canvas; the canvas reports pointer and keyboard gestures back.
 */

export type EditorToCanvas
  = | { type: 'bildr:render', page: Page, base: string, theme: Theme }
    | { type: 'bildr:select', nodeId: string | null }
    | { type: 'bildr:hover', nodeId: string | null }

export type CanvasToEditor
  = | { type: 'bildr:ready' }
    | { type: 'bildr:hover', nodeId: string | null }
    | { type: 'bildr:click', nodeId: string }
    | { type: 'bildr:key', key: string, meta: boolean, shift: boolean }
    | { type: 'bildr:drop', parentId: string, index: number, payload: string }

export function isCanvasMessage<T extends { type: string } = CanvasToEditor | EditorToCanvas>(data: unknown): data is T {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string'
    && (data as { type: string }).type.startsWith('bildr:')
}
