import { INSTANCE_TYPE } from '../document/components'

/**
 * The editor's two accents (main.css `--editor-selection` and
 * `--editor-context`), Framer's: blue on pages, purple inside a component or
 * a layout. The canvas iframe can't read the chrome's variables, so the
 * editor sends it the accent of the selection with each `bildr:select`.
 */
export const SELECTION_ACCENT = '#09f'
export const CONTEXT_ACCENT = '#85f'

/** The canvas selection's colour: purple while editing a component or layout (`context`), or for instances on a page; else blue. */
export function selectionAccent(context: boolean, selectedTypes: readonly string[]): string {
  if (context) return CONTEXT_ACCENT
  return selectedTypes.length > 0 && selectedTypes.every(type => type === INSTANCE_TYPE) ? CONTEXT_ACCENT : SELECTION_ACCENT
}
