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
  /** The page being edited, which the Design screen opens (not the first). */
  pageId?: string | null
  collectionId?: string | null
  /** The Import from API request count: above 0, the dialog opens. */
  importRequest?: number
}

/** Opens a screen; what the shell's router answers when the navigation did not happen (a failure it returns, or a rejection) means the editor there will not be made. */
type OpenScreen = (screen: Screen) => unknown

let open: OpenScreen | null = null
let pending: { view: EditorView, data: DataStart } | null = null

/** The shell registers how a screen is opened (the router). Returns the way to unregister. */
export const registerScreens = (handler: OpenScreen): (() => void) => {
  open = handler
  return () => {
    if (open === handler) open = null
  }
}

/**
 * What the editor created now starts with (once): the view that asked for its screen, and what it
 * carried. An editor of another `screen` than the one asked for (a navigation that went elsewhere)
 * drops it instead, so a stale request never starts the wrong screen on the wrong view.
 */
export const takeStart = (screen?: Screen): { view: EditorView | null, data: DataStart } => {
  const start = pending
  pending = null
  if (!start || (screen && screenOf(start.view) !== screen)) return { view: null, data: {} }
  return { view: start.view, data: start.data }
}

/** The page chosen while a screen change is on its way: the Design screen opens it. */
export const carryPage = (pageId: string): void => {
  if (pending) pending.data.pageId = pageId
}

/** `view` was chosen in an editor that is on `from`: opens the other screen when it is the one that shows `view`. */
export const requestView = (view: EditorView, from: Screen, data: DataStart = {}): void => {
  const screen = screenOf(view)
  if (screen === from || !open) return
  const request = { view, data }
  pending = request
  const forget = () => {
    if (pending === request) pending = null
  }
  // A navigation that fails or is cancelled leaves nothing to start the next editor on.
  try {
    Promise.resolve(open(screen)).then(failure => failure ? forget() : undefined, forget)
  } catch {
    forget()
  }
}
