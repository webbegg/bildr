/**
 * Which Cmd/Ctrl shortcuts the editor takes over from the browser. Copy
 * (C), Paste (V) and Paste style (Alt+V, matched on the physical code) are
 * the editor's only while the canvas or the layers tree has focus and no
 * text is selected, so copying text in a panel or a field keeps working;
 * Copy also needs a selection. Rename (R) and Lock (L) need a selection, so
 * with nothing selected the browser's reload and address bar still work.
 */

export interface ShortcutKey {
  key: string
  code: string
  /** Cmd or Ctrl. */
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface KeyContext {
  /** Where the key was typed: the canvas iframe, the layers tree, or anywhere else. */
  focus: 'canvas' | 'layers' | 'other'
  /** A non-empty text selection in that document (`window.getSelection()`). */
  textSelected: boolean
  /** Some node is selected. */
  hasSelection: boolean
}

/** False when the editor must leave `key` to the browser (see above); true for every other key. */
export function editorTakesKey(key: ShortcutKey, context: KeyContext): boolean {
  if (!key.meta || key.shift) return true
  const lower = key.key.toLowerCase()
  const clipboard = key.alt ? key.code === 'KeyV' : lower === 'c' || lower === 'v'
  if (clipboard) {
    if (context.focus === 'other' || context.textSelected) return false
    return key.alt || lower !== 'c' || context.hasSelection
  }
  if (!key.alt && (lower === 'r' || lower === 'l')) return context.hasSelection
  return true
}

/** True when the document has a non-empty text selection (browser only). */
export function hasTextSelection(win: Pick<Window, 'getSelection'>): boolean {
  const selection = win.getSelection()
  return !!selection && !selection.isCollapsed && selection.toString() !== ''
}
