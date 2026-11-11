import { INSTANCE_TYPE, SLOT_FILL_TYPE } from '../document/components'
import type { PropValue } from '../document/components'
import { CHILDREN_SLOT } from '../document/schema'
import type { ComponentDefinition, DocNode, Layout, Page } from '../document/schema'
import { resolveLayoutRefs } from './bindings'
import { applySetters, applyStyleSetters, INSTANCE_ID_SEPARATOR, propertySetters, resolveInstance } from './instances'

/**
 * Resolves a page into the tree it renders with its layout, at render time
 * and never stored in the document. A page without `layoutId` renders its
 * own root, unchanged. Otherwise the layout's tree renders with
 * `{{ layout.NAME }}` resolved and bound props (and style keys) set from the page's
 * `layoutValues` (else the stored variable default, else the layout node's
 * own value; see `applySetters`), the page root's children (bar
 * SlotFills) in place of the `children` slot node's children, and each
 * SlotFill of the root in place of its named slot's default content.
 *
 * Layout nodes get the id `<pageRootId>/@<nodeId>` (instances in the layout
 * compose their ids under it), so they never collide with page ids, map to
 * the page root (`pageNodeId`) and count as not editable
 * (`isDefinitionNodeId`). The `children` slot node takes the page root's id
 * and a filled slot node its SlotFill's id, so the canvas drops into the
 * page's own containers; page content keeps its ids and stays editable.
 * A missing layout renders the page root without its SlotFills.
 *
 * Instances in the layout are expanded (statically, in their set variant)
 * unless `linked`: then they stay Instance nodes, with their layout ids,
 * for the interactive renderer to run their states and interactions as it
 * does for page instances.
 */

export const LAYOUT_ID_MARKER = '@'

/** True for ids of nodes that come from a page's layout. */
export function isLayoutNodeId(id: string): boolean {
  return id.split(INSTANCE_ID_SEPARATOR)[1]?.startsWith(LAYOUT_ID_MARKER) ?? false
}

export function resolvePageWithLayout(page: Page, layouts: Layout[], components: ComponentDefinition[], { linked = false }: { linked?: boolean } = {}): DocNode {
  if (page.layoutId === undefined) return page.root
  const content = page.root.children.filter(child => child.type !== SLOT_FILL_TYPE)
  const layout = layouts.find(l => l.id === page.layoutId)
  if (!layout) return { ...page.root, children: content }

  const refs: Record<string, PropValue> = {}
  const setters = propertySetters(layout.variables, page.layoutValues ?? {})
  for (const variable of layout.variables) {
    if (variable.kind !== 'slot') refs[variable.name] = page.layoutValues?.[variable.id] ?? variable.default ?? ''
  }

  // Slot node id → the page node that takes its place and the children it shows.
  const places = new Map<string, { id: string, children: DocNode[] }>()
  for (const slot of layout.slots) {
    if (slot.id === CHILDREN_SLOT) {
      places.set(slot.nodeId, { id: page.root.id, children: content })
      continue
    }
    const fill = page.root.children.find(c => c.type === SLOT_FILL_TYPE && c.props.slot === slot.id)
    if (fill) places.set(slot.nodeId, { id: fill.id, children: fill.children })
  }

  const build = (node: DocNode): DocNode | null => {
    const props: Record<string, PropValue> = { ...node.props }
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'string') props[key] = resolveLayoutRefs(value, refs)
    }
    applySetters(props, setters, node.id)
    const style = { ...node.style }
    applyStyleSetters(style, setters, node.id)
    const place = places.get(node.id)
    const built: DocNode = {
      id: place?.id ?? `${page.root.id}${INSTANCE_ID_SEPARATOR}${LAYOUT_ID_MARKER}${node.id}`,
      type: node.type,
      props,
      style,
      children: place?.children ?? node.children.map(build).filter(child => child !== null)
    }
    return node.type === INSTANCE_TYPE && !linked ? resolveInstance(built, components) : built
  }

  return build(layout.root) ?? { ...page.root, children: content }
}
