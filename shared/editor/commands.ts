/**
 * The `⌘K` quick actions (Framer's Quick Insert): the commands, their
 * search and ranking, and the editor's keyboard shortcuts, which both the
 * commands and the shortcuts sheet read. Pure, so the editor passes in a
 * context; every command mutates through the editor's own methods.
 */
import { COMPONENTS } from '../document/components'
import type { DocNode } from '../document/schema'
import type { SelectionStep } from './selection'
import { siblingParent, topLevelSelection } from './selection'

export type CommandGroup = 'insert' | 'actions' | 'goto' | 'help'

export interface Command<C = unknown> {
  id: string
  group: CommandGroup
  label: string
  keywords: string[]
  icon?: string
  /** Shown after the label, e.g. "Page". */
  hint?: string
  /** Key combos as Nuxt UI `UKbd` values, e.g. `['meta', 'd']`. */
  shortcut?: string[]
  enabled: (ctx: C) => boolean
  run: (ctx: C) => unknown
}

export const GROUP_ORDER: CommandGroup[] = ['insert', 'actions', 'goto', 'help']

export const GROUP_LABELS: Record<CommandGroup | 'recent', string> = {
  recent: 'Recent',
  insert: 'Insert',
  actions: 'Actions',
  goto: 'Go to',
  help: 'Help'
}

export interface Shortcut {
  id: string
  label: string
  /** The combos that do it (e.g. `F` or `A`), each as `UKbd` values. */
  keys: string[][]
}

/**
 * Every editor shortcut, for the shortcuts sheet and the commands' hints.
 * Handled by `useEditor().shortcut`, the canvas (zoom, Space) and the
 * frames (Alt); this list only describes them.
 */
export const SHORTCUTS: Shortcut[] = [
  { id: 'tool:move', label: 'Move tool', keys: [['v']] },
  { id: 'tool:hand', label: 'Hand tool (drag to pan)', keys: [['h']] },
  { id: 'tool:Container', label: 'Frame: click to insert a Container', keys: [['f'], ['a']] },
  { id: 'tool:Text', label: 'Text: click to insert', keys: [['t']] },
  { id: 'tool:Button', label: 'Button: click to insert', keys: [['b']] },
  { id: 'tool:Row', label: 'Row: click to insert', keys: [['r']] },
  { id: 'tool:Column', label: 'Column: click to insert', keys: [['c']] },
  { id: 'insert-panel', label: 'Insert panel', keys: [['i']] },
  { id: 'quick-actions', label: 'Quick actions', keys: [['meta', 'k']] },
  { id: 'preview', label: 'Preview the draft', keys: [['meta', 'p']] },
  { id: 'search', label: 'Search the sidebar', keys: [['meta', 'f']] },
  { id: 'duplicate', label: 'Duplicate', keys: [['meta', 'd']] },
  { id: 'group', label: 'Group in a Container', keys: [['meta', 'g']] },
  { id: 'auto-layout', label: 'Auto layout (Row or Column)', keys: [['shift', 'a']] },
  { id: 'select-child', label: 'Select the first child', keys: [['enter']] },
  { id: 'select-parent', label: 'Select the parent', keys: [['shift', 'enter']] },
  { id: 'select-next', label: 'Select the next sibling', keys: [['tab']] },
  { id: 'select-prev', label: 'Select the previous sibling', keys: [['shift', 'tab']] },
  { id: 'delete', label: 'Delete', keys: [['delete']] },
  { id: 'undo', label: 'Undo', keys: [['meta', 'z']] },
  { id: 'redo', label: 'Redo', keys: [['meta', 'shift', 'z']] },
  { id: 'zoom-100', label: 'Zoom to 100%', keys: [['shift', '0']] },
  { id: 'zoom-fit', label: 'Zoom to fit', keys: [['shift', '1']] },
  { id: 'pan', label: 'Hold to pan', keys: [['space']] },
  { id: 'measure', label: 'Hold over an element to measure', keys: [['alt']] }
]

/** The first combo of a shortcut, for a command's hint. */
export function shortcutKeys(id: string): string[] | undefined {
  return SHORTCUTS.find(s => s.id === id)?.keys[0]
}

const normalize = (text: string) => text.trim().toLowerCase()

function isSubsequence(query: string, text: string): boolean {
  let at = 0
  for (const char of text) if (char === query[at]) at++
  return at === query.length
}

/**
 * How well a command matches a query: 3 for a label prefix, 2 for the start
 * of a label word or a keyword, 1 for the query's letters in order in the
 * label, 0 for no match. An empty query matches everything (1).
 */
export function matchScore(command: Pick<Command, 'label' | 'keywords'>, query: string): number {
  const q = normalize(query)
  if (!q) return 1
  const label = command.label.toLowerCase()
  if (label.startsWith(q)) return 3
  const words = [...label.split(/[^a-z0-9%]+/), ...command.keywords.map(k => k.toLowerCase())]
  if (words.some(word => word.startsWith(q))) return 2
  return isSubsequence(q, label) ? 1 : 0
}

export interface CommandSection<C = unknown> {
  group: CommandGroup | 'recent'
  commands: Command<C>[]
  /** How many commands the empty-query Insert cap hides. */
  more?: number
}

/** The Insert commands an empty query shows, after the recently inserted ones. */
export const COMMON_INSERTS = ['insert:Container', 'insert:Text', 'insert:Button', 'insert:Image', 'insert:Row']

/** The Insert items an empty query shows, so the Actions stay in view. */
export const INSERT_LIMIT = 5

/** The empty-query Insert group: recently inserted, then the common components, at most `INSERT_LIMIT`. */
function cappedInserts<C>(inserts: Command<C>[], recent: readonly string[]): Command<C>[] {
  const order = [...recent.filter(id => id.startsWith('insert:')), ...COMMON_INSERTS]
  const picked = order.map(id => inserts.find(c => c.id === id)).filter(c => c !== undefined)
  return [...new Set([...picked, ...inserts])].slice(0, INSERT_LIMIT)
}

/**
 * The palette's sections for a query. With a query: the matching commands,
 * the groups ordered by their best match and each group by score (ties keep
 * the given order). Empty: the `recent` commands first (by id, most recent
 * first), then every group in `GROUP_ORDER`, with Insert capped (see
 * `cappedInserts`) unless `expandInsert`; its `more` counts the hidden ones.
 */
export function searchCommands<C>(commands: readonly Command<C>[], query: string, recent: readonly string[], options: { expandInsert?: boolean } = {}): CommandSection<C>[] {
  if (!normalize(query)) {
    const byId = new Map(commands.map(c => [c.id, c]))
    const recents = recent.map(id => byId.get(id)).filter(c => c !== undefined)
    const sections: CommandSection<C>[] = recents.length ? [{ group: 'recent', commands: recents }] : []
    for (const group of GROUP_ORDER) {
      const inGroup = commands.filter(c => c.group === group)
      if (!inGroup.length) continue
      if (group !== 'insert' || options.expandInsert || inGroup.length <= INSERT_LIMIT) {
        sections.push({ group, commands: inGroup })
        continue
      }
      const shown = cappedInserts(inGroup, recent)
      sections.push({ group, commands: shown, more: inGroup.length - shown.length })
    }
    return sections
  }
  const scored = commands.map(command => ({ command, score: matchScore(command, query) })).filter(s => s.score > 0)
  return GROUP_ORDER
    .map((group) => {
      const inGroup = scored.filter(s => s.command.group === group).sort((a, b) => b.score - a.score)
      return { group, best: inGroup[0]?.score ?? 0, commands: inGroup.map(s => s.command) }
    })
    .filter(s => s.commands.length)
    .sort((a, b) => b.best - a.best)
    .map(({ group, commands: inGroup }) => ({ group, commands: inGroup }))
}

export type EditorView = 'build' | 'data' | 'settings'

/** The Canvas view's sidebar panels. */
export type SidebarPanel = 'pages' | 'layers' | 'assets'

/** What the commands read and call on the editor (`useEditor()` provides it). */
export interface CommandEditor {
  mode: EditorView
  selectedIds: string[]
  selectedId: string | null
  page: { id: string, root: DocNode } | null
  project: { pages: { id: string, name: string, slug: string }[], collections: { id: string, name: string, slug: string }[] } | null
  history: { undo: string | null, redo: string | null }
  deepSelect: boolean
  previewDark: boolean
  sidebarPanel: SidebarPanel
  collectionId: string | null
  insert: (type: string) => unknown
  group: () => unknown
  autoLayout: () => unknown
  duplicate: () => unknown
  remove: () => unknown
  navigate: (step: SelectionStep) => unknown
  undo: () => unknown
  redo: () => unknown
  publish: () => unknown
  openPreview: () => unknown
  requestZoom: (command: 'fit' | 'reset') => unknown
  setPreviewDark: (value: boolean) => unknown
  setDeepSelect: (value: boolean) => unknown
  selectPage: (id: string) => unknown
}

export interface CommandContext {
  editor: CommandEditor
  openShortcuts: () => void
}

type EditorCommand = Command<CommandContext>

const onCanvas = ({ editor }: CommandContext) => editor.mode === 'build' && !!editor.page

/** The selected elements a delete or duplicate acts on (never the page root). */
const selection = ({ editor }: CommandContext) => (editor.page ? topLevelSelection(editor.page.root, editor.selectedIds) : [])

const hasSelection = (ctx: CommandContext) => onCanvas(ctx) && selection(ctx).length > 0

/** Wrap and auto layout take siblings, as the editor's do. */
function selectsSiblings(ctx: CommandContext): boolean {
  const root = ctx.editor.page?.root
  const ids = ctx.editor.selectedIds.filter(id => id !== root?.id)
  return onCanvas(ctx) && !!root && ids.length > 0 && !!siblingParent(root, ids)
}

const VIEWS: { id: EditorView, label: string, icon: string }[] = [
  { id: 'build', label: 'Canvas view', icon: 'i-lucide-frame' },
  { id: 'data', label: 'Data view', icon: 'i-lucide-database' },
  { id: 'settings', label: 'Settings view', icon: 'i-lucide-settings' }
]

/**
 * The quick actions for the editor's current state: insert any palette
 * component, the edit and view actions, go to a page, view, Styles or
 * collection, and the shortcuts sheet. Labels can read the state (e.g.
 * "Dark preview on"), so build them again when it changes.
 */
export function editorCommands(ctx: CommandContext): EditorCommand[] {
  const { editor } = ctx
  const always = () => true
  const action = (id: string, label: string, icon: string, keywords: string[], enabled: EditorCommand['enabled'], run: EditorCommand['run'], shortcut = shortcutKeys(id)): EditorCommand =>
    ({ id, group: 'actions', label, icon, keywords, shortcut, enabled, run })
  return [
    ...COMPONENTS.map((c): EditorCommand => ({
      id: `insert:${c.type}`,
      group: 'insert',
      label: c.label,
      icon: c.icon,
      keywords: [c.type],
      enabled: onCanvas,
      run: ({ editor }) => editor.insert(c.type)
    })),
    action('wrap', 'Wrap in Container', 'i-lucide-box-select', ['group'], selectsSiblings, ({ editor }) => editor.group(), shortcutKeys('group')),
    action('auto-layout', 'Auto layout', 'i-lucide-columns-3', ['row', 'column', 'stack'], selectsSiblings, ({ editor }) => editor.autoLayout()),
    action('duplicate', 'Duplicate', 'i-lucide-copy', ['copy', 'clone'], hasSelection, ({ editor }) => editor.duplicate()),
    action('delete', 'Delete', 'i-lucide-trash-2', ['remove'], hasSelection, ({ editor }) => editor.remove()),
    action('select-parent', 'Select parent', 'i-lucide-arrow-up-left', ['up'], c => onCanvas(c) && !!c.editor.selectedId && c.editor.selectedId !== c.editor.page?.root.id, ({ editor }) => editor.navigate('parent')),
    action('undo', 'Undo', 'i-lucide-undo-2', [], c => !!c.editor.history.undo, ({ editor }) => editor.undo()),
    action('redo', 'Redo', 'i-lucide-redo-2', [], c => !!c.editor.history.redo, ({ editor }) => editor.redo()),
    action('publish', 'Publish', 'i-lucide-rocket', ['deploy', 'release'], c => !!c.editor.project, ({ editor }) => editor.publish()),
    action('preview', 'Preview', 'i-lucide-play', ['open', 'draft'], c => !!c.editor.page, ({ editor }) => editor.openPreview()),
    action('zoom-fit', 'Zoom to fit', 'i-lucide-scan', ['fit'], onCanvas, ({ editor }) => editor.requestZoom('fit')),
    action('zoom-100', 'Zoom to 100%', 'i-lucide-zoom-in', ['reset', 'actual'], onCanvas, ({ editor }) => editor.requestZoom('reset')),
    action('dark-preview', `Dark preview ${editor.previewDark ? 'off' : 'on'}`, editor.previewDark ? 'i-lucide-sun' : 'i-lucide-moon', ['theme', 'toggle', 'light'], always, ({ editor }) => editor.setPreviewDark(!editor.previewDark)),
    action('deep-select', `Deep select ${editor.deepSelect ? 'off' : 'on'}`, 'i-lucide-mouse-pointer-2', ['drill', 'toggle'], always, ({ editor }) => editor.setDeepSelect(!editor.deepSelect)),
    ...(editor.project?.pages ?? []).map((page): EditorCommand => ({
      id: `page:${page.id}`,
      group: 'goto',
      label: page.name,
      hint: 'Page',
      icon: 'i-lucide-file',
      keywords: [page.slug, 'page'],
      enabled: c => !(c.editor.mode === 'build' && c.editor.page?.id === page.id),
      run: ({ editor }) => {
        editor.mode = 'build'
        editor.selectPage(page.id)
      }
    })),
    ...VIEWS.map((view): EditorCommand => ({
      id: `view:${view.id}`,
      group: 'goto',
      label: view.label,
      icon: view.icon,
      keywords: ['view', 'mode'],
      enabled: c => c.editor.mode !== view.id,
      run: ({ editor }) => {
        editor.mode = view.id
      }
    })),
    {
      id: 'styles',
      group: 'goto',
      label: 'Assets › Styles',
      icon: 'i-lucide-palette',
      keywords: ['styles', 'theme', 'design', 'colors'],
      enabled: always,
      run: ({ editor }) => {
        editor.mode = 'build'
        editor.sidebarPanel = 'assets'
      }
    },
    ...(editor.project?.collections ?? []).map((collection): EditorCommand => ({
      id: `collection:${collection.id}`,
      group: 'goto',
      label: collection.name,
      hint: 'Collection',
      icon: 'i-lucide-database',
      keywords: [collection.slug, 'collection'],
      enabled: always,
      run: ({ editor }) => {
        editor.collectionId = collection.id
        editor.mode = 'data'
      }
    })),
    {
      id: 'help:shortcuts',
      group: 'help',
      label: 'Keyboard shortcuts',
      icon: 'i-lucide-keyboard',
      keywords: ['help', 'keys', 'hotkeys'],
      enabled: always,
      run: c => c.openShortcuts()
    }
  ]
}

/** The recent command ids after running `id`: it moves to the front, at most `max` kept. */
export function pushRecent(recent: readonly string[], id: string, max = 5): string[] {
  return [id, ...recent.filter(other => other !== id)].slice(0, max)
}
