import { describe, expect, it } from 'vitest'
import { LAYOUT_VARIABLE_KINDS } from '../../../codegen/src/model/schemas.ts'
import { byTestId, click, Failure, settle, typeInto } from '../helpers.ts'
import { choose, fromCanvas, indexPage, mainLayout, menuItem, open, propInput, propRow, propSelect, select, selectOption, sent, setupHarness, sidebarTab, typeNumber } from './harness.ts'

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

describe('Slots and variables of a layout', () => {
  it('adds a slot on the selected node, renames, rebinds and removes one', async () => {
    const { actions } = await open({ layout_slot_add: ok({ slotId: 'side' }), layout_slot_update: ok(), layout_slot_remove: ok() }, MAIN)
    expect(byTestId('slot-name-children')).toBeNull()
    expect(byTestId('slot-add')).not.toBeNull()
    expect((byTestId('slot-add') as HTMLButtonElement).disabled).toBe(true)

    await select('n_nav')
    await typeInto(byTestId('slot-add-name'), 'sidebar')
    await click(byTestId('slot-add'))
    await typeInto(byTestId('slot-name-footer'), 'bottom')
    await click(byTestId('slot-rebind-footer'))
    await click(byTestId('slot-remove-footer'))

    expect(actions.named('layout_slot_add').map(call => call.input)).toEqual([{ layout: MAIN, name: 'sidebar', nodeId: 'n_nav' }])
    expect(actions.named('layout_slot_update').map(call => call.input)).toEqual([
      { layout: MAIN, slot: 'footer', name: 'bottom' },
      { layout: MAIN, slot: 'footer', nodeId: 'n_nav' }
    ])
    expect(actions.named('layout_slot_remove').map(call => call.input)).toEqual([{ layout: MAIN, slot: 'footer' }])
  })

  it('adds, updates and removes a variable; only the kinds a layout takes', async () => {
    const { actions } = await open({ layout_variable_add: ok({ variableId: 'prop_tagline' }), layout_variable_update: ok(), layout_variable_remove: ok() }, MAIN)
    expect([...(byTestId('prop-add-kind') as HTMLSelectElement).options].map(option => option.value)).toEqual([...LAYOUT_VARIABLE_KINDS])

    await typeInto(byTestId('prop-add-name'), 'tagline')
    await choose('prop-add-kind', 'textarea')
    await click(byTestId('prop-add'))
    await typeInto(byTestId('property-default-prop_title'), 'Blog!')
    await click(byTestId('property-remove-prop_title'))

    expect(actions.named('layout_variable_add').map(call => call.input)).toEqual([{ layout: MAIN, name: 'tagline', kind: 'textarea' }])
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
