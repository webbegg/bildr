import { describe, expect, it } from 'vitest'
import { settle } from '../helpers.ts'
import { boot, Failure, find, indexPage, ok, setupHarness, world } from './boot.ts'
import { instanceDragPayload } from '../../src/editor/drop.ts'

/**
 * The adapter's node operations (U2, S3): each is one module action through the
 * store's `edit`, with the input the action takes (`file`, `nodeId`...), and selects
 * what the hosted editor selected afterwards.
 */

setupHarness()

const tipOptional = () => {
  for (const property of world.model.modules.blog!.components.find(component => component.id === 'cmp_tip')!.properties) delete property.required
}

const inputs = (actions: Awaited<ReturnType<typeof boot>>['actions'], name: string) => actions.named(name).map(call => call.input)

describe('insert', () => {
  it('inserts a palette type at the selection and selects the new node', async () => {
    const { editor, actions } = await boot({ node_insert: ok({ nodeId: 'n_new' }) }, 'pg_index')
    editor.selectedId = 'n_head'
    await editor.insert('Text')
    expect(inputs(actions, 'node_insert')).toEqual([{ file: 'pg_index', parentId: 'n_head', type: 'Text' }])
    expect(editor.selectedId).toBe('n_new')
  })

  it('takes a target and props; into an instance goes after it', async () => {
    const { editor, actions } = await boot({ node_insert: ok({ nodeId: 'n_new' }) }, 'pg_index')
    await editor.insert('Button', { parentId: 'n_head', index: 1 }, { label: 'Go' })
    await editor.insert('Text', { parentId: 'n_card', index: 0 })
    expect(inputs(actions, 'node_insert')).toEqual([
      { file: 'pg_index', parentId: 'n_head', index: 1, type: 'Button', props: { label: 'Go' } },
      { file: 'pg_index', parentId: 'n_list', index: 1, type: 'Text' }
    ])
  })

  it('an insert tool inserts on the next canvas click and returns to Move', async () => {
    const { editor, actions } = await boot({ node_insert: ok({ nodeId: 'n_new' }) }, 'pg_index')
    editor.setTool('Text')
    await editor.insertWithTool({ parentId: 'n_head', index: 0 })
    expect(editor.tool).toBe('move')
    expect(inputs(actions, 'node_insert')).toEqual([{ file: 'pg_index', parentId: 'n_head', index: 0, type: 'Text' }])
    await editor.insertWithTool({ parentId: 'n_head', index: 0 })
    expect(actions.named('node_insert')).toHaveLength(1)
  })

  it('an instance of a component goes in; a component never goes into itself', async () => {
    tipOptional()
    const { editor, actions } = await boot({ node_insert: ok({ nodeId: 'n_new' }) }, 'pg_index')
    await editor.insertInstance('cmp_tip', { parentId: 'n_head', index: 0 })
    expect(inputs(actions, 'node_insert')).toEqual([{ file: 'pg_index', parentId: 'n_head', index: 0, type: 'Instance', props: { component: 'cmp_tip' } }])
    editor.editComponent('cmp_tip')
    await settle()
    await editor.insertInstance('cmp_tip')
    expect(actions.named('node_insert')).toHaveLength(1)
  })

  it('a component with a required property waits for its values (the store\'s dialog)', async () => {
    const { editor, actions } = await boot({ node_insert: ok({ nodeId: 'n_new' }) }, 'pg_index')
    await editor.insertInstance('cmp_tip', { parentId: 'n_head', index: 0 })
    expect(actions.named('node_insert')).toHaveLength(0)
    expect(editor.pendingInsert?.needs.map(property => property.id)).toEqual(['prop_title'])
    await editor.confirmInsert({ prop_title: 'Hi' })
    expect(inputs(actions, 'node_insert')).toEqual([{ file: 'pg_index', parentId: 'n_head', index: 0, type: 'Instance', props: { component: 'cmp_tip', values: { prop_title: 'Hi' } } }])
  })

  it('shows the refusal in the store\'s error', async () => {
    const { editor } = await boot({ node_insert: () => new Failure(422, 'invalid', 'A Text takes no children') }, 'pg_index')
    await editor.insert('Text', { parentId: 'n_h1', index: 0 })
    expect(editor.error).toBe('A Text takes no children')
    editor.dismissError()
    expect(editor.error).toBeNull()
  })
})

describe('remove, duplicate, wrap, group', () => {
  it('removes the selection in one action and selects the neighbour', async () => {
    const { editor, actions } = await boot({ node_delete: ok() }, 'pg_index')
    editor.selectedId = 'n_list'
    await editor.remove()
    expect(inputs(actions, 'node_delete')).toEqual([{ file: 'pg_index', nodeId: 'n_list' }])
    expect(editor.selectedIds).toEqual(['n_quotes'])
    editor.selectedIds = ['n_head', 'n_about']
    await editor.remove()
    expect(inputs(actions, 'node_delete').at(-1)).toEqual({ file: 'pg_index', nodeIds: ['n_head', 'n_about'] })
  })

  it('removes a node by id, never the root', async () => {
    const { editor, actions } = await boot({ node_delete: ok() }, 'pg_index')
    await editor.remove('n_page')
    expect(actions.named('node_delete')).toHaveLength(0)
    await editor.remove('n_about')
    expect(inputs(actions, 'node_delete')).toEqual([{ file: 'pg_index', nodeId: 'n_about' }])
  })

  it('duplicates the selection and selects the copies', async () => {
    const { editor, actions } = await boot({ node_duplicate: ok({ nodeId: 'n_c1', nodeIds: ['n_c1', 'n_c2'] }) }, 'pg_index')
    editor.selectedIds = ['n_head', 'n_about']
    await editor.duplicate()
    expect(inputs(actions, 'node_duplicate')).toEqual([{ file: 'pg_index', nodeIds: ['n_head', 'n_about'] }])
    expect(editor.selectedIds).toEqual(['n_c1', 'n_c2'])
  })

  it('wraps and groups siblings in document order and selects the container', async () => {
    const { editor, actions } = await boot({ node_wrap: ok({ nodeId: 'n_wrap' }) }, 'pg_index')
    await editor.wrap('n_head', 'Row')
    // A layout kind is a preset: a Container with its tokens (layout-containers T5).
    expect(inputs(actions, 'node_wrap')).toEqual([{ file: 'pg_index', nodeId: 'n_head', preset: 'Row' }])
    expect(editor.selectedId).toBe('n_wrap')
    editor.selectedIds = ['n_about', 'n_head']
    await editor.group()
    expect(inputs(actions, 'node_wrap').at(-1)).toEqual({ file: 'pg_index', nodeIds: ['n_head', 'n_about'], type: 'Container' })
    await editor.wrap(['n_page'])
    expect(actions.named('node_wrap')).toHaveLength(2)
  })

  it('converts the legacy layouts at and under a node to Containers in one action, and says how many (layout-containers T7)', async () => {
    const { editor, actions, toasts } = await boot({ node_convert: ok({ converted: ['n_head', 'n_about'] }) }, 'pg_index')
    await editor.convertLayouts('n_page')
    expect(inputs(actions, 'node_convert')).toEqual([{ file: 'pg_index', nodeId: 'n_page', subtree: true }])
    expect(toasts.map(toast => toast.title)).toEqual(['Converted 2 layouts to Container'])
  })

  it('grouping a selection that is not siblings notifies and writes nothing', async () => {
    const { editor, actions, toasts } = await boot({ node_wrap: ok({ nodeId: 'n_wrap' }) }, 'pg_index')
    editor.selectedIds = ['n_h1', 'n_about']
    await editor.group()
    expect(actions.named('node_wrap')).toHaveLength(0)
    expect(toasts.map(toast => toast.title)).toEqual(['Select siblings to group'])
  })
})

describe('props, style, names, locks', () => {
  it('updateProps is node_update_props, or an override while a variant is active', async () => {
    const { editor, actions } = await boot({ node_update_props: ok(), component_variant_set_override: ok() }, 'pg_index')
    await editor.updateProps('n_h1', { text: 'Hi' })
    expect(inputs(actions, 'node_update_props')).toEqual([{ file: 'pg_index', nodeId: 'n_h1', props: { text: 'Hi' } }])
    editor.editComponent('cmp_post_card')
    editor.selectVariant('var_compact')
    await editor.updateProps('n_excerpt', { hidden: false })
    expect(inputs(actions, 'component_variant_set_override')).toEqual([{ component: 'cmp_post_card', variant: 'var_compact', nodeId: 'n_excerpt', props: { hidden: false } }])
  })

  it('updateStyle writes tokens of one node or several as one action, and previews until it is done', async () => {
    const { editor, actions } = await boot({ node_update_style: ok() }, 'pg_index')
    editor.previewStyle('n_head', { p: '4' })
    expect(editor.stylePreview).toEqual({ nodeId: 'n_head', style: { p: '4' } })
    await editor.updateStyle('n_head', { 'p': '4', 'md:p': null })
    expect(editor.stylePreview).toBeNull()
    await editor.updateStyle(['n_head', 'n_about'], { gap: '2' })
    expect(inputs(actions, 'node_update_style')).toEqual([
      { file: 'pg_index', nodeIds: ['n_head'], style: { 'p': '4', 'md:p': null } },
      { file: 'pg_index', nodeIds: ['n_head', 'n_about'], style: { gap: '2' } }
    ])
  })

  it('updateStyles gives each node its own patch in one action', async () => {
    const { editor, actions } = await boot({ node_update_style: ok() }, 'pg_index')
    await editor.updateStyles([{ nodeId: 'n_h1', style: { color: 'primary' } }, { nodeId: 'n_about', style: { bg: 'muted' } }])
    await editor.updateStyles([{ nodeId: 'n_h1', style: { color: null } }])
    expect(inputs(actions, 'node_update_style')).toEqual([
      { file: 'pg_index', updates: [{ nodeId: 'n_h1', style: { color: 'primary' } }, { nodeId: 'n_about', style: { bg: 'muted' } }] },
      { file: 'pg_index', nodeId: 'n_h1', style: { color: null } }
    ])
  })

  it('renameNode renames, clears an empty name and skips the unchanged one', async () => {
    find(indexPage().root, 'n_h1')!.name = 'Title'
    const { editor, actions } = await boot({ node_rename: ok() }, 'pg_index')
    editor.startRename('n_head')
    expect(editor.renamingId).toBe('n_head')
    expect(editor.sidebarPanel).toBe('layers')
    await editor.renameNode('n_head', ' Top bar ')
    expect(editor.renamingId).toBeNull()
    await editor.renameNode('n_h1', '')
    await editor.renameNode('n_h1', 'Title')
    expect(inputs(actions, 'node_rename')).toEqual([{ file: 'pg_index', nodeId: 'n_head', name: 'Top bar' }, { file: 'pg_index', nodeId: 'n_h1', name: null }])
  })

  it('setLocked and toggleLock lock and unlock, never the root', async () => {
    const { editor, actions } = await boot({ node_set_locked: ok() }, 'pg_index')
    await editor.setLocked(['n_page', 'n_head'], true)
    editor.selectedId = 'n_head'
    await editor.toggleLock()
    await editor.toggleLock('n_page')
    expect(inputs(actions, 'node_set_locked')).toEqual([{ file: 'pg_index', nodeId: 'n_head', locked: true }, { file: 'pg_index', nodeId: 'n_head', locked: true }])
  })
})

describe('moves', () => {
  it('moveBy steps one place among the siblings, and is nothing at the end', async () => {
    const { editor, actions } = await boot({ node_move: ok() }, 'pg_index')
    await editor.moveBy('n_head', 1)
    await editor.moveBy('n_head', -1)
    expect(inputs(actions, 'node_move')).toEqual([{ file: 'pg_index', nodeId: 'n_head', parentId: 'n_page', index: 1 }])
    expect(editor.selectedId).toBe('n_head')
  })

  it('moveSelection moves every selected node in one node_move_many', async () => {
    const { editor, actions } = await boot({ node_move_many: ok() }, 'pg_index')
    editor.selectedIds = ['n_list', 'n_quotes']
    await editor.moveSelection(1)
    expect(inputs(actions, 'node_move_many')).toEqual([{ file: 'pg_index', moves: [{ nodeId: 'n_quotes', parentId: 'n_page', index: 3 }, { nodeId: 'n_list', parentId: 'n_page', index: 2 }] }])
    editor.selectedIds = ['n_about']
    await editor.moveSelection(1)
    expect(actions.named('node_move_many')).toHaveLength(1)
  })

  it('from the canvas a locked node stays where it is; from the layers it moves', async () => {
    const { editor, actions } = await boot({ node_move_many: ok() }, 'lay_main')
    editor.selectedIds = ['n_header']
    await editor.moveSelection(1, { canvas: true })
    expect(actions.named('node_move_many')).toHaveLength(0)
    await editor.moveSelection(1)
    expect(inputs(actions, 'node_move_many')).toEqual([{ file: 'lay_main', moves: [{ nodeId: 'n_header', parentId: 'n_root', index: 1 }] }])
  })

  it('dropping a layer moves it, converting the slot; a drop onto itself does nothing', async () => {
    tipOptional()
    const { editor, actions } = await boot({ node_move: ok(), node_insert: ok({ nodeId: 'n_new' }) }, 'pg_index')
    await editor.drop(JSON.stringify({ kind: 'node', id: 'n_head' }), { parentId: 'n_page', index: 3 })
    await editor.drop(JSON.stringify({ kind: 'node', id: 'n_head' }), { parentId: 'n_page', index: 0 })
    await editor.drop(JSON.stringify({ kind: 'node', id: 'n_head' }), { parentId: 'n_h1', index: 0 })
    await editor.drop(JSON.stringify({ kind: 'component', type: 'Text' }), { parentId: 'n_about', index: 1 })
    await editor.drop(instanceDragPayload('cmp_tip'), { parentId: 'n_about', index: 0 })
    expect(inputs(actions, 'node_move')).toEqual([{ file: 'pg_index', nodeId: 'n_head', parentId: 'n_page', index: 2 }])
    expect(inputs(actions, 'node_insert')).toEqual([
      { file: 'pg_index', parentId: 'n_about', index: 1, type: 'Text' },
      { file: 'pg_index', parentId: 'n_about', index: 0, type: 'Instance', props: { component: 'cmp_tip' } }
    ])
  })

  it('dropping a layout tile sets the page layout', async () => {
    const page = world.model.modules.blog!.pages.find(entry => entry.id === 'pg_new_post')!
    delete page.layout
    delete page.layoutValues
    const { editor, actions } = await boot({ page_set_layout: ok() }, 'pg_new_post')
    await editor.drop(JSON.stringify({ kind: 'layout', layoutId: 'lay_main' }), { parentId: 'n_page', index: 0 })
    expect(inputs(actions, 'page_set_layout')).toEqual([{ page: 'pg_new_post', layout: 'lay_main' }])
  })

  it('changing a layout that holds layout values asks first, and Cancel writes nothing', async () => {
    const { editor, actions } = await boot({ page_set_layout: ok() }, 'pg_new_post')
    const asked = editor.setPageLayout(null)
    expect(editor.confirmRequest?.title).toBe('Change the layout?')
    editor.confirmRequest?.answer(false)
    await asked
    expect(actions.named('page_set_layout')).toHaveLength(0)
    const again = editor.setPageLayout(null)
    editor.confirmRequest?.answer(true)
    await again
    expect(inputs(actions, 'page_set_layout')).toEqual([{ page: 'pg_new_post', layout: null }])
  })
})

describe('clipboard', () => {
  it('copy and paste are the store\'s: paste inserts a copy exactly as it was', async () => {
    const { editor, actions } = await boot({ node_insert: ok({ nodeIds: ['n_copy'] }) }, 'pg_index')
    editor.selectedId = 'n_h1'
    editor.copy()
    editor.selectedId = 'n_head'
    await editor.paste()
    const [call] = inputs(actions, 'node_insert')
    expect(call).toMatchObject({ file: 'pg_index', exact: true, parentId: 'n_head', nodes: [{ type: 'Heading' }] })
    expect(editor.selectedIds).toEqual(['n_copy'])
    expect(editor.clipboard?.id).toBe('n_h1')
  })

  it('a paste over the node it copied lands after it, not inside it (also a container)', async () => {
    const { editor, actions } = await boot({ node_insert: ok({ nodeIds: ['n_copy'] }) }, 'pg_index')
    const parent = editor.page!.root.children!.find(child => child.children?.some(grand => grand.id === 'n_head')) ?? editor.page!.root
    editor.selectedId = 'n_head'
    editor.copy()
    await editor.paste()
    const [call] = inputs(actions, 'node_insert') as Array<{ parentId?: string, index?: number }>
    expect(call!.parentId).toBe(parent.id)
    expect(call!.index).toBe(parent.children!.findIndex(child => child.id === 'n_head') + 1)
  })

  it('a paste in another file, over a node that only shares the copied id, goes where an insert would go', async () => {
    // Node ids are minted per file, so another page can have an `n_head` of its own.
    const other = world.model.modules.blog!.pages.find(page => page.id === 'pg_new_post')!
    other.root.children = [...(other.root.children ?? []), { id: 'n_head', type: 'Row', children: [] }]
    const { editor, actions } = await boot({ node_insert: ok({ nodeIds: ['n_copy'] }) }, 'pg_index')
    editor.selectedId = 'n_head'
    editor.copy()
    await editor.selectPage('pg_new_post')
    editor.selectedId = 'n_head'
    await editor.paste()
    const [call] = inputs(actions, 'node_insert') as Array<{ file: string, parentId?: string, index?: number }>
    expect(call!.file).toBe('pg_new_post')
    // That Row is not the copied node: the paste goes inside it, as any insert into a selected container would.
    expect(call!.parentId).toBe('n_head')
  })

  it('copying a multi-selection pastes all of it in one insert (one undo step), in document order', async () => {
    const { editor, actions } = await boot({ node_insert: ok({ nodeIds: ['n_a', 'n_b'] }) }, 'pg_index')
    editor.selectedIds = ['n_list', 'n_head']
    editor.copy()
    editor.selectedId = 'n_about'
    await editor.paste()
    const calls = inputs(actions, 'node_insert') as Array<{ nodes: Array<{ type: string }> }>
    expect(calls).toHaveLength(1)
    expect(calls[0]!.nodes.map(node => node.type)).toEqual(['Row', 'List'])
    expect(editor.selectedIds).toEqual(['n_a', 'n_b'])
  })

  it('copy(id) copies that node without selecting it', async () => {
    const { editor } = await boot({}, 'pg_index')
    editor.selectedId = 'n_head'
    editor.copy('n_about')
    expect(editor.clipboard?.id).toBe('n_about')
    expect(editor.selectedIds).toEqual(['n_head'])
  })

  it('pasteStyle gives the selection the copied node\'s style and removes the tokens it lacks', async () => {
    const { editor, actions } = await boot({ node_update_style: ok() }, 'pg_index')
    editor.copy('n_about')
    editor.selectedId = 'n_head'
    await editor.pasteStyle()
    const [call] = inputs(actions, 'node_update_style') as Array<{ style: Record<string, string | null> }>
    const about = (editor.page?.root.children ?? []).find(child => child.id === 'n_about')!
    const head = (editor.page?.root.children ?? []).find(child => child.id === 'n_head')!
    expect(call).toMatchObject({ file: 'pg_index', nodeIds: ['n_head'] })
    for (const [key, value] of Object.entries(about.style ?? {})) expect(call!.style[key]).toBe(value)
    for (const key of Object.keys(head.style ?? {})) if (!(key in (about.style ?? {}))) expect(call!.style[key]).toBeNull()
  })
})

describe('auto layout', () => {
  it('wraps stacked siblings in a Column with the nearest gap token, in visual order', async () => {
    const { editor, actions } = await boot({ node_wrap: ok({ nodeId: 'n_wrap' }) }, 'pg_index')
    editor.setMeasurer(async ids => ids.map((id, i) => ({ id, x: 0, y: i * 120, width: 300, height: 100 })))
    editor.selectedIds = ['n_head', 'n_list']
    await editor.autoLayout()
    const [call] = inputs(actions, 'node_wrap') as Array<{ style: { gap: string } }>
    expect(call).toMatchObject({ file: 'pg_index', nodeIds: ['n_head', 'n_list'], preset: 'Column' })
    expect(typeof call!.style.gap).toBe('string')
  })

  it('gives a flex container without a direction the one its children sit in', async () => {
    const { editor, actions } = await boot({ node_update_style: ok() }, 'pg_index')
    editor.setMeasurer(async ids => ids.map((id, i) => ({ id, x: i * 120, y: 0, width: 100, height: 40 })))
    editor.selectedId = 'n_head'
    await editor.autoLayout()
    const head = (editor.page?.root.children ?? []).find(child => child.id === 'n_head')!
    if (head.style?.direction === undefined) expect(inputs(actions, 'node_update_style')).toEqual([{ file: 'pg_index', nodeIds: ['n_head'], style: { direction: 'row' } }])
  })

  it('a press on a layout that has its direction cycles Stack → Grid → None → Stack (layout-containers L4)', async () => {
    const { editor, actions } = await boot({ node_update_style: ok() }, 'pg_index')
    const child = (id: string) => (editor.page?.root.children ?? []).find(node => node.id === id)!
    child('n_head').style = { ...child('n_head').style, direction: 'row' }
    editor.selectedId = 'n_head'
    await editor.autoLayout()
    editor.selectedId = 'n_about'
    await editor.autoLayout()
    child('n_about').style = { ...child('n_about').style, display: 'block' }
    await editor.autoLayout()
    expect(inputs(actions, 'node_update_style').map(call => (call as { style: unknown }).style)).toEqual([
      { display: 'grid', cols: '2' },
      { display: 'block' },
      { display: 'flex' }
    ])
  })

  it('Alt+Shift+A removes the layout of every selected one in one step: block flow, children in order (layout-containers L4)', async () => {
    const { editor, actions } = await boot({ node_update_style: ok() }, 'pg_index')
    editor.selectedIds = ['n_head', 'n_about', 'n_h1']
    await editor.removeLayout()
    expect(inputs(actions, 'node_update_style')).toEqual([{ file: 'pg_index', updates: [{ nodeId: 'n_head', style: { display: 'block' } }, { nodeId: 'n_about', style: { display: 'block' } }] }])
  })

  it('unwraps a layout container and selects its children (layout-containers L4)', async () => {
    const { editor, actions } = await boot({ node_unwrap: ok({ nodeIds: ['n_h1', 'n_toggle'] }) }, 'pg_index')
    editor.selectedId = 'n_head'
    await editor.unwrap()
    expect(inputs(actions, 'node_unwrap')).toEqual([{ file: 'pg_index', nodeId: 'n_head' }])
    expect(editor.selectedIds).toEqual(['n_h1', 'n_toggle'])
    editor.selectedId = 'n_h1'
    await editor.unwrap()
    expect(actions.named('node_unwrap')).toHaveLength(1)
  })
})

describe('the store keeps the rules', () => {
  it('writes go through the store\'s queue in order and a refusal never reaches the model', async () => {
    const { editor, actions, design } = await boot({ node_rename: ok(), node_set_locked: ok() }, 'pg_index')
    await Promise.all([editor.renameNode('n_head', 'A'), editor.setLocked(['n_head'], true)])
    expect(actions.calls.filter(call => call.name.startsWith('node_')).map(call => call.name)).toEqual(['node_rename', 'node_set_locked'])
    expect(design.error.value).toBeNull()
  })
})
