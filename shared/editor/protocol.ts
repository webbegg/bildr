import { isCanvasMessage as isBildrMessage } from '@bildr/editor-core/protocol'
import type { BoardVariant, CanvasToEditor, CanvasView, EditorToCanvasCommon } from '@bildr/editor-core/protocol'
import type { DataRecord } from '../data/records'
import type { Theme } from '../design/theme'
import type { BreakpointBase } from '../design/tokens'
import type { ComponentDefinition, Layout, Page } from '../document/schema'
import type { EnvValues } from '../env/variables'

/**
 * postMessage protocol between the editor and its canvas iframe. Every
 * message but `bildr:render` is format-independent and lives in
 * `@bildr/editor-core/protocol` (P1), which documents them; this file adds
 * the hosted document's render message.
 *
 * `lists` carries each List's records by `listKey`; a List repeats its
 * children per record, and copies after the first carry `data-bildr-copy`.
 * `bildr:render` carries the project's breakpoint base (`breakpointBase`,
 * mobile-first when absent), which maps the frame's width to the breakpoint
 * its handles, drops and `screen` heights use.
 * It also carries the project's component definitions (`components`),
 * which Instance nodes render from, and its `layouts`, which wrap the page. It also carries the public variables (`env`), which the canvas
 * resolves `{{ env.NAME }}` with in props and theme colours; a missing one
 * shows as written. On a detail page, `record` is the record the page
 * previews (the page inspector's Preview record); its `{{ item.* }}`
 * bindings read it outside Lists. Null or absent shows them as written.
 * `variant` names the variant a variant-board frame shows.
 */

export type { BoardVariant, CanvasToEditor, CanvasView, EditorToCanvasCommon, SpacingOverlay } from '@bildr/editor-core/protocol'
export { canvasKeyMessage } from '@bildr/editor-core/protocol'

export type EditorToCanvas
  = | { type: 'bildr:render', page: Page, base: string, breakpointBase?: BreakpointBase, theme: Theme, view: CanvasView, lists: Record<string, DataRecord[]>, env: EnvValues, components: ComponentDefinition[], layouts: Layout[], variant?: BoardVariant, record?: DataRecord | null }
    | EditorToCanvasCommon

export function isCanvasMessage<T extends { type: string } = CanvasToEditor | EditorToCanvas>(data: unknown): data is T {
  return isBildrMessage<T>(data)
}
