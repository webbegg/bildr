import type { BreakpointBase } from '@bildr/codegen/design'
import type { ModelNode } from '@bildr/codegen/model'
import { fillCount, tokenAt } from '@bildr/editor-core/gridTracks'
import { deviceOf } from '@bildr/editor-core/styleFields'
import type { DeviceId } from '@bildr/editor-core/styleFields'
import { layoutType } from './panel.ts'

/**
 * Fill cells (layout-containers L6): the empty cells a grid has at a device,
 * after its last child up to the end of its last row (or its set rows), which
 * the inspector offers to fill with empty Stacks. None for a node that isn't a
 * grid there, auto-fit columns (their count is the viewport's) or an Overlay
 * (one cell). Positioned children take no cell.
 */
export function emptyCells(node: ModelNode, device: DeviceId, base: BreakpointBase): number {
  const style = node.style ?? {}
  if (layoutType(node.type, style, device, base) !== 'grid') return 0
  const breakpoint = deviceOf(device, base).breakpoint
  const at = (s: Record<string, string>, key: string) => tokenAt(s, key, breakpoint, base)
  const cols = at(style, 'cols')
  if (!cols || !/^\d+$/.test(cols) || at(style, 'overlay') === 'stack') return 0
  const rows = at(style, 'rows')
  const placed = (node.children ?? []).filter(child => !['absolute', 'fixed'].includes(at(child.style ?? {}, 'position') ?? ''))
  return fillCount(Number(cols), rows && /^\d+$/.test(rows) ? Number(rows) : undefined, placed.map((child) => {
    const s = child.style ?? {}
    return { colSpan: at(s, 'colSpan'), rowSpan: at(s, 'rowSpan') }
  }))
}
