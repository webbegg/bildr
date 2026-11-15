/**
 * The editor's views are two screens (U7). The hosted editor is one page whose `mode` shows
 * Canvas, Data, Design or Settings; here the Design screen (`DesignView`) shows Canvas, Design
 * and Settings, and the Data screen (`DataView`, `/data`) shows Data. The hosted components set
 * `editor.mode` and the view menu, ⌘K and the sidebar all keep doing so: when the new view
 * belongs to the other screen, the adapter asks the shell (`App.vue` registers the router here)
 * to open it, and the editor created there starts on that view, with what the first one carries
 * (the collection to show, a request to open the Import from API dialog).
 */
import type { EditorView } from './useEditor.ts'

export type Screen = 'design' | 'data'

export const screenOf = (view: EditorView): Screen => view === 'data' ? 'data' : 'design'

/** What the Data screen starts with when another screen opened it. */
export interface DataStart {
  collectionId?: string | null
  /** The Import from API request count: above 0, the dialog opens. */
  importRequest?: number
}

let open: ((screen: Screen) => void) | null = null
let pending: { view: EditorView, data: DataStart } | null = null

/** The shell registers how a screen is opened (the router). Returns the way to unregister. */
export const registerScreens = (handler: (screen: Screen) => void): (() => void) => {
  open = handler
  return () => {
    if (open === handler) open = null
  }
}

/** What the editor created now starts with (once): the view that asked for its screen, and what it carried. */
export const takeStart = (): { view: EditorView | null, data: DataStart } => {
  const start = pending
  pending = null
  return { view: start?.view ?? null, data: start?.data ?? {} }
}

/** `view` was chosen in an editor that is on `from`: opens the other screen when it is the one that shows `view`. */
export const requestView = (view: EditorView, from: Screen, data: DataStart = {}): void => {
  const screen = screenOf(view)
  if (screen === from || !open) return
  pending = { view, data }
  open(screen)
}
