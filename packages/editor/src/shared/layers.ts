import { isFlexType } from '@bildr/codegen/render'
import { parseStyleKey, styleKey } from '@bildr/codegen/design'
import type { Breakpoint, BreakpointBase } from '@bildr/codegen/design'
import type { ComponentFile, LayoutFile, ModelNode, PageFile } from '@bildr/codegen/model'
import { DEFAULT_FRAMES } from '@bildr/editor-core/frames'
import { devicesFor, styleProvenance } from '@bildr/editor-core/styleFields'
import type { Device, DeviceId } from '@bildr/editor-core/styleFields'
import { findNode, findParent } from '../design/tree.ts'

/**
 * The layers tree's pure behaviour (the hosted `shared/editor/layers.ts`, over
 * `ModelNode`): the frame rows, which rows show when some are collapsed, what the
 * arrow keys do, and what the eye toggle reads and writes. Node names and the
 * sibling moves live in `editor/` (`design.nameOf`, `editor/drop.ts`).
 */

const childrenOf = (node: ModelNode): ModelNode[] => node.children ?? []

/** The devices the layers eye works over in cascade order (the Primary first): the shown frames, plus `device` (the edited one). */
function eyeDevices(device: DeviceId, shown: readonly DeviceId[], base: BreakpointBase): Device[] {
  return devicesFor(base).filter(entry => entry.id === device || !entry.breakpoint || shown.includes(entry.id))
}

/**
 * The name the layers, the canvas label and the inspector give `node` of
 * `file`: an Instance is named by its component, a SlotFill by the slot it
 * fills (its Instance's slot property, or for one on a page root the page
 * layout's slot). Everything else, and an unknown component or slot,
 * shows its type. A node's own `name` wins over all of these.
 */
export function layerName(file: Pick<PageFile | ComponentFile | LayoutFile, 'root'> & { layout?: string }, node: ModelNode, sources: { components: readonly ComponentFile[], layouts: readonly LayoutFile[] }): string {
  if (node.name) return node.name
  if (node.type === 'Instance') return sources.components.find(entry => entry.id === node.props?.component)?.name ?? node.type
  if (node.type !== 'SlotFill') return node.type
  const parent = findParent(file.root, node.id)
  if (parent?.type === 'Instance') {
    const component = sources.components.find(entry => entry.id === parent.props?.component)
    const property = component?.properties.find(entry => entry.kind === 'slot' && entry.id === node.props?.slot)
    return property ? property.label ?? property.name : node.type
  }
  if (parent?.id !== file.root.id) return node.type
  const layout = sources.layouts.find(entry => entry.id === file.layout)
  return layout?.slots.find(slot => slot.id === node.props?.slot)?.name ?? node.type
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
export function visibleLayers(root: ModelNode, collapsed: ReadonlySet<string>): string[] {
  const ids: string[] = []
  const visit = (node: ModelNode) => {
    ids.push(node.id)
    if (!collapsed.has(node.id)) childrenOf(node).forEach(visit)
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
export function layerKeyAction(root: ModelNode, collapsed: ReadonlySet<string>, selectedId: string | null, key: string): LayerKeyAction | null {
  const rows = visibleLayers(root, collapsed)
  const node = selectedId ? findNode(root, selectedId) : undefined
  if (!node) return key === 'ArrowDown' || key === 'ArrowUp' ? { select: rows[0]! } : null
  const open = childrenOf(node).length > 0 && !collapsed.has(node.id)
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const next = rows[rows.indexOf(node.id) + (key === 'ArrowDown' ? 1 : -1)]
      return next ? { select: next } : null
    }
    case 'ArrowLeft': {
      if (open) return { collapse: node.id }
      const parent = findParent(root, node.id)
      return parent ? { select: parent.id } : null
    }
    case 'ArrowRight':
      return childrenOf(node).length && !open ? { expand: node.id } : null
    default:
      return null
  }
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
  const provenance = styleProvenance(style, 'display', device, base)
  if (provenance.state === 'unset') return { hidden: false, source: undefined }
  const source = provenance.state === 'set' ? parseStyleKey(provenance.key)?.breakpoint : provenance.from
  return { hidden: provenance.value === 'hidden', source, value: provenance.value }
}

/** The other shown devices' breakpoints a node is hidden at (`base` for the Primary), e.g. `md`; null when none, or when hidden here. */
export function hiddenBadge(style: Record<string, string>, device: DeviceId, shown: readonly DeviceId[] = DEFAULT_FRAMES, base: BreakpointBase = 'mobile'): string | null {
  if (visibilityAt(style, device, base).hidden) return null
  const others = eyeDevices(device, shown, base).filter(entry => entry.id !== device && visibilityAt(style, entry.id, base).hidden)
  return others.length ? others.map(entry => entry.breakpoint ?? 'base').join(' ') : null
}

/**
 * The display a node renders with when no `display` token applies (children of
 * flex and grid containers are blockified, so a Button's inline-flex is `flex`).
 */
export function naturalDisplay(node: Pick<ModelNode, 'type' | 'props'>): string {
  if (node.type === 'Grid' || (node.type === 'List' && node.props?.layout === 'grid')) return 'grid'
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
export function visibilityToggle(style: Record<string, string> | undefined, device: DeviceId, natural: string, shown: readonly DeviceId[] = DEFAULT_FRAMES, base: BreakpointBase = 'mobile'): Record<string, string | null> {
  const own = style ?? {}
  const devices = eyeDevices(device, shown, base)
  const index = devices.findIndex(entry => entry.id === device)
  const key = styleKey('display', devices[index]!.breakpoint)
  const next = devices[index + 1]
  const displayAt = (s: Record<string, string>, id: DeviceId) => visibilityAt(s, id, base).value ?? natural
  const without = (s: Record<string, string>, k: string) => Object.fromEntries(Object.entries(s).filter(([other]) => other !== k))

  const patch: Record<string, string | null> = {}
  if (visibilityAt(own, device, base).hidden) patch[key] = visibilityAt(without(own, key), device, base).hidden ? natural : null
  else patch[key] = 'hidden'
  if (!next) return patch

  const nextKey = styleKey('display', next.breakpoint)
  const after = { ...without(own, key), ...(patch[key] ? { [key]: patch[key] } : {}) }
  if (after[nextKey] === undefined) {
    const before = displayAt(own, next.id)
    if (displayAt(after, next.id) !== before) patch[nextKey] = before
  } else if (after[nextKey] === displayAt(without(after, nextKey), next.id)) {
    patch[nextKey] = null
  }
  return patch
}
