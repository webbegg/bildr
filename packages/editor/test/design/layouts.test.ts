import { describe, expect, it } from 'vitest'
import { LAYOUT_VARIABLE_KINDS } from '../../../codegen/src/model/schemas.ts'
import { allByTestId, byTestId, click, Failure, typeInto } from '../helpers.ts'
import { check, choose, fromCanvas, indexPage, mainLayout, open, select, sent, setupHarness } from './harness.ts'

/**
 * Layouts in the Design screen (P4c, V1, V2): the Layouts section, a layout's
 * slots and variables, and on a page the layout picker, the values for the
 * layout's variables and the content for its slots.
 */

setupHarness()

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const openTab = (name: string) => click(byTestId(`tab-${name}`))
const fileTab = () => click(byTestId('inspector-tab-file'))
const MAIN = 'lay_main'

describe('Layouts section', () => {
  it('lists the layouts; a row opens the layout in the canvas', async () => {
    await open()
    await openTab('layouts')
    expect(allByTestId('layout-row').map(row => row.textContent?.trim())).toEqual(['main'])
    await click(byTestId(`layout-open-${MAIN}`))
    expect(sent('bildr:render').at(-1)?.file.id).toBe(MAIN)
  })

  it('creates a layout, named or not', async () => {
    const { actions } = await open({ layout_create: ok({ layoutId: 'lay_docs', slotNodeId: 'n', filePath: 'x' }) })
    await openTab('layouts')
    await click(byTestId('layout-new'))
    await typeInto(byTestId('layout-new-name'), 'docs')
    await click(byTestId('layout-new'))
    expect(actions.named('layout_create').map(call => call.input)).toEqual([{}, { name: 'docs' }])
  })

  it('creates a layout from the top-level layers selected on a page without one', async () => {
    delete indexPage().layout
    const { actions } = await open({ layout_create_from_selection: ok({ layoutId: 'lay_site', slotNodeId: 'n', filePath: 'x' }) })
    await openTab('layouts')
    expect((byTestId('layout-from-selection') as HTMLButtonElement).disabled).toBe(true)
    await select('n_head')
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_list', shift: true, meta: false })
    await typeInto(byTestId('layout-new-name'), 'site')
    await click(byTestId('layout-from-selection'))
    expect(actions.named('layout_create_from_selection').map(call => call.input)).toEqual([{ page: 'pg_index', nodeIds: ['n_head', 'n_list'], name: 'site' }])
  })

  it('renames, duplicates and deletes a layout, showing the refusal of a delete in use', async () => {
    const message = 'Layout "main" is used by 1 page: pg_index. Give them another layout first'
    const { actions } = await open({ layout_rename: ok(), layout_duplicate: ok({ layoutId: 'lay_x', filePath: 'x' }), layout_delete: () => new Failure(422, 'invalid', message) })
    await openTab('layouts')
    await click(byTestId(`layout-rename-${MAIN}`))
    await typeInto(byTestId('layout-rename-input'), 'site')
    await click(byTestId(`layout-duplicate-${MAIN}`))
    await click(byTestId(`layout-delete-${MAIN}`))
    expect(actions.named('layout_rename').map(call => call.input)).toEqual([{ layout: MAIN, name: 'site' }])
    expect(actions.named('layout_duplicate').map(call => call.input)).toEqual([{ layout: MAIN }])
    expect(actions.named('layout_delete').map(call => call.input)).toEqual([{ layout: MAIN }])
    expect(byTestId('design-error')?.textContent?.trim()).toBe(message)
  })
})

describe('Slots and variables of a layout', () => {
  it('adds a slot on the selected node, renames, rebinds and removes one', async () => {
    const { actions } = await open({ layout_slot_add: ok({ slotId: 'side' }), layout_slot_update: ok(), layout_slot_remove: ok() }, MAIN)
    await fileTab()
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
    await fileTab()
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
  it('picks the layout of a page, or none', async () => {
    const { actions } = await open({ page_set_layout: ok() })
    await fileTab()
    expect((byTestId('layout-picker') as HTMLSelectElement).value).toBe(MAIN)
    await choose('layout-picker', '')
    await choose('layout-picker', MAIN)
    expect(actions.named('page_set_layout').map(call => call.input)).toEqual([{ page: 'pg_index', layout: null }, { page: 'pg_index', layout: MAIN }])
  })

  it('sets the values of the layout\'s variables, typed by their kinds', async () => {
    mainLayout().variables!.push(
      { id: 'prop_wide', name: 'wide', kind: 'boolean' },
      { id: 'prop_cols', name: 'cols', kind: 'number' },
      { id: 'prop_tone', name: 'tone', kind: 'select', options: ['light', 'dark'] }
    )
    const { actions } = await open({ page_set_layout_values: ok() })
    await fileTab()
    expect((byTestId('layout-value-prop_title') as HTMLInputElement).value).toBe('Posts')

    await typeInto(byTestId('layout-value-prop_title'), 'Hello')
    await check('layout-value-prop_wide', true)
    await typeInto(byTestId('layout-value-prop_cols'), '3')
    await choose('layout-value-prop_tone', 'dark')
    await typeInto(byTestId('layout-value-prop_title'), '')

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
    await fileTab()
    expect((byTestId('layout-value-prop_cols') as HTMLInputElement).value).toBe('7')

    await typeInto(byTestId('layout-value-prop_cols'), 'abc')

    expect(actions.named('page_set_layout_values')).toEqual([])
    expect((byTestId('layout-value-prop_cols') as HTMLInputElement).value).toBe('7')
  })

  it('fills a named slot with the page\'s own content, optionally moving the selection in, and clears it', async () => {
    const { actions } = await open({ page_set_slot: ok({ fillId: 'n_fill' }) })
    await fileTab()
    expect(byTestId('slot-fill-children')).toBeNull()
    await check('slot-fill-footer', true)
    await select('n_about')
    await click(byTestId('slot-fill-move-footer'))
    await check('slot-fill-footer', false)
    expect(actions.named('page_set_slot').map(call => call.input)).toEqual([
      { page: 'pg_index', slot: 'footer', filled: true },
      { page: 'pg_index', slot: 'footer', filled: true, nodeIds: ['n_about'] },
      { page: 'pg_index', slot: 'footer', filled: false }
    ])
  })
})
