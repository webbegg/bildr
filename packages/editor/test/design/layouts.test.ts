import { describe, expect, it } from 'vitest'
import { byTestId, click, Failure, settle, typeInto } from '../helpers.ts'
import { byLabel, fromCanvas, indexPage, mainLayout, menuItem, must, open, propInput, propRow, propSelect, sectionAdd, select, selectLayer, selectOption, sent, setupHarness, sidebarTab, typeNumber } from './harness.ts'

/**
 * Layouts in the Design screen (P4c, V1, V2): the Layouts section, a layout's
 * slots and variables, and on a page the layout picker, the values for the
 * layout's variables and the content for its slots.
 */

setupHarness()

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const layoutRow = (id: string) => document.body.querySelector<HTMLElement>(`[data-layout-id="${id}"]`)
const actionsOf = (id: string) => layoutRow(id)!.querySelector('[aria-label="Layout actions"]')
const pick = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const MAIN = 'lay_main'

describe('Layouts section', () => {
  it('lists the layouts with the pages using each; a row opens the layout in the canvas', async () => {
    await open()
    await sidebarTab('Assets')
    expect([...document.body.querySelectorAll('[data-layout-id]')].map(row => row.getAttribute('data-layout-id'))).toEqual([MAIN])
    expect(layoutRow(MAIN)!.textContent).toContain('main')
    expect(layoutRow(MAIN)!.querySelector('[data-layout-pages]')?.getAttribute('data-layout-pages')).toBe('3')
    await click(layoutRow(MAIN)!.querySelector('button'))
    expect(sent('bildr:render').at(-1)?.file.id).toBe(MAIN)
  })

  it('creates a layout, named in the dialog', async () => {
    const { actions } = await open({ layout_create: ok({ layoutId: 'lay_docs', slotNodeId: 'n', filePath: 'x' }) })
    await sidebarTab('Assets')
    await click(pick('[aria-label="New layout"]'))
    expect(pick('[data-create-dialog="layout"]')).not.toBeNull()
    await typeInto(pick('[data-create-name]'), 'docs')
    await click(pick('[data-create-submit]'))
    expect(actions.named('layout_create').map(call => call.input)).toEqual([{ name: 'docs' }])
  })

  it('creates a layout from the top-level layers selected on a page without one', async () => {
    delete indexPage().layout
    const { actions } = await open({ layout_create_from_selection: ok({ layoutId: 'lay_site', slotNodeId: 'n', filePath: 'x' }) })
    await select('n_head')
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_list', shift: true, meta: false })
    // The node menu's "Create layout from selection…" on a selected layer opens the dialog.
    const row = document.body.querySelector<HTMLElement>('[data-layer-id="n_head"]')!
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    const item = [...document.body.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(element => element.textContent?.includes('Create layout from selection'))
    expect(item?.getAttribute('data-disabled')).toBeNull()
    await click(item!)
    await typeInto(pick('[data-create-name]'), 'site')
    await click(pick('[data-create-submit]'))
    expect(actions.named('layout_create_from_selection').map(call => call.input)).toEqual([{ page: 'pg_index', nodeIds: ['n_head', 'n_list'], name: 'site' }])
  })

  it('renames, duplicates and deletes a layout, showing the refusal of a delete in use', async () => {
    const message = 'Layout "main" is used by 1 page: pg_index. Give them another layout first'
    const { actions } = await open({ layout_rename: ok(), layout_duplicate: ok({ layoutId: 'lay_x', filePath: 'x' }), layout_delete: () => new Failure(422, 'invalid', message) })
    await sidebarTab('Assets')
    await menuItem(actionsOf(MAIN), 'Rename')
    const name = pick('input[aria-label="Layout name"]')!
    await typeInto(name, 'site')
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    await menuItem(actionsOf(MAIN), 'Duplicate')
    await menuItem(actionsOf(MAIN), 'Delete')
    // The confirm names the pages that would lose the layout, then the module's refusal shows.
    expect(pick('[data-confirm-items]')?.textContent).toContain('index')
    await click(pick('[data-confirm-ok]'))
    expect(actions.named('layout_rename').map(call => call.input)).toEqual([{ layout: MAIN, name: 'site' }])
    expect(actions.named('layout_duplicate').map(call => call.input)).toEqual([{ layout: MAIN }])
    expect(actions.named('layout_delete').map(call => call.input)).toEqual([{ layout: MAIN }])
    expect(byTestId('design-error')?.textContent?.trim()).toBe(message)
  })
})

const rowOf = (name: string) => byLabel(name)!.closest<HTMLElement>('.group\\/row')!

describe('Slots and variables of a layout', () => {
  it('lists the slots and variables of the layout on its root, with its name; the children slot is the page content, not renamed or removed', async () => {
    await open({}, MAIN)
    // With nothing selected the inspector shows only its hint (U-E2): the root is selected first.
    expect(pick('[data-layout-settings]')).toBeNull()
    await select('n_root')
    expect(must('[data-layout-settings]').textContent).toContain('Name')
    expect((byLabel('Layout name') as HTMLInputElement).value).toBe('main')
    expect(pick('[data-layout-slots]')?.getAttribute('data-style-section')).toBe('Slots')
    expect([...document.body.querySelectorAll('[data-layout-slots] [aria-label$=" slot name"]')].map(input => input.getAttribute('aria-label'))).toEqual(['children slot name', 'footer slot name'])
    expect(rowOf('children slot name').textContent).toContain('Page content')
    expect(rowOf('children slot name').querySelector('[data-row-remove]')).toBeNull()
    expect((byLabel('children slot name') as HTMLInputElement).disabled).toBe(true)
    expect(rowOf('title variable name').textContent).toContain('Text')
  })

  it('explains the page content slot when its container is selected', async () => {
    await open({}, MAIN)
    expect(pick('[data-layout-page-content]')).toBeNull()
    await select('n_main')
    expect(pick('[data-layout-page-content]')?.textContent).toContain('3 pages now')
  })

  it('makes a container a slot named Slot, renames a slot and removes one', async () => {
    const { actions } = await open({ layout_slot_add: ok({ slotId: 'side' }), layout_slot_update: ok(), layout_slot_remove: ok() }, MAIN)
    // The root takes no slot of its own: its + has no menu.
    await select('n_root')
    expect(pick('[data-layout-slots] [data-section-action="add"]')).toBeNull()

    await selectLayer('n_nav')
    await menuItem(sectionAdd('data-layout-slots'), 'Make slot')
    await select('n_root')
    await typeInto(byLabel('footer slot name'), 'bottom')
    await click(rowOf('footer slot name').querySelector<HTMLElement>('[data-row-remove]'))

    expect(actions.named('layout_slot_add').map(call => call.input)).toEqual([{ layout: MAIN, name: 'Slot', nodeId: 'n_nav' }])
    expect(actions.named('layout_slot_update').map(call => call.input)).toEqual([{ layout: MAIN, slot: 'footer', name: 'bottom' }])
    expect(actions.named('layout_slot_remove').map(call => call.input)).toEqual([{ layout: MAIN, slot: 'footer' }])
  })

  it('turns a prop or a style key of the selected node into a variable, renames one and removes one', async () => {
    const { actions } = await open({ layout_variable_add: ok({ variableId: 'prop_label' }), layout_variable_update: ok(), layout_variable_remove: ok() }, MAIN)
    await selectLayer('n_brand')
    await menuItem(sectionAdd('data-layout-variables'), 'Label')
    await menuItem(sectionAdd('data-layout-variables'), 'Style · Background')
    await select('n_root')
    await typeInto(byLabel('title variable name'), 'tagline')
    await click(rowOf('title variable name').querySelector<HTMLElement>('[data-row-remove]'))

    const [prop, style] = actions.named('layout_variable_add').map(call => call.input)
    expect(prop).toEqual({ layout: MAIN, name: 'Label', kind: 'text', bindings: [{ nodeId: 'n_brand', prop: 'text' }] })
    expect(style).toMatchObject({ layout: MAIN, name: 'Background', kind: 'select', bindings: [{ nodeId: 'n_brand', prop: 'bg', target: 'style' }] })
    expect(actions.named('layout_variable_update').map(call => call.input)).toEqual([{ layout: MAIN, variable: 'prop_title', name: 'tagline' }])
    expect(actions.named('layout_variable_remove').map(call => call.input)).toEqual([{ layout: MAIN, variable: 'prop_title' }])
  })

  it('renames the layout from its Name row', async () => {
    const { actions } = await open({ layout_rename: ok() }, MAIN)
    await select('n_root')
    await typeInto(byLabel('Layout name'), 'site')
    expect(actions.named('layout_rename').map(call => call.input)).toEqual([{ layout: MAIN, name: 'site' }])
  })

  it('edits a variable in the variables modal: its default and its details, and deletes it after a confirm', async () => {
    const { actions } = await open({ layout_variable_update: ok(), layout_variable_remove: ok() }, MAIN)
    await select('n_root')
    await click(must('[data-layout-variables] [data-section-action="edit"]'))
    expect(must('[data-properties-modal]').getAttribute('data-properties-kind')).toBe('layout')
    expect(must('[data-property-details]').dataset.propertyDetails).toBe('prop_title')
    expect((must('[data-property-description]') as HTMLTextAreaElement).value).toBe('Shown in the header next to the blog name.')
    await typeInto(must('[data-property-default] input'), 'Blog!')
    await click(must('[data-property-delete]'))
    await click(pick('[data-confirm-ok]'))
    expect(actions.named('layout_variable_update').map(call => call.input)).toEqual([{ layout: MAIN, variable: 'prop_title', default: 'Blog!' }])
    expect(actions.named('layout_variable_remove').map(call => call.input)).toEqual([{ layout: MAIN, variable: 'prop_title' }])
  })
})

describe('A page in a layout', () => {
  const layoutSelect = () => pick('[data-page-layout] [role="combobox"]')

  it('picks the layout of a page, or none (asking first: the page would lose its layout values)', async () => {
    const { actions } = await open({ page_set_layout: ok() })
    await select('n_page')
    expect(pick('[data-page-layout]')?.textContent).toContain('main')
    await selectOption(layoutSelect(), 'None')
    expect(actions.named('page_set_layout')).toEqual([])
    await click(pick('[data-confirm-ok]'))
    expect(actions.named('page_set_layout').map(call => call.input)).toEqual([{ page: 'pg_index', layout: null }])
  })

  it('sets the values of the layout\'s variables, typed by their kinds', async () => {
    mainLayout().variables!.push(
      { id: 'prop_wide', name: 'wide', kind: 'boolean' },
      { id: 'prop_cols', name: 'cols', kind: 'number' },
      { id: 'prop_tone', name: 'tone', kind: 'select', options: ['light', 'dark'] }
    )
    const { actions } = await open({ page_set_layout_values: ok() })
    await select('n_page')
    expect(propInput('prop_title')?.value).toBe('Posts')

    await typeInto(propInput('prop_title'), 'Hello')
    await click([...propRow('prop_wide')!.querySelectorAll<HTMLElement>('button')].find(button => button.textContent?.trim() === 'On') ?? null)
    await typeNumber(propRow('prop_cols'), '3')
    await selectOption(propSelect('prop_tone'), 'dark')
    await typeInto(propInput('prop_title'), '')

    expect(actions.named('page_set_layout_values').map(call => call.input)).toEqual([
      { page: 'pg_index', values: { prop_title: 'Hello' } },
      { page: 'pg_index', values: { prop_wide: true } },
      { page: 'pg_index', values: { prop_cols: 3 } },
      { page: 'pg_index', values: { prop_tone: 'dark' } },
      { page: 'pg_index', values: { prop_title: null } }
    ])
  })

  it('keeps the value of a number variable when a typo is typed', async () => {
    mainLayout().variables!.push({ id: 'prop_cols', name: 'cols', kind: 'number' })
    indexPage().layoutValues = { prop_cols: 7 }
    const { actions } = await open({ page_set_layout_values: ok() })
    await select('n_page')
    expect(propInput('prop_cols')?.value).toBe('7')

    await typeNumber(propRow('prop_cols'), 'abc')

    expect(actions.named('page_set_layout_values')).toEqual([])
    expect(propInput('prop_cols')?.value).toBe('7')
  })

  it('fills a named slot with the page\'s own content, and clears it', async () => {
    const { actions } = await open({ page_set_slot: ok({ fillId: 'n_fill' }) })
    await select('n_page')
    await click(pick('[aria-label="footer: own content"]'))
    expect(actions.named('page_set_slot').map(call => call.input)).toEqual([{ page: 'pg_index', slot: 'footer', filled: true }])
  })

  it('clears the page\'s own content of a slot it filled', async () => {
    indexPage().root.children!.push({ id: 'n_fill_footer', type: 'SlotFill', props: { slot: 'footer' } })
    const { actions } = await open({ page_set_slot: ok() })
    await select('n_page')
    await click(pick('[aria-label="footer: own content"]'))
    expect(actions.named('page_set_slot').map(call => call.input)).toEqual([{ page: 'pg_index', slot: 'footer', filled: false }])
  })
})
