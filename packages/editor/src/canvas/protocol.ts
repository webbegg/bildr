import type { BreakpointBase, Theme } from '@bildr/codegen/design'
import type { ComponentFile, LayoutFile, Value } from '@bildr/codegen/model'
import type { CanvasToEditor as CoreCanvasToEditor, CanvasView, EditorToCanvasCommon } from '@bildr/editor-core/protocol'
import type { BoardVariant, CanvasFile } from './render.ts'

/**
 * The canvas's postMessage protocol (P4a, mapping §6). Every message of
 * `@bildr/editor-core/protocol` keeps its name and shape (it documents them);
 * `bildr:render` carries a `.bildr` file instead of the hosted document:
 *
 * - `file`: the page, component or layout file being edited (as on disk);
 * - `components` and `layouts`: the project's, which Instances and the
 *   page's layout render from;
 * - `theme` and `breakpointBase`: the project's;
 * - `data`: what the file's bindings read, by alias (a page's `uses` aliases:
 *   a query's rows, a state's value, an action's `{pending, error}`; `site`;
 *   `$route` params), or a component's props by name. Anything missing renders
 *   as a placeholder;
 * - `variant`: the variant a variant-board frame shows;
 * - `view`: the page, or the token sheet (P4c).
 *
 * Two messages are new. `bildr:mode` switches between editing (a click
 * selects, nothing runs) and preview, where interactions run: component
 * variants (`setVariant`, hover and pressed states) and `toast` steps in the
 * canvas; `navigate`, `runAction` and `setState` steps are reported to the
 * editor as `bildr:interaction` and do nothing here.
 */

export type { CanvasView, SpacingOverlay } from '@bildr/editor-core/protocol'
export type { BoardVariant } from './render.ts'

export type CanvasMode = 'edit' | 'preview'

export interface RenderMessage {
  type: 'bildr:render'
  file: CanvasFile
  components: ComponentFile[]
  layouts: LayoutFile[]
  theme: Theme
  breakpointBase?: BreakpointBase
  data: Record<string, unknown>
  variant?: BoardVariant
  view: CanvasView
}

export type EditorToCanvas
  = | RenderMessage
    | EditorToCanvasCommon
    | { type: 'bildr:mode', mode: CanvasMode }

export type CanvasToEditor
  = | CoreCanvasToEditor
    | { type: 'bildr:interaction', nodeId: string, on: string, step: Record<string, Value> }

export { canvasKeyMessage, isCanvasMessage } from '@bildr/editor-core/protocol'
