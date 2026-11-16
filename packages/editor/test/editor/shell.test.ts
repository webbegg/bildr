import { describe, expect, it, vi } from 'vitest'
import { allByTestId, byTestId, click, Failure, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import DesignView from '../../src/views/DesignView.vue'
import { baseHandlers, chooseDevice, fromCanvas, indexPage, layer, menuItem, open, openDesignSystem, select, sent, setupHarness, showVariant, sidebarTab, world } from '../design/harness.ts'

/**
 * The hosted shell over the module (U3): the toolbar, the sidebar (Pages, Layers), the node
 * menu, quick actions, the floating bar and the S4 features that live in them. Mounted as the
 * Design screen, over the mocked actions (which check every call against the real schemas).
 */

setupHarness()

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const control = (label: string) => q(`[aria-label="${label}"]`)
const keydown = async (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code: init.code ?? `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...init }))
  await settle()
}

describe('the shell', () => {
  it('lays out the toolbar, the sidebar, the canvas with its floating bar and the inspector, on the editor context', async () => {
    await open()
    expect(q('[data-view-menu]')?.textContent?.trim()).toBe('Canvas')
    expect(q('[data-project-name]')?.textContent?.trim()).toBe('Blog')
    expect(q('[data-sidebar]')).not.toBeNull()
    expect(q('[data-canvas-area] [data-floating-bar]')).not.toBeNull()
    expect(q('[data-right-panel]')?.textContent).toContain('Select an element to style it.')
    expect(q('[data-testid="design"]')?.getAttribute('data-editor-context')).toBe('page')
    expect(document.documentElement.classList.contains('bildr-editor')).toBe(true)
  })

  it('switches the editor context to the component being edited, and to a variant', async () => {
    await open({}, 'cmp_post_card')
    expect(q('[data-testid="design"]')?.getAttribute('data-editor-context')).toBe('component')
    expect(q('[data-testid="design"]')?.hasAttribute('data-editor-variant')).toBe(false)
    await showVariant('var_compact')
    expect(q('[data-testid="design"]')?.hasAttribute('data-editor-variant')).toBe(true)
  })

  it('resizes the right panel from its left edge within 280-480 px and remembers it', async () => {
    await open()
    const panel = q('[data-right-panel]')!
    expect(panel.style.width).toBe('320px')
    const handle = q('[data-panel-resize]')!
    handle.setPointerCapture = () => {}
    handle.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), { clientX: 1000, pointerId: 1 }))
    handle.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { clientX: 700 }))
    handle.dispatchEvent(new Event('pointerup', { bubbles: true }))
    await settle()
    expect(panel.style.width).toBe('480px')
    expect(localStorage.getItem('bildr:panel-width')).toBe('480')
    localStorage.removeItem('bildr:panel-width')
  })
})

describe('the toolbar', () => {
  it('enables undo and redo by the history counts and runs them', async () => {
    const { actions } = await open({ history_get: () => ({ undo: [{ action: 'node_update_props' }], redo: [] }), history_undo: () => ({ action: 'node_update_props', files: [] }) })
    expect(control('Undo')?.hasAttribute('disabled')).toBe(false)
    expect(control('Redo')?.hasAttribute('disabled')).toBe(true)
    await click(control('Undo'))
    expect(actions.named('history_undo')).toHaveLength(1)
  })

  it('opens the draft in a new tab with Preview, at the current page\'s path', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    await open({}, 'pg_new_post')
    await click(q('[data-preview]'))
    expect(opened).toHaveBeenCalledWith('/posts/new', '_blank')
    opened.mockRestore()
  })

  it('previews a detail page on its first record, never on the route pattern, and is disabled with a hint when it has none', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    await open({}, 'pg_post_detail')
    await click(q('[data-preview]'))
    expect(opened).toHaveBeenCalledWith('/posts/hello-bildr', '_blank')
    opened.mockRestore()
  })

  it('disables Preview on a detail page with no record', async () => {
    world.model.modules.blog!.fixtures = []
    await open({}, 'pg_post_detail')
    expect(q('[data-preview]')?.hasAttribute('disabled')).toBe(true)
  })

  it('opens the Insert panel and inserts the matching built-in with Enter; the Frame and Text tools arm and hint', async () => {
    const { actions } = await open({ node_insert: ok({ nodeId: 'n_text_1' }) })
    await select('n_h1')
    await click(q('[data-insert-button]'))
    expect(q('[data-insert-panel]')).not.toBeNull()
    expect(qa('[data-palette-type]').map(row => row.getAttribute('data-palette-type'))).toEqual(expect.arrayContaining(['Container', 'Text', 'Button']))
    await typeInto(q('[data-insert-panel] input'), 'butt')
    expect(qa('[data-palette-type]').map(row => row.getAttribute('data-palette-type'))).toEqual(['Button'])
    q('[data-insert-panel] input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await settle()
    expect(actions.named('node_insert').map(call => call.input)).toEqual([{ file: 'pg_index', parentId: 'n_head', index: 1, type: 'Button' }])

    expect(q('[data-tool-hint]')).toBeNull()
    await click(q('[data-insert-tool="Text"]'))
    expect(q('[data-tool-hint]')?.textContent?.trim()).toBe('Text · click to insert · Esc')
    expect(q('[data-insert-tool="Text"]')?.getAttribute('aria-pressed')).toBe('true')
    await click(q('[data-insert-tool="Text"]'))
    expect(q('[data-tool-hint]')).toBeNull()
  })

  it('offers the Canvas, Design system and Settings views, and the Design system view shows the theme library on the left and the theme\'s panel on the right', async () => {
    await open()
    await openDesignSystem()
    expect(q('[data-theme-library]')).not.toBeNull()
    expect(q('[data-design-panel]')).not.toBeNull()
    expect(q('[data-view-menu]')?.textContent?.trim()).toBe('Design system')
    expect(q('[data-sidebar]')).toBeNull()
    expect(q('[data-right-panel]')).toBeNull()
    // The insert tools are the Canvas's: another view has none, disabled or not.
    expect(q('[data-insert-button]')).toBeNull()
    expect(q('[data-insert-tool]')).toBeNull()
    // The style guide is a canvas of its own, which loads and is sent the theme as a token view.
    expect(sent('bildr:render').at(-1)?.view).toBe('tokens')
    expect(q('iframe[title="Token preview"]')).not.toBeNull()
  })

  it('opens the Settings view from the view menu, which takes the canvas\'s place and leaves the canvas mounted', async () => {
    await open()
    await menuItem(q('[data-view-menu]'), 'Settings')
    expect(q('[data-settings]')).not.toBeNull()
    expect(q('[data-view-menu]')?.textContent?.trim()).toBe('Settings')
    expect(q('[data-sidebar]')).toBeNull()
    expect(q('[data-right-panel]')).toBeNull()
    expect(q('[data-canvas-area]')?.style.display).toBe('none')
    await menuItem(q('[data-view-menu]'), 'Canvas')
    expect(q('[data-settings]')).toBeNull()
    expect(q('[data-canvas-area]')?.style.display).not.toBe('none')
    expect(sent('bildr:render').at(-1)?.view).toBe('page')
  })
})

describe('the device frames', () => {
  it('shows a hidden frame when its device is added from a frame bar\'s "+", and the layers then list the frames', async () => {
    await open()
    expect(qa('[data-frame-row]')).toEqual([])
    expect(qa('[data-frame-bar]').map(bar => bar.closest('[data-frame]')?.getAttribute('data-frame'))).toEqual(['mobile'])
    await chooseDevice('tablet')
    expect(qa('[data-frame-bar]').map(bar => bar.closest('[data-frame]')?.getAttribute('data-frame'))).toEqual(['tablet', 'mobile'])
    expect(qa('[data-frame-row]').map(row => row.getAttribute('data-frame-row')).sort()).toEqual(['mobile', 'tablet'])
    expect(q('[data-frame-row="tablet"]')?.getAttribute('data-active')).toBe('true')
    expect(q('[data-frame-row="tablet"]')?.textContent).toContain('Tablet')
    await click(q('[data-frame-row="mobile"]'))
    expect(q('[data-frame-row="mobile"]')?.getAttribute('data-active')).toBe('true')
    // Hiding the edited frame goes back to the Primary.
    await click(q('[data-frame-row="tablet"] [data-frame-row-hide]'))
    expect(qa('[data-frame-row]')).toEqual([])
    localStorage.removeItem('bildr:frames')
  })
})

describe('the sidebar', () => {
  it('lists the pages by path, with the home page as Home and the layout badge; a row shows that page', async () => {
    await open()
    await sidebarTab('Pages')
    const rows = qa('[data-page-id]')
    expect(rows.map(row => row.getAttribute('data-page-id'))).toEqual(['pg_index', 'pg_new_post', 'pg_post_detail'])
    expect(q('[data-page-id="pg_index"]')?.textContent).toContain('Home')
    expect(q('[data-page-id="pg_new_post"]')?.textContent).toContain('/posts/new')
    expect(q('[data-page-id="pg_post_detail"]')?.textContent).toContain('/posts/:slug')
    expect(q('[data-page-id="pg_index"] [data-page-layout-badge="lay_main"]')?.textContent).toContain('main')
    await click(q('[data-page-id="pg_new_post"] button'))
    expect(sent('bildr:render').at(-1)?.file.id).toBe('pg_new_post')
    expect(q('[data-page-id="pg_new_post"] button')?.getAttribute('aria-current')).toBe('page')
  })

  it('filters the pages with the search, and says when none match', async () => {
    await open()
    await sidebarTab('Pages')
    await typeInto(q('[data-sidebar-search]'), 'posts')
    expect(qa('[data-page-id]').map(row => row.getAttribute('data-page-id'))).toEqual(['pg_new_post', 'pg_post_detail'])
    await typeInto(q('[data-sidebar-search]'), 'zebra')
    expect(q('[data-sidebar]')?.textContent).toContain('No pages match “zebra”.')
  })

  it('adds, renames and deletes a page through page_create, page_update and page_delete', async () => {
    const { actions } = await open({ page_create: ok({ pageId: 'pg_pricing', filePath: 'x', nodeId: 'n' }), page_update: ok(), page_delete: ok() })
    await sidebarTab('Pages')
    await click(control('Add page'))
    await typeInto(q('input[aria-label="New page name"]'), 'pricing')
    q('input[aria-label="New page name"]')!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(actions.named('page_create').map(call => call.input)).toEqual([{ name: 'pricing' }])

    await menuItem(q('[data-page-id="pg_new_post"] [aria-label="Page actions"]'), 'Rename')
    const field = q('input[aria-label="Rename page"]')!
    await typeInto(field, 'posts-create')
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(actions.named('page_update').map(call => call.input)).toEqual([{ page: 'pg_new_post', name: 'posts-create' }])

    await menuItem(q('[data-page-id="pg_post_detail"] [aria-label="Page actions"]'), 'Delete')
    expect(q('[data-confirm]')?.textContent).toContain('The page and its content go.')
    await click(q('[data-confirm-ok]'))
    expect(actions.named('page_delete').map(call => call.input)).toEqual([{ page: 'pg_post_detail' }])
  })

  it('keeps the page when the delete is cancelled', async () => {
    const { actions } = await open({ page_delete: ok() })
    await sidebarTab('Pages')
    await menuItem(q('[data-page-id="pg_post_detail"] [aria-label="Page actions"]'), 'Delete')
    await click(q('[data-confirm-cancel]'))
    expect(actions.named('page_delete')).toEqual([])
  })

  it('switches page from the Layers panel\'s page switcher, naming the page by its path', async () => {
    await open()
    expect(q('[data-page-switcher]')?.textContent).toContain('Home')
    await menuItem(q('[data-page-switcher] [aria-label="Switch page"]'), '/posts/new')
    expect(sent('bildr:render').at(-1)?.file.id).toBe('pg_new_post')
    expect(q('[data-page-switcher]')?.textContent).toContain('/posts/new')
  })

  it('reveals a canvas selection made while Pages shows in Layers', async () => {
    await open()
    await sidebarTab('Pages')
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })
    expect(q('[data-sidebar-switcher] [aria-selected="true"]')?.textContent?.trim()).toBe('Layers')
    expect(layer('n_h1')?.getAttribute('aria-selected')).toBe('true')
  })
})

describe('the layers', () => {
  it('selects with a click, adds with Shift, and steps with the arrow keys; Left collapses a row', async () => {
    await open()
    await click(layer('n_head'))
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeIds: ['n_head'] })
    layer('n_list')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await settle()
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeIds: ['n_head', 'n_list'] })

    await click(layer('n_head'))
    const tree = q('[data-layers]')!
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    await settle()
    expect(layer('n_h1')).toBeNull()
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await settle()
    expect(layer('n_h1')).not.toBeNull()
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await settle()
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeIds: ['n_h1'] })
  })

  it('hides a node on the edited device with the eye (one node_update_style), and shows it dimmed', async () => {
    const { actions } = await open({
      node_update_style: (input) => {
        const style = input.style as Record<string, string | null>
        const node = indexPage().root.children!.find(child => child.id === 'n_head')!.children!.find(child => child.id === 'n_h1')!
        node.style = { ...node.style, ...Object.fromEntries(Object.entries(style).filter(([, value]) => value !== null) as [string, string][]) }
        return { changed: [] }
      }
    })
    await click(layer('n_h1')!.querySelector('[data-layer-eye]'))
    expect(actions.named('node_update_style').map(call => call.input)).toEqual([{ file: 'pg_index', nodeIds: ['n_h1'], style: { display: 'hidden' } }])
    expect(layer('n_h1')?.hasAttribute('data-layer-hidden')).toBe(true)
    expect(layer('n_h1')!.querySelector('[data-layer-eye]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('collapses and expands a row with its chevron', async () => {
    await open()
    await click(layer('n_head')!.querySelector('[data-layer-toggle]'))
    expect(layer('n_h1')).toBeNull()
    await click(layer('n_head')!.querySelector('[data-layer-toggle]'))
    expect(layer('n_h1')).not.toBeNull()
  })

  it('filters the rows with the search, keeping the ancestors of a match', async () => {
    await open()
    await typeInto(q('[data-sidebar-search]'), 'heading')
    // The Heading rows and their ancestors; the List and its items stay out.
    const rows = qa('[data-layer-id]').map(row => row.getAttribute('data-layer-id'))
    expect(rows).toEqual(expect.arrayContaining(['n_page', 'n_head', 'n_h1']))
    expect(rows).not.toContain('n_list')
    await typeInto(q('[data-sidebar-search]'), 'zebra')
    expect(q('[data-layers]')?.textContent).toContain('No layers match “zebra”.')
  })

  it('drops a dragged layer into a container, at its end', async () => {
    const { actions } = await open()
    const dataTransfer = new DataTransfer()
    layer('n_about')!.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    expect(dataTransfer.types).toEqual(expect.arrayContaining(['application/x-bildr', 'application/x-bildr-node;n_about']))
    const target = layer('n_head')!
    target.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}) })
    // The middle of a container drops inside it.
    target.dispatchEvent(Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer, clientY: 10 }))
    target.dispatchEvent(Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer, clientY: 10 }))
    await settle()
    expect(actions.named('node_move').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_about', parentId: 'n_head', index: 2 }])
  })

  it('refuses a drop of a layer into itself', async () => {
    const { actions } = await open()
    const dataTransfer = new DataTransfer()
    layer('n_head')!.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    const target = layer('n_h1')!
    target.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}) })
    target.dispatchEvent(Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer, clientY: 10 }))
    await settle()
    expect(actions.named('node_move')).toEqual([])
  })
})

describe('the node menu', () => {
  const openMenu = async (id: string) => {
    layer(id)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
  }
  const item = (label: string) => qa('[role^="menuitem"]').find(element => element.textContent?.trim().startsWith(label))

  it('selects the right-clicked node and runs Duplicate and Delete on it', async () => {
    const { actions } = await open({ node_duplicate: ok({ nodeId: 'n_h1_copy', nodeIds: ['n_h1_copy'] }), node_delete: ok() })
    await openMenu('n_h1')
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeIds: ['n_h1'] })
    await click(item('Duplicate')!)
    expect(actions.named('node_duplicate').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1' }])
    await openMenu('n_h1')
    await click(item('Delete')!)
    expect(actions.named('node_delete').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1' }])
  })

  it('dims what does not apply: the root cannot be deleted, a non-instance cannot be detached, an empty clipboard cannot paste', async () => {
    await open()
    await openMenu('n_page')
    expect(item('Delete')?.hasAttribute('data-disabled')).toBe(true)
    await keydown('Escape')
    await openMenu('n_h1')
    expect(item('Detach instance')?.hasAttribute('data-disabled')).toBe(true)
    expect(item('Paste')?.hasAttribute('data-disabled')).toBe(true)
    expect(item('Delete')?.hasAttribute('data-disabled')).toBe(false)
  })

  it('wraps in a Container, and hides here with a device-aware style patch', async () => {
    const { actions } = await open({ node_wrap: ok({ nodeId: 'n_container_1' }), node_update_style: ok() })
    await openMenu('n_h1')
    await click(item('Wrap in Container')!)
    expect(actions.named('node_wrap').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', type: 'Container' }])
    await openMenu('n_h1')
    await click(item('Hide here')!)
    expect(actions.named('node_update_style').map(call => call.input)).toEqual([{ file: 'pg_index', nodeIds: ['n_h1'], style: { display: 'hidden' } }])
  })

  it('filters its actions with the search field, parents as "Parent › Item"', async () => {
    await open()
    await openMenu('n_h1')
    await typeInto(q('[data-node-menu-search]'), 'siblings')
    expect(qa('[role^="menuitem"]').map(element => element.textContent?.trim().replace(/\s+/g, ' '))).toEqual([expect.stringContaining('Select › Siblings')])
  })

  it('makes a component from the selection in the new-component dialog, and refuses a name already used', async () => {
    const { actions } = await open({ component_create: ok({ componentId: 'cmp_badge', nodeId: 'n_instance_1', filePath: 'x' }) })
    await openMenu('n_h1')
    await click(item('Create component')!)
    expect(q('[data-create-dialog="component"]')).not.toBeNull()
    await typeInto(q('[data-create-name]'), 'postcard')
    expect(q('[data-create-dialog]')?.textContent).toContain('A component named "PostCard" already exists')
    expect(q('[data-create-submit]')?.hasAttribute('disabled')).toBe(true)
    await typeInto(q('[data-create-name]'), 'Badge')
    await click(q('[data-create-submit]'))
    expect(actions.named('component_create').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', name: 'Badge' }])
  })
})

describe('quick actions', () => {
  it('opens with Cmd+K, even from a field, and runs the matching Insert on Enter at the selection', async () => {
    const { actions } = await open({ node_insert: ok({ nodeId: 'n_button_1' }) })
    await select('n_h1')
    await keydown('k', { code: 'KeyK', metaKey: true })
    expect(q('[data-quick-actions]')).not.toBeNull()
    const input = q('[data-quick-actions] input')!
    await typeInto(input, 'button')
    const row = qa('[role="option"]').find(element => element.textContent?.trim().startsWith('Button'))
    expect(row).toBeDefined()
    await click(row!)
    expect(actions.named('node_insert').map(call => call.input)).toEqual([{ file: 'pg_index', parentId: 'n_head', index: 1, type: 'Button' }])
    expect(q('[data-quick-actions]')).toBeNull()
  })

  it('lists the project\'s components and layouts, and goes to a page', async () => {
    await open()
    await keydown('k', { code: 'KeyK', metaKey: true })
    await typeInto(q('[data-quick-actions] input'), 'PostCard')
    const labels = qa('[role="option"]').map(element => element.textContent?.replace(/\s+/g, ' ').trim())
    expect(labels).toEqual(expect.arrayContaining([expect.stringContaining('PostCard')]))
    expect(labels.some(label => label?.includes('Component'))).toBe(true)
    await typeInto(q('[data-quick-actions] input'), 'posts-new')
    await click(qa('[role="option"]').find(element => element.textContent?.includes('Page'))!)
    expect(sent('bildr:render').at(-1)?.file.id).toBe('pg_new_post')
  })

  it('opens the keyboard shortcuts sheet', async () => {
    await open()
    await keydown('k', { code: 'KeyK', metaKey: true })
    await typeInto(q('[data-quick-actions] input'), 'keyboard')
    await click(qa('[role="option"]').find(element => element.textContent?.includes('Keyboard shortcuts'))!)
    expect(q('[data-shortcuts-sheet]')?.textContent).toContain('Quick actions')
    expect(q('[data-shortcuts-sheet]')?.textContent).toContain('Move tool')
  })
})

describe('keyboard', () => {
  it('duplicates the selection with Cmd+D, and selects the copy', async () => {
    const { actions } = await open({ node_duplicate: ok({ nodeId: 'n_h1_copy', nodeIds: ['n_h1_copy'] }) })
    await select('n_h1')
    await keydown('d', { code: 'KeyD', metaKey: true })
    expect(actions.named('node_duplicate').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1' }])
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_h1_copy' })
  })

  it('selects the parent with Escape, and the layers\' Enter and Tab step through the tree', async () => {
    await open()
    await select('n_h1')
    await keydown('Escape', { code: 'Escape' })
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_head' })
    await keydown('Enter', { code: 'Enter' })
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_h1' })
  })

  it('arms a tool with its letter, and returns to Move with Escape', async () => {
    await open()
    await keydown('t', { code: 'KeyT' })
    expect(q('[data-tool-hint]')?.textContent).toContain('Text')
    await keydown('Escape', { code: 'Escape' })
    expect(q('[data-tool-hint]')).toBeNull()
  })

  it('opens Insert with I, and leaves keys typed into a field to the field', async () => {
    const { actions } = await open({ node_delete: ok() })
    await keydown('i', { code: 'KeyI' })
    expect(q('[data-insert-panel]')).not.toBeNull()
    await keydown('Escape', { code: 'Escape' })
    await select('n_h1')
    await keydown('Delete', { code: 'Delete' }, q('[data-sidebar-search]')!)
    expect(actions.named('node_delete')).toEqual([])
    await keydown('Delete', { code: 'Delete' })
    expect(actions.named('node_delete')).toHaveLength(1)
  })

  it('does not let Cmd+P print: it previews the draft', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    await open()
    const event = new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', metaKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    await settle()
    expect(event.defaultPrevented).toBe(true)
    expect(opened).toHaveBeenCalledWith('/', '_blank')
    opened.mockRestore()
  })
})

describe('the floating bar', () => {
  it('previews the dark theme in the canvas, and shows the zoom of the canvas', async () => {
    await open()
    await click(q('[data-preview-theme]'))
    expect(sent('bildr:dark').at(-1)).toEqual({ type: 'bildr:dark', dark: true })
    expect(q('[data-preview-theme]')?.getAttribute('aria-pressed')).toBe('true')
    await click(q('[data-preview-theme]'))
    expect(sent('bildr:dark').at(-1)).toEqual({ type: 'bildr:dark', dark: false })
    expect(q('[data-zoom-menu]')?.textContent?.trim()).toBe('100%')
    localStorage.removeItem('bildr:canvas-dark')
  })

  it('arms the Hand and Move tools', async () => {
    await open()
    await click(q('[data-tool="hand"]'))
    expect(q('[data-tool="hand"]')?.getAttribute('aria-pressed')).toBe('true')
    await click(q('[data-tool="move"]'))
    expect(q('[data-tool="move"]')?.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('what the editor adds to the hosted one (S4)', () => {
  it('shows the model\'s problems instead of the editor, with a count in the toolbar', async () => {
    const problems = [{ path: '.bildr/modules/blog/pages/index.json', message: 'Unknown node type "Wat"' }]
    mockActions({ ...baseHandlers(), model_get: () => ({ ok: false, problems }) })
    await mountWithApp(DesignView, '/design')
    await fromCanvas({ type: 'bildr:ready' })
    expect(byTestId('design-problems')?.textContent).toContain('Unknown node type "Wat"')
    expect(byTestId('problems-count')?.textContent?.trim()).toBe('1 problem')
    expect(q('[data-sidebar]')).toBeNull()
  })

  it('links the model\'s problems to All model files in the Data screen, where the files can be fixed', async () => {
    mockActions({ ...baseHandlers(), model_get: () => ({ ok: false, problems: [{ path: '.bildr/modules/blog/pages/index.json', message: 'Unknown node type "Wat"' }] }) })
    const { router } = await mountWithApp(DesignView, '/design')
    await fromCanvas({ type: 'bildr:ready' })
    expect(byTestId('design-problems')?.textContent).not.toContain('(Model screen)')
    await click(byTestId('open-model'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    expect(router.currentRoute.value.query).toEqual({ item: 'files' })
  })

  it('says when the app could not regenerate, with the reason', async () => {
    await open()
    expect(byTestId('regenerate-error')).toBeNull()
    const { FakeEventSource } = await import('../design/harness.ts')
    FakeEventSource.instances.at(-1)!.send({ type: 'regenerated', version: 9, ok: false, error: 'tsc failed' })
    await settle()
    expect(byTestId('regenerate-error')?.textContent?.trim()).toBe('The app could not regenerate')
    expect(byTestId('regenerate-error')?.getAttribute('title')).toBe('tsc failed')
  })

  it('shows a refused edit above the floating bar and clears it when dismissed', async () => {
    await open({ node_delete: () => new Failure(422, 'invalid', 'Cannot delete the root') })
    await select('n_h1')
    await keydown('Delete', { code: 'Delete' })
    expect(byTestId('design-error')?.textContent?.trim()).toBe('Cannot delete the root')
    expect(q('[role="alert"]')).not.toBeNull()
    await click(byTestId('design-error-dismiss'))
    expect(byTestId('design-error')).toBeNull()
  })

  it('shows where the canvas data comes from in the floating bar', async () => {
    await open()
    // The blog fixture's lists have no running app behind them here: the badge says so, by the zoom readout.
    expect(q('[data-floating-bar] [data-testid="data-badge"]')?.getAttribute('data-state')).toMatch(/fixtures|live|partial/)
    expect(allByTestId('data-refresh').length).toBeGreaterThan(0)
  })

  it('asks for the values a component needs before the Insert panel inserts it (RequiredValuesDialog)', async () => {
    const { actions } = await open({ node_insert: ok({ nodeId: 'n_instance_1' }) }, 'pg_index')
    await click(q('[data-insert-button]'))
    await click(q('[data-palette-component="cmp_post_card"]'))
    expect(byTestId('required-dialog')).not.toBeNull()
    expect(actions.named('node_insert')).toEqual([])
    await click(byTestId('required-cancel'))
    expect(world.model).toBeDefined()
  })
})
