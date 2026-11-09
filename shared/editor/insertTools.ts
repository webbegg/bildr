import { isContainerType } from '../document/components'
import type { DocNode } from '../document/schema'
import { findNode } from '../document/tree'
import type { Breakpoint } from '../design/tokens'
import type { DropPosition, DropTarget, Rect } from './dropTarget'
import { dropPosition, laysOutInRow, resolveDrop } from './dropTarget'

/**
 * The canvas tools, Figma's letters: Move (V), Hand (H, pans on drag) and the
 * insert tools, armed from the keyboard only (the next canvas click inserts
 * their component; Escape or V returns to Move). Letters fire
 * only bare (no Cmd/Ctrl, Shift or Alt) and never while typing, so they stay
 * clear of the editor shortcuts (Shift+A, Cmd+G, Cmd+D, ...).
 */

/** `move`, `hand`, or the component type a canvas click inserts. */
export type ToolId = string

export interface InsertTool { id: ToolId, label: string, icon: string, keys: string[] }

export const MOVE_TOOL = 'move'
export const HAND_TOOL = 'hand'

export const INSERT_TOOLS: InsertTool[] = [
  { id: MOVE_TOOL, label: 'Move', icon: 'i-lucide-mouse-pointer-2', keys: ['V'] },
  { id: HAND_TOOL, label: 'Hand', icon: 'i-lucide-hand', keys: ['H'] },
  { id: 'Container', label: 'Frame', icon: 'i-lucide-frame', keys: ['F', 'A'] },
  { id: 'Text', label: 'Text', icon: 'i-lucide-type', keys: ['T'] },
  { id: 'Button', label: 'Button', icon: 'i-lucide-mouse-pointer-click', keys: ['B'] },
  { id: 'Image', label: 'Image', icon: 'i-lucide-image', keys: ['I'] },
  { id: 'Row', label: 'Row', icon: 'i-lucide-columns-3', keys: ['R'] },
  { id: 'Column', label: 'Column', icon: 'i-lucide-rows-3', keys: ['C'] }
]

/** The bare keys the editor already uses (selection, navigation, delete, pan); modified shortcuts never reach the tools. */
export const RESERVED_SHORTCUTS = ['Enter', 'Tab', 'Escape', 'Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']

export interface KeyInput { key: string, meta: boolean, shift: boolean, alt?: boolean, typing?: boolean }

/** The tool a key press arms, or null. */
export function toolForKey({ key, meta, shift, alt, typing }: KeyInput): ToolId | null {
  if (meta || shift || alt || typing || key.length !== 1) return null
  const upper = key.toUpperCase()
  return INSERT_TOOLS.find(tool => tool.keys.includes(upper))?.id ?? null
}

/** True for a tool that inserts a component (not Move or Hand). */
export function isInsertTool(id: ToolId): boolean {
  return id !== MOVE_TOOL && id !== HAND_TOOL
}

/** What a canvas press does: Hand or a held Space pans (over any tool), an insert tool inserts, Move selects. */
export function pointerMode(tool: ToolId, spaceHeld: boolean): 'pan' | 'insert' | 'select' {
  if (spaceHeld || tool === HAND_TOOL) return 'pan'
  return isInsertTool(tool) ? 'insert' : 'select'
}

/** The floating bar's hint for an armed insert tool, which only the keyboard arms; null otherwise. */
export function toolHint(id: ToolId): string | null {
  if (!isInsertTool(id)) return null
  const label = INSERT_TOOLS.find(tool => tool.id === id)?.label ?? id
  return `${label} · click to insert · Esc`
}

/** Where an armed tool inserts, and where the canvas draws it (a node and a side, as the drop indicator does). */
export interface InsertHit { target: DropTarget, mark: { nodeId: string, position: DropPosition } }

/**
 * The insert slot for a click on node `overId` at `point`. A container (or
 * the page root) takes the component between the children around the
 * pointer, read along its layout axis at `breakpoint` (`childRects` are its
 * children's boxes, in order); a leaf takes it right after itself.
 */
export function insertTargetAt(root: DocNode, overId: string, point: { x: number, y: number }, childRects: Rect[], breakpoint: Breakpoint | undefined): InsertHit | null {
  const over = findNode(root, overId)
  if (!over) return null
  if (over !== root && !isContainerType(over.type)) {
    const target = resolveDrop(root, over.id, 'after')
    return target && { target, mark: { nodeId: over.id, position: 'after' } }
  }
  const horizontal = laysOutInRow(over, breakpoint)
  // A child is before the pointer when the pointer is past its middle, or (in a wrapping row) on a later line.
  const before = (rect: Rect) => (horizontal && point.y > rect.top + rect.height)
    || dropPosition(rect, point, { container: false, horizontal }) === 'after'
  const children = over.children.slice(0, childRects.length)
  const index = children.reduce((last, _, i) => (before(childRects[i]!) ? i + 1 : last), 0)
  const target = { parentId: over.id, index }
  if (!children.length) return { target, mark: { nodeId: over.id, position: 'inside' } }
  return index < children.length
    ? { target, mark: { nodeId: children[index]!.id, position: 'before' } }
    : { target, mark: { nodeId: children.at(-1)!.id, position: 'after' } }
}

/** Tool keys that an editor shortcut already uses. */
export function toolConflicts(tools: InsertTool[], reserved: string[]): { tool: ToolId, key: string }[] {
  return tools.flatMap(tool => tool.keys.filter(k => reserved.includes(k)).map(k => ({ tool: tool.id, key: k })))
}
