import { parseStyleKey, styleKey } from '../design/tokens'
import type { Breakpoint, BreakpointBase } from '../design/tokens'
import { isFlexType } from '@bildr/codegen/render'
import { INSTANCE_TYPE, SLOT_FILL_TYPE } from '../document/components'
import type { ComponentDefinition, DocNode, Layout, Page } from '../document/schema'
import { findNode, findParent, pathTo } from '../document/tree'
import type { DropTarget } from './dropTarget'
import { devicesFor, styleProvenance } from './styleFields'
import type { Device, DeviceId } from './styleFields'
import { DEFAULT_FRAMES } from './frames'

/** The devices the layers eye works over in cascade order (the Primary first): the shown frames, plus `device` (the edited one). */
function eyeDevices(device: DeviceId, shown: readonly DeviceId[], base: BreakpointBase): Device[] {
  return devicesFor(base).filter(d => d.id === device || !d.breakpoint || shown.includes(d.id))
}

/**
 * The layers tree's pure behaviour: which rows show when some are collapsed,
 * what the arrow keys do, where Move up / Move down send a node, what the
 * eye toggle reads and writes, and what a node is called.
 */

/**
 * The name the layers, the canvas label and the inspector give `node` of
 * `page`: an Instance is named by its component, a SlotFill by the slot it
 * fills (its Instance's slot property, or for one on the page root the
 * page layout's slot). Everything else, and an unknown component or slot,
 * shows its type. A node's own `name` wins over all of these.
 */
export function layerName(page: Page, node: DocNode, sources: { components: readonly ComponentDefinition[], layouts: readonly Layout[] }): string {
  if (node.name) return node.name
  if (node.type === INSTANCE_TYPE) return sources.components.find(c => c.id === node.props.component)?.name ?? node.type
  if (node.type !== SLOT_FILL_TYPE) return node.type
  const parent = findParent(page.root, node.id)?.parent
  if (parent?.type === INSTANCE_TYPE) {
    const component = sources.components.find(c => c.id === parent.props.component)
    return component?.properties.find(p => p.kind === 'slot' && p.id === node.props.slot)?.name ?? node.type
  }
  if (parent?.id !== page.root.id) return node.type
  const layout = sources.layouts.find(l => l.id === page.layoutId)
  return layout?.slots.find(s => s.id === node.props.slot)?.name ?? node.type
}

/**
 * The layers tree's frame rows: with two or more visible frames, a root row
 * per frame and the page tree one level in under the edited `device`; with a
 * single frame, no frame row (only noise then), so the page tree is the top of
 * the tree and works on that frame's device.
 */
export function layerFrames<T extends { id: DeviceId }>(visible: readonly T[], device: DeviceId): { rows: T[], indent: 0 | 1, device: DeviceId } {
  if (visible.length === 1) return { rows: [], indent: 0, device: visible[0]!.id }
  return { rows: [...visible], indent: 1, device }
}

/** Row ids top to bottom; the children of a collapsed row are hidden. */
export function visibleLayers(root: DocNode, collapsed: ReadonlySet<string>): string[] {
  const ids: string[] = []
  const visit = (node: DocNode) => {
    ids.push(node.id)
    if (!collapsed.has(node.id)) node.children.forEach(visit)
  }
  visit(root)
  return ids
}

export type LayerKeyAction = { select: string } | { collapse: string } | { expand: string }

/**
 * What an arrow key does on the layers tree: Up/Down step through the visible
 * rows; Left collapses an open row, else goes to the parent; Right expands a
 * collapsed row. Null when the key does nothing there.
 */
export function layerKeyAction(root: DocNode, collapsed: ReadonlySet<string>, selectedId: string | null, key: string): LayerKeyAction | null {
  const rows = visibleLayers(root, collapsed)
  const node = selectedId ? findNode(root, selectedId) : undefined
  if (!node) return key === 'ArrowDown' || key === 'ArrowUp' ? { select: rows[0]! } : null
  const open = node.children.length > 0 && !collapsed.has(node.id)
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const next = rows[rows.indexOf(node.id) + (key === 'ArrowDown' ? 1 : -1)]
      return next ? { select: next } : null
    }
    case 'ArrowLeft': {
      if (open) return { collapse: node.id }
      const parent = findParent(root, node.id)?.parent
      return parent ? { select: parent.id } : null
    }
    case 'ArrowRight':
      return node.children.length && !open ? { expand: node.id } : null
    default:
      return null
  }
}

/** The collapsed rows, root first, that hide node `id`. */
export function collapsedAncestors(root: DocNode, collapsed: ReadonlySet<string>, id: string): string[] {
  return pathTo(root, id).slice(0, -1).filter(ancestor => collapsed.has(ancestor))
}

/**
 * The `node_move_many` moves that step every node in `ids` one place up (-1)
 * or down (1) among its siblings, as one block: null when one of them is at
 * the end already or is the root. Moves run nearest-the-end first, so each
 * index is still right when its move runs.
 */
export function siblingMoves(root: DocNode, ids: readonly string[], delta: -1 | 1): { nodeId: string, parentId: string, index: number }[] | null {
  const moves: { nodeId: string, parentId: string, index: number }[] = []
  for (const id of new Set(ids)) {
    const to = siblingMove(root, id, delta)
    if (!to) return null
    moves.push({ nodeId: id, ...to })
  }
  return moves.sort((a, b) => (a.index - b.index) * -delta)
}

export interface Visibility {
  hidden: boolean
  /** The breakpoint of the `display` token that applies; undefined for the base, or when none does. */
  source: Breakpoint | undefined
  /** That token's value; absent when the node keeps its natural display. */
  value?: string
}

/** Whether a node shows on a device, from its `display` tokens read down the `base` project's cascade. */
export function visibilityAt(style: Record<string, string>, device: DeviceId, base: BreakpointBase = 'mobile'): Visibility {
  const p = styleProvenance(style, 'display', device, base)
  if (p.state === 'unset') return { hidden: false, source: undefined }
  const source = p.state === 'set' ? parseStyleKey(p.key)?.breakpoint : p.from
  return { hidden: p.value === 'hidden', source, value: p.value }
}

/** The other shown devices' breakpoints a node is hidden at (`base` for the Primary), e.g. `md`; null when none, or when hidden here. */
export function hiddenBadge(style: Record<string, string>, device: DeviceId, shown: readonly DeviceId[] = DEFAULT_FRAMES, base: BreakpointBase = 'mobile'): string | null {
  if (visibilityAt(style, device, base).hidden) return null
  const others = eyeDevices(device, shown, base).filter(d => d.id !== device && visibilityAt(style, d.id, base).hidden)
  return others.length ? others.map(d => d.breakpoint ?? 'base').join(' ') : null
}

/**
 * The display a node renders with when no `display` token applies (children of
 * flex and grid containers are blockified, so a Button's inline-flex is `flex`).
 */
export function naturalDisplay(node: Pick<DocNode, 'type' | 'props'>): string {
  if (node.type === 'Grid' || (node.type === 'List' && node.props.layout === 'grid')) return 'grid'
  if (node.type === 'Card') return 'block'
  return isFlexType(node.type) || ['List', 'Button'].includes(node.type) ? 'flex' : 'block'
}

/**
 * The style patch of the layers eye on a device: it hides or shows the node on
 * that device only. Display tokens cascade from the Primary (mobile-first:
 * Mobile, then wider; desktop-first: Desktop, then narrower), so hiding on
 * one device also writes the display the next device in the cascade had,
 * keeping it as it was; and an override that the toggle no longer needs is
 * removed, so hide then show gives the original style back. `natural` is the
 * node's `naturalDisplay`. The next device is the next shown frame in the
 * cascade (`shown`, the visible frames; `base`, the project's breakpoint base).
 */
export function visibilityToggle(style: Record<string, string>, device: DeviceId, natural: string, shown: readonly DeviceId[] = DEFAULT_FRAMES, base: BreakpointBase = 'mobile'): Record<string, string | null> {
  const devices = eyeDevices(device, shown, base)
  const index = devices.findIndex(d => d.id === device)
  const key = styleKey('display', devices[index]!.breakpoint)
  const next = devices[index + 1]
  const displayAt = (s: Record<string, string>, id: DeviceId) => visibilityAt(s, id, base).value ?? natural
  const without = (s: Record<string, string>, k: string) => Object.fromEntries(Object.entries(s).filter(([other]) => other !== k))

  const patch: Record<string, string | null> = {}
  if (visibilityAt(style, device, base).hidden) patch[key] = visibilityAt(without(style, key), device, base).hidden ? natural : null
  else patch[key] = 'hidden'
  if (!next) return patch

  const nextKey = styleKey('display', next.breakpoint)
  const after = { ...without(style, key), ...(patch[key] ? { [key]: patch[key] } : {}) }
  if (after[nextKey] === undefined) {
    const before = displayAt(style, next.id)
    if (displayAt(after, next.id) !== before) patch[nextKey] = before
  } else if (after[nextKey] === displayAt(without(after, nextKey), next.id)) {
    patch[nextKey] = null
  }
  return patch
}

/** The `node_move` slot one step up (-1) or down (1) among the node's siblings; null at either end or for the root. */
export function siblingMove(root: DocNode, id: string, delta: -1 | 1): DropTarget | null {
  const location = findParent(root, id)
  if (!location) return null
  const index = location.index + delta
  if (index < 0 || index >= location.parent.children.length) return null
  return { parentId: location.parent.id, index }
}
