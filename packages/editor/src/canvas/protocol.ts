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
 * - `paths`: page id → route path, so page links point at their pages, and
 *   `path`: the route of the file being edited (a page's path), where the
 *   canvas's router sits: links to it are active, as in the app;
 * - `variant`: the variant a variant-board frame shows;
 * - `view`: the page, or the token sheet (P4c).
 *
 * Two messages are new. `bildr:mode` switches between editing (a click
 * selects, nothing runs) and preview, where interactions run: component
 * variants (`setVariant`, hover and pressed states) and `toast` steps in the
 * canvas; `navigate`, `runAction` and `setState` steps are reported to the
 * editor as `bildr:interaction` and do nothing here.
 *
 * The `bildr:interaction` contract (the one place it is written):
 * - `nodeId` is the page's node whose interaction `on` ran; `step` is the
 *   step as the file has it, in the order the node lists them;
 * - a `setState` step's `value` is worked out by the canvas, as a
 *   `PlainValue`: a Checkbox's `$event` is its new `checked` (an unbound one
 *   starts off and alternates), a binding or template is read in the scope of
 *   the exact element clicked (a List row's own);
 * - a `setState` whose value can't be worked out is not reported, and the
 *   steps after it don't run, as after a failed action;
 * - the canvas holds no State, the editor does (`design/previewState.ts`):
 *   it trusts none of it, and applies the step only if that node really has
 *   it for that event, the State is the page's and the value fits the field.
 *   It sends the State rows back in `data`.
 */

export type { CanvasView, SpacingOverlay } from '@bildr/editor-core/protocol'
export type { BoardVariant } from './render.ts'

/** The plain values a Set state step carries across the protocol, and a State's field holds in preview. */
export type PlainValue = string | number | boolean | null

export type CanvasMode = 'edit' | 'preview'

export interface RenderMessage {
  type: 'bildr:render'
  file: CanvasFile
  components: ComponentFile[]
  layouts: LayoutFile[]
  theme: Theme
  breakpointBase?: BreakpointBase
  data: Record<string, unknown>
  paths?: Record<string, string>
  path?: string
  variant?: BoardVariant
  view: CanvasView
}

export type EditorToCanvas
  = | RenderMessage
    | EditorToCanvasCommon
    | { type: 'bildr:mode', mode: CanvasMode }
    /** Esc went to the editor (the canvas never has focus) while a handle drag was in progress: cancel it. */
    | { type: 'bildr:cancel-drag' }

export type CanvasToEditor
  = | CoreCanvasToEditor
    | { type: 'bildr:interaction', nodeId: string, on: string, step: Record<string, Value> }

export { canvasKeyMessage, isCanvasMessage } from '@bildr/editor-core/protocol'
