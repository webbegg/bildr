/**
 * The editor's one navigation: the top bar's view menu (S1). Canvas, Design system, Data and Settings
 * are views of the editor (`views.ts` opens the screen that shows one); Code and Checks are screens
 * of their own, reached by route. Migrations and Model have no entry: the banner and the deep link reach them.
 */
import type { EditorView } from './useEditor.ts'

interface MenuItem {
  label: string
  icon: string
}

/** An entry that is a screen of its own: `route` is the name of its route (`router.ts`). */
export interface RouteEntry extends MenuItem {
  route: 'code' | 'health'
}

/** An entry that is a view of the editor: the screen that shows `view` answers to it. */
export interface ViewEntry extends MenuItem {
  view: EditorView
}

export type MenuEntry = RouteEntry | ViewEntry

export const MENU: MenuEntry[] = [
  { label: 'Canvas', icon: 'i-lucide-pen-tool', view: 'build' },
  { label: 'Design system', icon: 'i-lucide-palette', view: 'design' },
  { label: 'Data', icon: 'i-lucide-database', view: 'data' },
  { label: 'Code', icon: 'i-lucide-file-code', route: 'code' },
  { label: 'Checks', icon: 'i-lucide-heart-pulse', route: 'health' },
  { label: 'Settings', icon: 'i-lucide-settings', view: 'settings' }
]

/**
 * The entry that is current: the one whose route is the matched route (by name, so `#/health/` is the
 * same screen as `#/health`), or whose view the editor (when there is one) shows.
 */
export const currentEntry = (routeName: string | symbol | null | undefined, view: EditorView | null): MenuEntry | undefined =>
  MENU.find(entry => 'route' in entry ? entry.route === routeName : !!view && entry.view === view)
