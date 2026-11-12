import { describe, expect, it, vi } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import type { CommandContext, CommandEditor } from '#shared/editor/commands'
import { editorCommands, filterMenuItems, matchScore, pushRecent, searchCommands, shortcutKeys, SHORTCUTS, shortcutsFor } from '#shared/editor/commands'
import { INSERT_TOOLS } from '#shared/editor/insertTools'

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
    cmd('view:data', 'goto', 'Data view'),
    cmd('help:shortcuts', 'help', 'Keyboard shortcuts')
  ]

  it('orders the groups by their best match, and the commands within a group by score', () => {
    const sections = searchCommands(commands, 'da', [])
    expect(sections.map(s => s.group)).toEqual(['goto', 'actions'])
    expect(sections[0]!.commands.map(c => c.id)).toEqual(['view:data'])
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
    expect(section.commands.map(c => c.label)).toEqual(['Container', 'Text', 'Button', 'Image', 'Row'])
    expect(section.more).toBe(5)
  })

  it('puts the recently inserted components first', () => {
    const section = insertSection(searchCommands(commands, '', ['wrap', 'insert:Card', 'insert:Text']))
    expect(section.commands.map(c => c.label)).toEqual(['Card', 'Text', 'Container', 'Button', 'Image'])
    expect(section.more).toBe(5)
  })

  it('lists every component once expanded, or for a typed query', () => {
    const expanded = insertSection(searchCommands(commands, '', [], { expandInsert: true }))
    expect(expanded.commands).toHaveLength(10)
    expect(expanded.more).toBeUndefined()
    const typed = insertSection(searchCommands(commands, 'comp', []))
    expect(typed.commands).toHaveLength(10)
    expect(typed.more).toBeUndefined()
  })
})

describe('SHORTCUTS', () => {
  const combos = SHORTCUTS.flatMap(s => s.keys.map(keys => keys.join('+')))

  it('lists every editor shortcut once', () => {
    expect([...combos].sort()).toEqual([
      'a', 'alt', 'alt+1', 'b', 'c', 'delete', 'enter', 'escape', 'f', 'h', 'i', 'meta+alt+b', 'meta+alt+k', 'meta+alt+v', 'meta+c', 'meta+d', 'meta+f', 'meta+g', 'meta+k', 'meta+l', 'meta+p', 'meta+r', 'meta+shift+z', 'meta+v', 'meta+z',
      'r', 'shift+0', 'shift+1', 'shift+2', 'shift+a', 'shift+enter', 'shift+tab', 'space', 't', 'tab', 'v'
    ])
  })

  it('lists the P1 shortcuts: Esc selects the parent, rename, lock, copy and paste, zoom to the selection', () => {
    expect(shortcutKeys('select-parent')).toEqual(['escape'])
    expect(SHORTCUTS.find(s => s.id === 'select-parent')?.keys).toEqual([['escape'], ['shift', 'enter']])
    expect(shortcutKeys('rename')).toEqual(['meta', 'r'])
    expect(shortcutKeys('lock')).toEqual(['meta', 'l'])
    expect(shortcutKeys('copy')).toEqual(['meta', 'c'])
    expect(shortcutKeys('paste')).toEqual(['meta', 'v'])
    expect(shortcutKeys('paste-style')).toEqual(['meta', 'alt', 'v'])
    expect(shortcutKeys('zoom-selection')).toEqual(['shift', '2'])
  })

  it('lists Create component as ⌥⌘K (Ctrl+Alt+K)', () => {
    expect(shortcutKeys('create-component')).toEqual(['meta', 'alt', 'k'])
  })

  it('lists Detach instance as ⌥⌘B (Ctrl+Alt+B), as in Framer', () => {
    expect(shortcutKeys('detach-instance')).toEqual(['meta', 'alt', 'b'])
    expect(SHORTCUTS.find(s => s.id === 'detach-instance')?.label).toBe('Detach instance')
  })

  it('lists the device shortcuts of the visible frames (shortcutsFor)', () => {
    const devices = (frames: Parameters<typeof shortcutsFor>[0]) => shortcutsFor(frames)
      .filter(s => s.id.startsWith('device:'))
      .map(s => [s.label, s.keys.map(k => k.join('+')).join(' ')])
    expect(devices(['desktop', 'tablet', 'large-phone', 'mobile'])).toEqual([
      ['Edit Desktop · 1280', 'alt+1'],
      ['Edit Tablet · 768', 'alt+2'],
      ['Edit Large phone · 640', 'alt+3'],
      ['Edit Mobile · 390', 'alt+4']
    ])
    expect(devices(['desktop', 'mobile'])).toEqual([
      ['Edit Desktop · 1280', 'alt+1'],
      ['Edit Mobile · 390', 'alt+2']
    ])
    const all = shortcutsFor(['desktop', 'tablet', 'large-phone', 'mobile']).flatMap(s => s.keys.map(keys => keys.join('+')))
    expect(new Set(all).size).toBe(all.length)
  })

  it('gives each canvas tool the letters that arm it', () => {
    for (const tool of INSERT_TOOLS.filter(t => t.keys.length)) {
      expect(SHORTCUTS.find(s => s.id === `tool:${tool.id}`)?.keys).toEqual(tool.keys.map(key => [key.toLowerCase()]))
    }
  })
})

describe('filterMenuItems', () => {
  const items = [
    [{ label: 'Duplicate' }, { label: 'Wrap in', children: [{ label: 'Row' }, { label: 'Column' }] }],
    [{ label: 'Rename' }, { label: 'Lock', disabled: true }]
  ]

  it('keeps the menu as it is for an empty query', () => {
    expect(filterMenuItems(items, '  ')).toBe(items)
  })

  it('flattens the matching items, sub-items labelled with their parent, best first', () => {
    expect(filterMenuItems(items, 'lo')).toEqual([[{ label: 'Lock', disabled: true }]])
    expect(filterMenuItems(items, 'col')).toEqual([[{ label: 'Wrap in › Column' }]])
    expect(filterMenuItems(items, 'wrap').flat().map(i => i.label)).toEqual(['Wrap in › Row', 'Wrap in › Column'])
  })

  it('is empty when nothing matches', () => {
    expect(filterMenuItems(items, 'zzz')).toEqual([])
  })
})

describe('editorCommands', () => {
  function fixture(state: Partial<CommandEditor> = {}) {
    const home = createPage('Home')
    const pricing = createPage('Pricing')
    const card = createNode('Card')
    const text = createNode('Text')
    const button = createNode('Button')
    card.children.push(button)
    home.root.children.push(card, text)
    const editor: CommandEditor = {
      mode: 'build',
      selectedIds: [],
      selectedId: null,
      page: home,
      project: { pages: [home, pricing], collections: [{ id: 'c1', name: 'Menu', slug: 'menu' }] },
      history: { undo: null, redo: null },
      deepSelect: true,
      previewDark: false,
      sidebarPanel: 'pages',
      collectionId: null,
      deviceId: 'mobile',
      setDevice: vi.fn(),
      insert: vi.fn(),
      group: vi.fn(),
      autoLayout: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
      navigate: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      publish: vi.fn(),
      openPreview: vi.fn(),
      requestZoom: vi.fn(),
      setPreviewDark: vi.fn(),
      setDeepSelect: vi.fn(),
      selectPage: vi.fn(),
      importRequest: 0,
      variablesRequest: 0,
      run: vi.fn(async () => ({ collectionId: 'c2' })),
      ...state
    }
    const ctx: CommandContext = { editor, openShortcuts: vi.fn() }
    const get = (id: string) => editorCommands(ctx).find(c => c.id === id)!
    return { ctx, editor, get, home, pricing, card, text, button }
  }

  it('offers every palette component to insert, on the Canvas only', () => {
    const { ctx, editor, get } = fixture()
    expect(editorCommands(ctx).filter(c => c.group === 'insert').map(c => c.label)).toContain('Button')
    get('insert:Button').run(ctx)
    expect(editor.insert).toHaveBeenCalledWith('Button')
    expect(fixture({ mode: 'data' }).get('insert:Button').enabled(fixture({ mode: 'data' }).ctx)).toBe(false)
  })

  it('disables the selection actions with no selection, or only the page root', () => {
    const { ctx, get, home } = fixture()
    for (const id of ['delete', 'duplicate', 'wrap', 'auto-layout', 'select-parent']) expect(get(id).enabled(ctx), id).toBe(false)
    ctx.editor.selectedIds = [home.root.id]
    ctx.editor.selectedId = home.root.id
    for (const id of ['delete', 'duplicate', 'wrap', 'auto-layout', 'select-parent']) expect(get(id).enabled(ctx), id).toBe(false)
  })

  it('enables them for a selected element, and runs them through the editor', () => {
    const { ctx, editor, get, text } = fixture()
    editor.selectedIds = [text.id]
    editor.selectedId = text.id
    for (const id of ['delete', 'duplicate', 'wrap', 'auto-layout', 'select-parent']) expect(get(id).enabled(ctx), id).toBe(true)
    get('delete').run(ctx)
    get('wrap').run(ctx)
    get('select-parent').run(ctx)
    expect(editor.remove).toHaveBeenCalled()
    expect(editor.group).toHaveBeenCalled()
    expect(editor.navigate).toHaveBeenCalledWith('parent')
  })

  it('only wraps or lays out siblings', () => {
    const { ctx, editor, get, text, button } = fixture()
    editor.selectedIds = [text.id, button.id]
    expect(get('wrap').enabled(ctx)).toBe(false)
    expect(get('auto-layout').enabled(ctx)).toBe(false)
    expect(get('delete').enabled(ctx)).toBe(true)
  })

  it('enables undo and redo by the history, in any view', () => {
    const { ctx, get } = fixture({ mode: 'data', history: { undo: 'node_insert', redo: null } })
    expect(get('undo').enabled(ctx)).toBe(true)
    expect(get('redo').enabled(ctx)).toBe(false)
  })

  it('zooms the canvas on the Canvas only', () => {
    const { ctx, editor, get } = fixture()
    get('zoom-fit').run(ctx)
    expect(editor.requestZoom).toHaveBeenCalledWith('fit')
    expect(get('zoom-100').shortcut).toEqual(['shift', '0'])
    editor.mode = 'settings'
    expect(get('zoom-fit').enabled(ctx)).toBe(false)
  })

  it('toggles the dark preview and Deep select to the other state', () => {
    const { ctx, editor, get } = fixture({ previewDark: true, deepSelect: false })
    expect(get('dark-preview').label).toBe('Dark preview off')
    expect(get('deep-select').label).toBe('Deep select on')
    get('dark-preview').run(ctx)
    get('deep-select').run(ctx)
    expect(editor.setPreviewDark).toHaveBeenCalledWith(false)
    expect(editor.setDeepSelect).toHaveBeenCalledWith(true)
  })

  it('goes to another page on the Canvas', () => {
    const { ctx, editor, get, home, pricing } = fixture({ mode: 'data' })
    get(`page:${pricing.id}`).run(ctx)
    expect(editor.mode).toBe('build')
    expect(editor.selectPage).toHaveBeenCalledWith(pricing.id)
    expect(get(`page:${home.id}`).enabled(ctx)).toBe(false)
  })

  it('switches views, except to the one showing', () => {
    const { ctx, editor, get } = fixture()
    expect(get('view:build').enabled(ctx)).toBe(false)
    get('view:data').run(ctx)
    expect(editor.mode).toBe('data')
  })

  it('opens the Design view as "Design system", from any other view', () => {
    const { ctx, editor, get } = fixture({ mode: 'settings' })
    expect(get('design-system').label).toBe('Design system')
    expect(searchCommands(editorCommands(ctx), 'design sys', [])[0]!.commands[0]!.id).toBe('design-system')
    get('design-system').run(ctx)
    expect(editor.mode).toBe('design')
    expect(get('design-system').enabled(ctx)).toBe(false)
    expect(get('view:design').label).toBe('Design view')
  })

  it('opens a collection in Data', () => {
    const { ctx, editor, get } = fixture({ mode: 'settings' })
    get('collection:c1').run(ctx)
    expect([editor.mode, editor.collectionId]).toEqual(['data', 'c1'])
  })

  it('creates an Untitled collection with a free name, and shows it in Data', async () => {
    const { ctx, editor, get } = fixture({ project: { pages: [], collections: [{ id: 'c1', name: 'Untitled', slug: 'untitled' }] } })
    expect(get('data:new-collection').label).toBe('New collection')
    await get('data:new-collection').run(ctx)
    expect(editor.run).toHaveBeenCalledWith('collection_create', { name: 'Untitled 2' })
    expect([editor.mode, editor.collectionId]).toEqual(['data', 'c2'])
  })

  it('asks the Data view for the Import from API dialog', () => {
    const { ctx, editor, get } = fixture()
    expect(get('data:import-api').label).toBe('Import from API')
    get('data:import-api').run(ctx)
    get('data:import-api').run(ctx)
    expect([editor.mode, editor.importRequest]).toEqual(['data', 2])
  })

  it('opens Settings at the environment variables, from any view', () => {
    const { ctx, editor, get } = fixture({ mode: 'settings' })
    expect(get('settings:variables').label).toBe('Environment variables')
    expect(get('settings:variables').enabled(ctx)).toBe(true)
    expect(searchCommands(editorCommands(ctx), 'secret', [])[0]!.commands[0]!.id).toBe('settings:variables')
    editor.mode = 'build'
    get('settings:variables').run(ctx)
    expect([editor.mode, editor.variablesRequest]).toEqual(['settings', 1])
  })

  it('opens Settings to delete the project, from any view', () => {
    const { ctx, editor, get } = fixture({ mode: 'data' })
    expect(get('settings:delete-project').label).toBe('Delete project…')
    expect(get('settings:delete-project').enabled(ctx)).toBe(true)
    expect(searchCommands(editorCommands(ctx), 'delete project', [])[0]!.commands[0]!.id).toBe('settings:delete-project')
    get('settings:delete-project').run(ctx)
    expect(editor.mode).toBe('settings')
    expect(fixture({ project: null }).get('settings:delete-project').enabled(fixture({ project: null }).ctx)).toBe(false)
  })

  it('edits another device frame, with Alt + 1–3, on the Canvas only', () => {
    const { ctx, editor, get } = fixture({ frames: ['desktop', 'tablet', 'mobile'] })
    expect(['device:desktop', 'device:tablet', 'device:mobile'].map(id => [get(id).label, get(id).shortcut?.join('+')])).toEqual([
      ['Edit Desktop', 'alt+1'],
      ['Edit Tablet', 'alt+2'],
      ['Edit Mobile', 'alt+3']
    ])
    expect(get('device:mobile').enabled(ctx)).toBe(false)
    expect(get('device:tablet').enabled(ctx)).toBe(true)
    get('device:tablet').run(ctx)
    expect(editor.setDevice).toHaveBeenCalledWith('tablet')
    editor.mode = 'data'
    expect(get('device:tablet').enabled(ctx)).toBe(false)
  })

  it('follows the visible frames: a hidden frame is not offered, the digits count the shown ones', () => {
    expect(fixture().get('device:large-phone').enabled(fixture().ctx)).toBe(false)
    const { ctx, get } = fixture({ frames: ['desktop', 'tablet', 'large-phone', 'mobile'] })
    expect(['device:large-phone', 'device:mobile'].map(id => [get(id).label, get(id).shortcut?.join('+')])).toEqual([
      ['Edit Large phone', 'alt+3'],
      ['Edit Mobile', 'alt+4']
    ])
    expect(get('device:large-phone').enabled(ctx)).toBe(true)
  })

  it('gives a hidden frame no shortcut, and the next frame takes its digit', () => {
    const { get } = fixture({ frames: ['desktop', 'mobile'] })
    expect(get('device:tablet').shortcut).toBeUndefined()
    expect(get('device:large-phone').shortcut).toBeUndefined()
    expect(get('device:mobile').shortcut).toEqual(['alt', '2'])
  })

  it('opens the shortcuts sheet', () => {
    const { ctx, get } = fixture()
    get('help:shortcuts').run(ctx)
    expect(ctx.openShortcuts).toHaveBeenCalled()
  })

  it('hints only shortcuts from the registry', () => {
    const combos = new Set(SHORTCUTS.flatMap(s => s.keys.map(keys => keys.join('+'))))
    for (const command of editorCommands(fixture().ctx).filter(c => c.shortcut)) expect(combos, command.id).toContain(command.shortcut!.join('+'))
  })
})

describe('pushRecent', () => {
  it('moves the command to the front, without duplicates, keeping at most `max`', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c', 3)).toEqual(['c', 'a', 'b'])
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
})
