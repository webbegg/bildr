/**
 * The editor's one navigation: the top bar's view menu (S1). Canvas, Design system, Data and Settings
 * are views of the editor (`views.ts` opens the screen that shows one); Code and Checks are screens
 * of their own, reached by route. Migrations and Model have no entry: the banner and the deep link reach them.
 */
import type { EditorView } from './useEditor.ts'

export interface MenuEntry {
  label: string
  icon: string
  /** The editor view it shows, for the entries the editor's screens answer to. */
  view?: EditorView
  /** The screen's route, for the entries that are screens of their own. */
  route?: string
}

export const MENU: MenuEntry[] = [
  { label: 'Canvas', icon: 'i-lucide-pen-tool', view: 'build' },
  { label: 'Design system', icon: 'i-lucide-palette', view: 'design' },
  { label: 'Data', icon: 'i-lucide-database', view: 'data' },
  { label: 'Code', icon: 'i-lucide-file-code', route: '/code' },
  { label: 'Checks', icon: 'i-lucide-heart-pulse', route: '/health' },
  { label: 'Settings', icon: 'i-lucide-settings', view: 'settings' }
]

/** The entry that is current: the one whose route is `path`, or whose view the editor (when there is one) shows. */
export const currentEntry = (path: string, view: EditorView | null): MenuEntry | undefined =>
  MENU.find(entry => entry.route ? entry.route === path : !!view && entry.view === view)
