import { presetEntry } from '@bildr/codegen/edit'
import { baseLayout } from '@bildr/codegen/render'
import type { ModelNode } from '@bildr/codegen/model'

/**
 * The layout presets in the editor (layout-containers): Stack, Row, Column
 * and Grid are Containers with the preset's tokens. The Insert panel, the
 * quick actions, the insert tools and Wrap in › name a preset or a type by one
 * id; the layers name a Container by how it lays out.
 */

/** What `node_insert` and `node_wrap` take for an insert id: a preset name as `preset`, anything else as `type`. */
export const insertSpec = (id: string): { preset: string } | { type: string } => (presetEntry(id) ? { preset: id } : { type: id })

/** The insert id of a catalog entry: its preset, or its type. */
export const insertId = (entry: { type: string, preset?: string }): string => entry.preset ?? entry.type

/** The layers name of a Container without its own name: Stack, Row or Grid by its layout, Container in block flow. */
export const containerName = (node: Pick<ModelNode, 'type' | 'props' | 'style'>): string => {
  const layout = baseLayout(node.type, node.props, node.style)
  return layout === 'row' ? 'Row' : layout === 'grid' ? 'Grid' : layout === 'col' ? 'Stack' : 'Container'
}

const LAYOUT_TYPES = ['Container', 'Row', 'Column', 'Grid']

/** The layers icon of a layout container: its direction's arrow, or a grid; undefined for other types. */
export const layoutIcon = (node: Pick<ModelNode, 'type' | 'props' | 'style'>): string | undefined => {
  if (!LAYOUT_TYPES.includes(node.type)) return undefined
  const layout = baseLayout(node.type, node.props, node.style)
  return layout === 'row' ? 'i-lucide-arrow-right' : layout === 'grid' ? 'i-lucide-grid-3x3' : layout === 'col' ? 'i-lucide-arrow-down' : undefined
}
