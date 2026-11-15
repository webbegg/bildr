/**
 * The canvas tools, Figma's letters (the hosted `insertTools.ts`): Move (V),
 * Hand (H, pans on drag) and the insert tools, armed from the keyboard only
 * (the next canvas click inserts their component; Escape or V returns to
 * Move). Letters fire only bare, so they stay clear of the editor shortcuts.
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
  // No letter: `I` opens the Insert panel, as in Framer.
  { id: 'Image', label: 'Image', icon: 'i-lucide-image', keys: [] },
  { id: 'Row', label: 'Row', icon: 'i-lucide-columns-3', keys: ['R'] },
  { id: 'Column', label: 'Column', icon: 'i-lucide-rows-3', keys: ['C'] }
]

export interface KeyInput { key: string, meta: boolean, shift: boolean, alt?: boolean, typing?: boolean }

/** The tool a key press arms, or null. */
export const toolForKey = ({ key, meta, shift, alt, typing }: KeyInput): ToolId | null => {
  if (meta || shift || alt || typing || key.length !== 1) return null
  const upper = key.toUpperCase()
  return INSERT_TOOLS.find(tool => tool.keys.includes(upper))?.id ?? null
}

/** True for a tool that inserts a component (not Move or Hand). */
export const isInsertTool = (id: ToolId): boolean => id !== MOVE_TOOL && id !== HAND_TOOL

/** What a canvas press does: Hand or a held Space pans (over any tool), an insert tool inserts, Move selects. */
export const pointerMode = (tool: ToolId, spaceHeld: boolean): 'pan' | 'insert' | 'select' => {
  if (spaceHeld || tool === HAND_TOOL) return 'pan'
  return isInsertTool(tool) ? 'insert' : 'select'
}

/** The floating bar's hint for an armed insert tool, which only the keyboard arms; null otherwise. */
export const toolHint = (id: ToolId): string | null => {
  if (!isInsertTool(id)) return null
  const label = INSERT_TOOLS.find(tool => tool.id === id)?.label ?? id
  return `${label} · click to insert · Esc`
}

/** The hosted editor's two accents: blue on pages, purple inside a component or a layout (or on instances). */
export const SELECTION_ACCENT = '#09f'
export const CONTEXT_ACCENT = '#85f'

/** The canvas selection's colour: purple while editing a component or layout (`context`), or for instances on a page; else blue. */
export const selectionAccent = (context: boolean, selectedTypes: readonly string[]): string => {
  if (context) return CONTEXT_ACCENT
  return selectedTypes.length > 0 && selectedTypes.every(type => type === 'Instance') ? CONTEXT_ACCENT : SELECTION_ACCENT
}
