/**
 * The `data-node` ids the canvas draws (the format `render.ts` documents), kept apart from the renderer so the
 * editor can name a rendered node without bundling it: a page node keeps its id, the parts of an Instance are
 * `<instanceId>/<nodeId>`, and a layout's nodes, drawn around a page, are `<pageRootId>/@<nodeId>`.
 */

export const INSTANCE_ID_SEPARATOR = '/'
export const LAYOUT_ID_MARKER = '@'

/** The id the canvas gives layout node `nodeId` when it draws it around the page whose root is `pageRootId`. */
export const layoutNodeId = (pageRootId: string, nodeId: string): string => `${pageRootId}${INSTANCE_ID_SEPARATOR}${LAYOUT_ID_MARKER}${nodeId}`
