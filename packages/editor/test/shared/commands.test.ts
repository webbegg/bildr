import { describe, expect, it, vi } from 'vitest'
import type { ModelNode } from '@bildr/codegen/model'
import type { CommandContext, CommandEditor } from '../../src/shared/commands.ts'
import { editorCommands, filterMenuItems, matchScore, pushRecent, searchCommands, shortcutKeys, SHORTCUTS, shortcutsFor } from '../../src/shared/commands.ts'

/** Ported from the hosted `test/editor/commands.test.ts`: the ranking, the Insert cap, the menu search and the editor's commands over the model's pages. */

const cmd = (id: string, group: 'insert' | 'actions' | 'goto' | 'help', label: string, keywords: string[] = []) =>
  ({ id, group, label, keywords, enabled: () => true, run: () => {} })

describe('matchScore', () => {
  it('ranks a label prefix over a word start over a subsequence, ignoring case', () => {
    expect(matchScore(cmd('a', 'actions', 'Wrap in Container'), 'wra')).toBe(3)
    expect(matchScore(cmd('a', 'actions', 'Wrap in Container'), 'cont')).toBe(2)
    expect(matchScore(cmd('a', 'actions', 'Wrap in Container'), 'wic')).toBe(1)
    expect(matchScore(cmd('a', 'actions', 'Wrap in Container'), 'xyz')).toBe(0)
  })

  it('counts a keyword prefix as a word start', () => {
    expect(matchScore(cmd('a', 'actions', 'Delete', ['remove']), 'rem')).toBe(2)
  })

  it('matches everything for an empty query', () => {
    expect(matchScore(cmd('a', 'actions', 'Delete'), '  ')).toBe(1)
  })
})

describe('searchCommands', () => {
  const commands = [
    cmd('insert:Card', 'insert', 'Card'),
    cmd('insert:Button', 'insert', 'Button'),
    cmd('action:dark', 'actions', 'Toggle dark preview'),
    cmd('view:design', 'goto', 'Design view'),
    cmd('help:shortcuts', 'help', 'Keyboard shortcuts')
  ]

  it('orders the groups by their best match, and the commands within a group by score', () => {
    const sections = searchCommands(commands, 'da', [])
    expect(sections.map(s => s.group)).toEqual(['actions'])
    expect(searchCommands(commands, 'des', []).map(s => s.group)).toEqual(['goto'])
  })

  it('drops the commands that do not match', () => {
    // "but" would also be in order in "keyBoard shortcUTs"; "butt" is not.
    expect(searchCommands(commands, 'butt', []).flatMap(s => s.commands.map(c => c.id))).toEqual(['insert:Button'])
  })

  it('shows the recent commands first for an empty query, then every group in its fixed order', () => {
    const sections = searchCommands(commands, '', ['help:shortcuts', 'insert:Button', 'gone'])
    expect(sections.map(s => s.group)).toEqual(['recent', 'insert', 'actions', 'goto', 'help'])
    expect(sections[0]!.commands.map(c => c.id)).toEqual(['help:shortcuts', 'insert:Button'])
  })
})

describe('the Insert cap for an empty query', () => {
  const inserts = ['Container', 'Row', 'Column', 'Grid', 'Heading', 'Text', 'Image', 'Button', 'Link', 'Card'].map(type => cmd(`insert:${type}`, 'insert', type, ['component']))
  const commands = [...inserts, cmd('wrap', 'actions', 'Wrap in Container')]
  const insertSection = (sections: ReturnType<typeof searchCommands>) => sections.find(s => s.group === 'insert')!

  it('shows the 5 most common components, and counts the rest', () => {
    const section = insertSection(searchCommands(commands, '', []))
    expect(section.commands.map(c => c.id)).toEqual(['insert:Container', 'insert:Text', 'insert:Button', 'insert:Image', 'insert:Row'])
    expect(section.more).toBe(5)
  })

  it('puts the recently inserted first, and lists everything when expanded', () => {
    expect(insertSection(searchCommands(commands, '', ['insert:Card'])).commands[0]!.id).toBe('insert:Card')
    const expanded = insertSection(searchCommands(commands, '', [], { expandInsert: true }))
    expect(expanded.commands).toHaveLength(10)
    expect(expanded.more).toBeUndefined()
  })
})

describe('filterMenuItems', () => {
  const groups = [[{ label: 'Duplicate' }, { label: 'Select', children: [{ label: 'Same type' }, { label: 'Siblings' }] }], [{ label: 'Delete' }]]

  it('returns the groups for an empty query, and one flat best-match-first group otherwise', () => {
    expect(filterMenuItems(groups, ' ')).toBe(groups)
    expect(filterMenuItems(groups, 'del')).toEqual([[{ label: 'Delete' }]])
    expect(filterMenuItems(groups, 'sib')).toEqual([[{ label: 'Select › Siblings' }]])
    expect(filterMenuItems(groups, 'zz')).toEqual([])
  })
})

describe('pushRecent', () => {
  it('moves a command to the front and keeps at most five', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd'])
  })
})

describe('shortcuts', () => {
  it('lists the ⌥ + digit of the visible frames only', () => {
    const labels = (frames: Parameters<typeof shortcutsFor>[0]) => shortcutsFor(frames).filter(entry => entry.id.startsWith('device:')).map(entry => entry.id)
    expect(labels(['mobile'])).toEqual(['device:mobile'])
    expect(labels(['mobile', 'tablet', 'desktop']).sort()).toEqual(['device:desktop', 'device:mobile', 'device:tablet'])
    expect(SHORTCUTS.map(entry => entry.id)).toContain('quick-actions')
    expect(shortcutKeys('quick-actions')).toEqual(['meta', 'k'])
    expect(shortcutKeys('nope')).toBeUndefined()
  })
})

describe('editorCommands', () => {
  const n = (id: string, type: string, children: ModelNode[] = []): ModelNode => ({ id, type, ...(children.length ? { children } : {}) })

  const context = (extra: Partial<CommandEditor> = {}) => {
    const root = n('root', 'Page', [n('h', 'Heading'), n('t', 'Text')])
    const editor = {
      mode: 'build',
      selectedIds: [] as string[],
      selectedId: null as string | null,
      page: { id: 'pg_index', root },
      pages: [{ id: 'pg_index', name: 'index', path: '/' }, { id: 'pg_about', name: 'about', path: '/about' }],
      history: { undo: 1, redo: 0 },
      deepSelect: true,
      previewDark: false,
      sidebarPanel: 'pages',
      deviceId: 'mobile',
      importRequest: 0,
      collections: [{ name: 'Post' }],
      createCollection: vi.fn(),
      insert: vi.fn(),
      group: vi.fn(),
      autoLayout: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
      navigate: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      openPreview: vi.fn(),
      requestZoom: vi.fn(),
      setPreviewDark: vi.fn(),
      setDeepSelect: vi.fn(),
      selectPage: vi.fn(),
      setDevice: vi.fn(),
      ...extra
    } as CommandEditor & Record<string, unknown>
    const ctx: CommandContext = { editor, insertTypes: [{ type: 'Text', label: 'Text', icon: 'i-lucide-type' }, { type: 'Card', label: 'Card', icon: 'i-lucide-square' }], openShortcuts: vi.fn() }
    return { ctx, editor, commands: editorCommands(ctx) }
  }
  const find = (commands: ReturnType<typeof editorCommands>, id: string) => commands.find(command => command.id === id)!

  it('has an Insert command per palette type, which inserts through the editor', () => {
    const { ctx, editor, commands } = context()
    expect(commands.filter(command => command.group === 'insert').map(command => command.id)).toEqual(['insert:Text', 'insert:Card'])
    find(commands, 'insert:Card').run(ctx)
    expect(editor.insert).toHaveBeenCalledWith('Card')
  })

  it('offers no Publish command: the module has none; the Data view and its two commands are back', () => {
    const { commands } = context()
    const ids = commands.map(command => command.id)
    expect(ids).not.toContain('publish')
    expect(ids.filter(id => id.startsWith('data:'))).toEqual(['data:new-collection', 'data:import-api'])
    expect(ids).toEqual(expect.arrayContaining(['view:build', 'view:data', 'view:design', 'view:settings', 'settings:variables', 'design-system', 'help:shortcuts']))
  })

  it('opens the Data view, which is its own screen', () => {
    const { ctx, editor, commands } = context()
    expect(find(commands, 'view:data').label).toBe('Data view')
    find(commands, 'view:data').run(ctx)
    expect(editor.mode).toBe('data')
  })

  it('Import from API asks the Data view for its dialog first, so the screen that opens has the request', () => {
    const { ctx, editor, commands } = context()
    const seen: number[] = []
    Object.defineProperty(editor, 'mode', { configurable: true, get: () => 'build', set: () => seen.push(editor.importRequest) })
    find(commands, 'data:import-api').run(ctx)
    expect(seen).toEqual([1])
  })

  it('New collection makes an "Untitled" one (numbered while the name is taken), then opens the Data view', async () => {
    const { ctx, editor, commands } = context({ collections: [{ name: 'Untitled' }] })
    await find(commands, 'data:new-collection').run(ctx)
    expect(editor.createCollection).toHaveBeenCalledWith('Untitled2')
    expect(editor.mode).toBe('data')
  })

  it('opens the Settings view, and Environment variables asks it to scroll to them', () => {
    const { ctx, editor, commands } = context({ variablesRequest: 0 })
    find(commands, 'view:settings').run(ctx)
    expect(editor.mode).toBe('settings')
    find(commands, 'settings:variables').run(ctx)
    expect(editor.variablesRequest).toBe(1)
  })

  it('goes to a page by its name or path, and is disabled on the page that shows', () => {
    const { ctx, editor, commands } = context()
    const about = find(commands, 'page:pg_about')
    expect(about.keywords).toContain('/about')
    expect(find(commands, 'page:pg_index').enabled(ctx)).toBe(false)
    about.run(ctx)
    expect(editor.selectPage).toHaveBeenCalledWith('pg_about')
  })

  it('enables Delete and Duplicate with a selection, and Wrap only for siblings', () => {
    const none = context()
    expect(find(none.commands, 'delete').enabled(none.ctx)).toBe(false)
    const some = context({ selectedIds: ['h', 't'], selectedId: 't' })
    expect(find(some.commands, 'delete').enabled(some.ctx)).toBe(true)
    expect(find(some.commands, 'wrap').enabled(some.ctx)).toBe(true)
    const root = context({ selectedIds: ['root'], selectedId: 'root' })
    expect(find(root.commands, 'delete').enabled(root.ctx)).toBe(false)
  })

  it('enables Preview unless a detail page has no record to show (the component view previews elsewhere)', () => {
    expect(find(context().commands, 'preview').enabled(context().ctx)).toBe(true)
    const none = context({ previewHint: 'Add a record to preview this detail page' })
    expect(find(none.commands, 'preview').enabled(none.ctx)).toBe(false)
    const inComponent = context({ previewHint: 'Add a record to preview this detail page', component: {} })
    expect(find(inComponent.commands, 'preview').enabled(inComponent.ctx)).toBe(true)
  })

  it('enables Undo and Redo by the history counts, and labels the toggles by their state', () => {
    const { ctx, commands } = context()
    expect(find(commands, 'undo').enabled(ctx)).toBe(true)
    expect(find(commands, 'redo').enabled(ctx)).toBe(false)
    expect(find(commands, 'dark-preview').label).toBe('Dark preview on')
    expect(find(context({ previewDark: true }).commands, 'dark-preview').label).toBe('Dark preview off')
  })

  it('edits only the visible frames, naming their shortcut', () => {
    const { ctx, commands } = context({ frames: ['mobile', 'desktop'] })
    expect(find(commands, 'device:desktop').enabled(ctx)).toBe(true)
    expect(find(commands, 'device:tablet').enabled(ctx)).toBe(false)
    expect(find(commands, 'device:mobile').enabled(ctx)).toBe(false)
  })

  it('switches the view, and leaves Canvas-only commands off in the Design view', () => {
    const { ctx, editor, commands } = context({ mode: 'design' })
    expect(find(commands, 'insert:Text').enabled(ctx)).toBe(false)
    expect(find(commands, 'design-system').enabled(ctx)).toBe(false)
    find(commands, 'view:build').run(ctx)
    expect(editor.mode).toBe('build')
  })
})
