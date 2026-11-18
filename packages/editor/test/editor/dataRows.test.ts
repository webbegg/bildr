import { afterEach, describe, expect, it } from 'vitest'
import { applyEdit } from '@bildr/codegen/edit'
import { loadModel, serializeModel } from '@bildr/codegen/model'
import { click, Failure, settle, typeInto } from '../helpers.ts'
import { designData } from '../../src/design/data.ts'
import { FOLDED_KEY } from '../../src/editor/dataTree.ts'
import { takeStart } from '../../src/editor/views.ts'
import { blogModelFiles } from '../canvas/fixture.ts'
import { byLabel, FakeEventSource, indexPage, setupHarness, world } from '../design/harness.ts'
import { confirmText, fixtureModule, inputs, open, q, qa, text, treeItem } from './dataKit.ts'

/**
 * The Rows tab on Sample data (D4, S4): cells edited in place, the keyboard, add, delete and bulk delete, and the record panel's
 * fields, over the module's real sample-data edits (`fixtureModule`). Live stays read-only, with a hint. Every save is one module
 * action; a refusal shows on the cell, with what was typed kept.
 */

setupHarness()

const FIRST = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01'
const SECOND = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02'
const HINT = 'Live rows come from your app. Switch to Sample data to edit.'
const ROW_CHANGED = 'This row changed: your value is kept; press Enter to save it over the new row.'
// The rows as the editor first shows them: what an edit sends as `base`, the row the user saw.
const [FIRST_ROW, SECOND_ROW] = (JSON.parse(blogModelFiles()['.bildr/modules/blog/fixtures/post.json']!) as { rows: Array<Record<string, unknown>> }).rows

afterEach(() => {
  takeStart()
  localStorage.removeItem('bildr:panel-width')
  localStorage.removeItem(FOLDED_KEY)
})

const key = async (element: Element | null, name: string, init: KeyboardEventInit = {}) => {
  element!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }))
  await settle()
}
/** The element as an input, for its value and state. */
const q$ = (selector: string) => q(selector) as HTMLInputElement | null
const cell = (row: number, col: number) => q(`[data-cell="${row}-${col}"]`)
const active = () => qa('[data-cell-active]').map(entry => entry.getAttribute('data-cell'))
const titles = () => qa('[data-record]').map(row => text(row.querySelector('[data-cell$="-0"]')))
const sample = async (extra = {}) => {
  const mounted = await open({ ...fixtureModule(), ...extra })
  await click(byLabel('Sample data', q('[data-live-badge]')!))
  return mounted
}
/** Starts editing a cell with a double-click and returns its input. */
const edit = async (row: number, col: number) => {
  cell(row, col)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await settle()
  return q$('[data-cell-input]')!
}

/** Another writer (an agent, the file) changes a field of the first row, and the editor reads the model again, as it does on a model event. */
let version = 100
const changeUnderneath = async (values: Record<string, unknown>) => {
  await fixtureModule().fixture_row_update!({ entity: 'ent_post', row: FIRST, values })
  FakeEventSource.instances.at(-1)!.send({ type: 'model', version: ++version, files: ['.bildr/modules/blog/fixtures/post.json'], source: 'disk' })
  await settle()
}

describe('Live rows', () => {
  it('stay read-only, with a hint that says where to edit', async () => {
    await open({ ...fixtureModule() })
    expect(text(q('[data-live-hint]'))).toBe(HINT)
    expect(q('[data-add-row], [data-delete-selected], [data-row-select], [data-select-all], [data-record-delete], [data-cell-input], [data-cell-toggle]')).toBeNull()
    cell(0, 0)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settle()
    expect(q('[data-cell-input]')).toBeNull()
    await key(cell(0, 0), 'Enter')
    expect(q('[data-cell-input]')).toBeNull()
  })

  it('stay read-only when Live is chosen and the app answers', async () => {
    await open({ ...fixtureModule() }, { '/api/blog/posts': { items: [{ id: 'a', title: 'Live one', slug: 'one', body: '', published: true, publishedAt: null }], total: 1 } })
    expect(text(q('[data-live-hint]'))).toBe(HINT)
    expect(q('[data-add-row], [data-cell-input]')).toBeNull()
  })

  it('are the only rows of a REST collection, which has no hint to switch', async () => {
    await open({ ...fixtureModule() })
    await click(q('[data-collection="quotes"]'))
    expect(q('[data-live-hint]')).toBeNull()
    expect(q('[data-add-row], [data-cell-input]')).toBeNull()
  })
})

describe('Sample data cells', () => {
  it('say nothing of the hint, and offer to add a row', async () => {
    await sample()
    expect(q('[data-live-hint]')).toBeNull()
    expect(q('[data-add-row]')).not.toBeNull()
    expect(qa('[data-record]')).toHaveLength(2)
  })

  it('edit in place: a double-click opens the cell, Enter saves it as one fixture_row_update', async () => {
    const { actions } = await sample()
    const input = await edit(0, 0)
    expect(input.value).toBe('Hello bildr')
    await typeInto(input, 'Hello again')
    await key(input, 'Enter')
    expect(inputs(actions, 'fixture_row_update')).toEqual([{ entity: 'ent_post', row: FIRST, base: FIRST_ROW, values: { title: 'Hello again' } }])
    expect(q('[data-cell-input]')).toBeNull()
    expect(titles()).toEqual(['Hello again', 'A draft'])
  })

  it('save a cell left with the focus, and save nothing when the text did not change', async () => {
    const { actions } = await sample()
    const input = await edit(1, 0)
    await typeInto(input, 'A better draft')
    input.dispatchEvent(new FocusEvent('blur'))
    await settle()
    expect(inputs(actions, 'fixture_row_update')).toEqual([{ entity: 'ent_post', row: SECOND, base: SECOND_ROW, values: { title: 'A better draft' } }])
    const again = await edit(0, 0)
    await key(again, 'Enter')
    expect(actions.named('fixture_row_update')).toHaveLength(1)
    expect(q('[data-cell-input]')).toBeNull()
  })

  it('send an emptied optional text as null, and take the value back from the model', async () => {
    const { actions } = await sample()
    const input = await edit(0, 2)
    await typeInto(input, '')
    await key(input, 'Enter')
    expect(inputs(actions, 'fixture_row_update')).toEqual([{ entity: 'ent_post', row: FIRST, base: FIRST_ROW, values: { body: null } }])
    // The row the module stores holds the field's default, not nothing: the generated seed is typed by the entity.
    expect(world.model.modules.blog!.fixtures.find(entry => entry.entity === 'ent_post')!.rows[0]).toHaveProperty('body', '')
    expect(text(cell(0, 2))).toBe('')
  })

  it('toggle a boolean with a click on its switch, or Enter on its cell', async () => {
    const { actions } = await sample()
    const toggle = cell(0, 3)!.querySelector<HTMLElement>('[data-cell-toggle]')!
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await click(toggle)
    expect(inputs(actions, 'fixture_row_update')).toEqual([{ entity: 'ent_post', row: FIRST, base: FIRST_ROW, values: { published: false } }])
    expect(cell(0, 3)!.querySelector('[data-cell-toggle]')!.getAttribute('aria-checked')).toBe('false')
    await click(cell(1, 3))
    await key(cell(1, 3), 'Enter')
    expect(inputs(actions, 'fixture_row_update')[1]).toEqual({ entity: 'ent_post', row: SECOND, base: SECOND_ROW, values: { published: true } })
  })

  it('leave a read-only field alone', async () => {
    const { actions } = await sample()
    expect(cell(0, 4)!.getAttribute('aria-readonly')).toBe('true')
    cell(0, 4)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await click(cell(0, 4))
    await key(cell(0, 4), 'Enter')
    await key(cell(0, 4), 'F2')
    expect(q('[data-cell-input]')).toBeNull()
    expect(actions.named('fixture_row_update')).toHaveLength(0)
  })

  it('disable a cell while its save is in flight', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const real = fixtureModule().fixture_row_update!
    const { actions } = await sample({ fixture_row_update: async (input: Record<string, unknown>) => {
      await gate
      return real(input)
    } })
    const input = await edit(0, 0)
    await typeInto(input, 'Slow')
    await key(input, 'Enter')
    expect(actions.named('fixture_row_update')).toHaveLength(1)
    expect(q$('[data-cell-input]')!.disabled).toBe(true)
    // Another Enter does not send a second save.
    await key(q('[data-cell-input]'), 'Enter')
    expect(actions.named('fixture_row_update')).toHaveLength(1)
    release()
    await settle()
    expect(q('[data-cell-input]')).toBeNull()
    expect(titles()[0]).toBe('Slow')
  })
})

describe('Sample data refusals', () => {
  it('show on the cell, keep what was typed and leave the sample data alone', async () => {
    const { actions } = await sample()
    const input = await edit(0, 1)
    await typeInto(input, 'Not Valid')
    await key(input, 'Enter')
    expect(actions.named('fixture_row_update')).toHaveLength(1)
    expect(text(cell(0, 1)!.querySelector('[data-cell-error]'))).toContain('Use lowercase letters, numbers and dashes')
    expect(q$('[data-cell-input]')!.value).toBe('Not Valid')
    expect(q$('[data-cell-input]')!.getAttribute('aria-invalid')).toBe('true')
    expect(q$('[data-cell-input]')!.disabled).toBe(false)
    // A blur with the same text does not ask again; Escape gives the cell back as it was saved.
    q('[data-cell-input]')!.dispatchEvent(new FocusEvent('blur'))
    await settle()
    expect(actions.named('fixture_row_update')).toHaveLength(1)
    await key(q('[data-cell-input]'), 'Escape')
    expect(q('[data-cell-input]')).toBeNull()
    expect(q('[data-cell-error]')).toBeNull()
    expect(text(cell(0, 1))).toBe('hello-bildr')
  })

  it('can be corrected in place: the next save goes through and the message goes', async () => {
    await sample()
    const input = await edit(0, 1)
    await typeInto(input, 'Not Valid')
    await key(input, 'Enter')
    expect(q('[data-cell-error]')).not.toBeNull()
    await typeInto(q('[data-cell-input]'), 'valid-slug')
    await key(q('[data-cell-input]'), 'Enter')
    expect(q('[data-cell-error]')).toBeNull()
    expect(q('[data-cell-input]')).toBeNull()
    expect(text(cell(0, 1))).toBe('valid-slug')
  })

  it('say what the module says when the value is not a type of the field, and what it says of a model it refuses', async () => {
    await sample({ fixture_row_update: () => new Failure(422, 'invalid', 'published must be true or false') })
    const input = await edit(0, 0)
    await typeInto(input, 'x')
    await key(input, 'Enter')
    expect(text(q('[data-cell-error]'))).toBe('published must be true or false')
    // The refusal is the cell's: the screen's banner stays empty.
    expect(q('[data-testid="design-error"]')).toBeNull()
  })

  it('show a refused toggle on its cell too', async () => {
    await sample({ fixture_row_update: () => new Failure(422, 'invalid', 'Cannot toggle') })
    await click(cell(0, 3)!.querySelector<HTMLElement>('[data-cell-toggle]'))
    expect(text(cell(0, 3)!.querySelector('[data-cell-error]'))).toBe('Cannot toggle')
    expect(cell(0, 3)!.querySelector('[data-cell-toggle]')!.getAttribute('aria-checked')).toBe('true')
  })
})

describe('a refused cell is an unsaved edit', () => {
  const DISCARD = 'Discard unsaved changes to Post row?'
  /** Types a value the module refuses into the slug of the first row. */
  const refuse = async () => {
    const input = await edit(0, 1)
    await typeInto(input, 'Not Valid')
    await key(input, 'Enter')
    expect(q('[data-cell-error]')).not.toBeNull()
  }

  it('asks before the workspace leaves it, keeps the text when the edit is kept, and moves on when it is given up', async () => {
    await sample()
    await refuse()
    await click(treeItem('quote'))
    expect(confirmText()).toContain(DISCARD)
    await click(q('[data-confirm-cancel]'))
    expect(q$('[data-cell-input]')!.value).toBe('Not Valid')
    expect(treeItem('post')?.getAttribute('aria-selected')).toBe('true')
    await click(treeItem('quote'))
    await click(q('[data-confirm-ok]'))
    expect(treeItem('quote')?.getAttribute('aria-selected')).toBe('true')
    // Nothing is left to ask about: the table that held it is gone.
    await click(treeItem('post'))
    expect(q('[data-confirm]')).toBeNull()
  })

  it('is not asked about once Escape gives the cell back, or once a corrected value is saved', async () => {
    await sample()
    await refuse()
    await key(q('[data-cell-input]'), 'Escape')
    await click(treeItem('quote'))
    expect(q('[data-confirm]')).toBeNull()
    await click(treeItem('post'))
    await refuse()
    await typeInto(q('[data-cell-input]'), 'valid-slug')
    await key(q('[data-cell-input]'), 'Enter')
    expect(q('[data-cell-error]')).toBeNull()
    await click(treeItem('quote'))
    expect(q('[data-confirm]')).toBeNull()
  })

  it('is not asked about when the cell was only opened', async () => {
    await sample()
    await edit(0, 1)
    await click(treeItem('quote'))
    expect(q('[data-confirm]')).toBeNull()
  })
})

describe('Sample data keyboard', () => {
  it('moves the active cell with the arrows and Tab, and edits with Enter or F2', async () => {
    await sample()
    await click(cell(0, 0))
    expect(active()).toEqual(['0-0'])
    await key(cell(0, 0), 'ArrowRight')
    expect(active()).toEqual(['0-1'])
    await key(cell(0, 1), 'ArrowDown')
    expect(active()).toEqual(['1-1'])
    await key(cell(1, 1), 'ArrowLeft')
    expect(active()).toEqual(['1-0'])
    await key(cell(1, 0), 'ArrowUp')
    expect(active()).toEqual(['0-0'])
    await key(cell(0, 0), 'ArrowUp')
    expect(active()).toEqual(['0-0'])
    await key(cell(0, 0), 'Tab')
    expect(active()).toEqual(['0-1'])
    await key(cell(0, 1), 'Tab', { shiftKey: true })
    expect(active()).toEqual(['0-0'])
    // Tab at the end of a row goes to the start of the next.
    await click(cell(0, 4))
    await key(cell(0, 4), 'Tab')
    expect(active()).toEqual(['1-0'])
    await key(cell(1, 0), 'Enter')
    expect(q$('[data-cell-input]')!.value).toBe('A draft')
    await key(q('[data-cell-input]'), 'Escape')
    await key(cell(1, 0), 'F2')
    expect(q$('[data-cell-input]')!.value).toBe('A draft')
  })

  it('cancels with Escape, saving nothing, and keeps the cell active', async () => {
    const { actions } = await sample()
    await click(cell(0, 0))
    await key(cell(0, 0), 'Enter')
    await typeInto(q('[data-cell-input]'), 'Never saved')
    await key(q('[data-cell-input]'), 'Escape')
    expect(q('[data-cell-input]')).toBeNull()
    expect(actions.named('fixture_row_update')).toHaveLength(0)
    expect(titles()[0]).toBe('Hello bildr')
    expect(active()).toEqual(['0-0'])
  })

  it('saves with Tab and moves to the next cell, and stays when the save is refused', async () => {
    const { actions } = await sample()
    await click(cell(0, 0))
    await key(cell(0, 0), 'Enter')
    await typeInto(q('[data-cell-input]'), 'Tabbed')
    await key(q('[data-cell-input]'), 'Tab')
    expect(inputs(actions, 'fixture_row_update')).toEqual([{ entity: 'ent_post', row: FIRST, base: FIRST_ROW, values: { title: 'Tabbed' } }])
    expect(q('[data-cell-input]')).toBeNull()
    expect(active()).toEqual(['0-1'])
    await key(cell(0, 1), 'Enter')
    await typeInto(q('[data-cell-input]'), 'Not Valid')
    await key(q('[data-cell-input]'), 'Tab')
    expect(q('[data-cell-error]')).not.toBeNull()
    expect(q$('[data-cell-input]')!.value).toBe('Not Valid')
    expect(active()).toEqual(['0-1'])
  })

  it('has one tab stop in the grid, on the active cell', async () => {
    await sample()
    expect(qa('[data-cell][tabindex="0"]').map(entry => entry.getAttribute('data-cell'))).toEqual(['0-0'])
    await click(cell(1, 2))
    expect(qa('[data-cell][tabindex="0"]').map(entry => entry.getAttribute('data-cell'))).toEqual(['1-2'])
  })

  it('does not open the record panel from a cell click, only from the open button', async () => {
    await sample()
    await click(cell(0, 0))
    expect(q('[data-record-panel]')).toBeNull()
    await click(q('[data-record-open]'))
    expect(q('[data-record-panel]')).not.toBeNull()
  })
})

describe('Sample data rows', () => {
  it('adds a row with Add row, as one fixture_row_create', async () => {
    const { actions } = await sample()
    await click(q('[data-add-row]'))
    expect(inputs(actions, 'fixture_row_create')).toEqual([{ entity: 'ent_post' }])
    expect(qa('[data-record]')).toHaveLength(3)
    expect(text(q('[data-records-count]'))).toBe('3 items')
  })

  it('says why a row could not be added', async () => {
    await sample({ fixture_row_create: () => new Failure(422, 'invalid', 'Nope, no more rows') })
    await click(q('[data-add-row]'))
    expect(text(q('[data-rows-error]'))).toBe('Nope, no more rows')
    expect(qa('[data-record]')).toHaveLength(2)
  })

  it('deletes a row with its trash button, as one fixture_rows_delete', async () => {
    const { actions } = await sample()
    await click(qa('[data-record-delete]')[0]!)
    expect(inputs(actions, 'fixture_rows_delete')).toEqual([{ entity: 'ent_post', rows: [FIRST], base: { [FIRST]: FIRST_ROW } }])
    expect(titles()).toEqual(['A draft'])
  })

  it('says so on the cell when the rows changed under the key it saved to (a conflict)', async () => {
    await sample({ fixture_row_update: () => new Failure(409, 'conflict', 'Post sample row "1" changed since you loaded it: reload the rows and try again') })
    const input = await edit(0, 0)
    await typeInto(input, 'Late')
    await key(input, 'Enter')
    expect(text(q('[data-cell-error]'))).toBe(ROW_CHANGED)
    expect(q$('[data-cell-input]')!.value).toBe('Late')
  })

  it('keeps the typed value after a conflict, takes the row as it is now as its base, and the next Enter saves over it', async () => {
    const { actions } = await sample()
    const input = await edit(0, 0)
    await typeInto(input, 'Mine')
    await changeUnderneath({ body: 'Changed elsewhere' })
    await key(q('[data-cell-input]'), 'Enter')
    expect(text(q('[data-cell-error]'))).toBe(ROW_CHANGED)
    expect(q$('[data-cell-input]')!.value).toBe('Mine')
    expect(world.model.modules.blog!.fixtures.find(entry => entry.entity === 'ent_post')!.rows[0]).toMatchObject({ title: 'Hello bildr', body: 'Changed elsewhere' })
    await key(q('[data-cell-input]'), 'Enter')
    expect(inputs(actions, 'fixture_row_update')).toEqual([
      { entity: 'ent_post', row: FIRST, base: FIRST_ROW, values: { title: 'Mine' } },
      { entity: 'ent_post', row: FIRST, base: { ...FIRST_ROW, body: 'Changed elsewhere' }, values: { title: 'Mine' } }
    ])
    expect(q('[data-cell-error]')).toBeNull()
    expect(q('[data-cell-input]')).toBeNull()
    expect(text(cell(0, 0))).toBe('Mine')
    expect(world.model.modules.blog!.fixtures.find(entry => entry.entity === 'ent_post')!.rows[0]).toMatchObject({ title: 'Mine', body: 'Changed elsewhere' })
  })

  it('sends the row as it was when the edit began, not as it is when Enter is pressed: a change in between is a conflict, not an overwrite', async () => {
    const { actions } = await sample()
    const input = await edit(0, 0)
    await typeInto(input, 'Mine')
    await changeUnderneath({ body: 'Changed elsewhere' })
    await key(q('[data-cell-input]'), 'Enter')
    expect(inputs(actions, 'fixture_row_update')).toEqual([{ entity: 'ent_post', row: FIRST, base: FIRST_ROW, values: { title: 'Mine' } }])
    expect(world.model.modules.blog!.fixtures.find(entry => entry.entity === 'ent_post')!.rows[0]).toMatchObject({ title: 'Hello bildr' })
  })

  it('deletes the selected rows after a confirmation, in one fixture_rows_delete', async () => {
    const { actions } = await sample()
    // A third row, so the two shown first can go and one stays (the last row is kept: see below).
    await click(q('[data-add-row]'))
    expect(q('[data-delete-selected]')).toBeNull()
    await click(qa('[data-row-select]')[0]!)
    await click(qa('[data-row-select]')[1]!)
    expect(text(q('[data-delete-selected]'))).toBe('Delete 2 rows')
    await click(q('[data-delete-selected]'))
    expect(text(q('[data-confirm]')?.closest('[role="dialog"]') ?? null)).toContain('Delete 2 rows?')
    expect(actions.named('fixture_rows_delete')).toHaveLength(0)
    await click(qa('button').find(button => button.textContent?.trim() === 'Delete rows') ?? null)
    expect(inputs(actions, 'fixture_rows_delete')).toEqual([{ entity: 'ent_post', rows: [FIRST, SECOND], base: { [FIRST]: FIRST_ROW, [SECOND]: SECOND_ROW } }])
    expect(qa('[data-record]')).toHaveLength(1)
    expect(q('[data-delete-selected]')).toBeNull()
  })

  it('sends the rows as they were when the delete was chosen, not as they are once it is confirmed: a change while asking refuses it', async () => {
    const { actions } = await sample()
    await click(qa('[data-row-select]')[0]!)
    await click(q('[data-delete-selected]'))
    await changeUnderneath({ body: 'Changed while asking' })
    await click(qa('button').find(button => button.textContent?.trim() === 'Delete rows' || button.textContent?.trim() === 'Delete row') ?? null)
    expect(inputs(actions, 'fixture_rows_delete')).toEqual([{ entity: 'ent_post', rows: [FIRST], base: { [FIRST]: FIRST_ROW } }])
    expect(text(q('[data-rows-error]'))).toContain('changed')
    expect(qa('[data-record]')).toHaveLength(2)
  })

  it('says why the last row stays, and deletes nothing', async () => {
    const { actions } = await sample()
    await click(q('[data-select-all]'))
    await click(q('[data-delete-selected]'))
    await click(qa('button').find(button => button.textContent?.trim() === 'Delete rows') ?? null)
    expect(actions.named('fixture_rows_delete')).toHaveLength(1)
    expect(text(q('[data-rows-error]'))).toBe('Keep at least one sample row: publishPost tests use it')
    expect(qa('[data-record]')).toHaveLength(2)
  })

  it('keeps the rows when the confirmation is cancelled', async () => {
    const { actions } = await sample()
    await click(qa('[data-row-select]')[0]!)
    expect(text(q('[data-delete-selected]'))).toBe('Delete 1 row')
    await click(q('[data-delete-selected]'))
    await click(qa('button').find(button => button.textContent?.trim() === 'Cancel') ?? null)
    expect(actions.named('fixture_rows_delete')).toHaveLength(0)
    expect(qa('[data-record]')).toHaveLength(2)
    expect(qa('[data-row-select]:checked')).toHaveLength(1)
  })

  it('selects every shown row with the header checkbox, and clears it', async () => {
    await sample()
    await click(q('[data-select-all]'))
    expect(qa('[data-row-select]:checked')).toHaveLength(2)
    expect(text(q('[data-delete-selected]'))).toBe('Delete 2 rows')
    await click(q('[data-select-all]'))
    expect(qa('[data-row-select]:checked')).toHaveLength(0)
    expect(q('[data-delete-selected]')).toBeNull()
  })

  it('drops a selection when the source is switched back to Live', async () => {
    await sample()
    await click(qa('[data-row-select]')[0]!)
    await click(byLabel('Live', q('[data-live-badge]')!))
    expect(q('[data-delete-selected]')).toBeNull()
    await click(byLabel('Sample data', q('[data-live-badge]')!))
    expect(qa('[data-row-select]:checked')).toHaveLength(0)
  })

  it('shows an empty collection with its Add row, and says so', async () => {
    world.model.modules.blog!.fixtures = []
    await sample()
    expect(text(q('[data-records-empty]'))).toBe('No sample data yet for this collection.')
    expect(q('[data-add-row]')).not.toBeNull()
  })
})

describe('the record panel on Sample data', () => {
  it('edits the fields of the open row, each one fixture_row_update', async () => {
    const { actions } = await sample()
    await click(q('[data-record-open]'))
    const panel = q('[data-record-panel]')!
    const title = panel.querySelector<HTMLInputElement>('[data-record-field="title"] input')!
    expect(title.value).toBe('Hello bildr')
    await typeInto(title, 'From the panel')
    expect(inputs(actions, 'fixture_row_update')).toEqual([{ entity: 'ent_post', row: FIRST, base: FIRST_ROW, values: { title: 'From the panel' } }])
    expect(titles()[0]).toBe('From the panel')
    const toggle = panel.querySelector<HTMLElement>('[data-record-field="published"] [role="switch"]')!
    await click(toggle)
    expect(inputs(actions, 'fixture_row_update')[1]).toEqual({ entity: 'ent_post', row: FIRST, base: { ...FIRST_ROW, title: 'From the panel' }, values: { published: false } })
    // A read-only field shows its value, with no input.
    expect(panel.querySelector('[data-record-field="publishedAt"] input')).toBeNull()
  })

  it('shows a refusal under the field, keeping what was typed', async () => {
    await sample()
    await click(q('[data-record-open]'))
    const slug = q('[data-record-panel]')!.querySelector<HTMLInputElement>('[data-record-field="slug"] input')!
    await typeInto(slug, 'Not Valid')
    expect(text(q('[data-record-panel] [data-record-field="slug"] [data-field-error]'))).toContain('Use lowercase letters, numbers and dashes')
    expect(q('[data-record-panel]')!.querySelector<HTMLInputElement>('[data-record-field="slug"] input')!.value).toBe('Not Valid')
  })
})

describe('the canvas after a sample-data edit', () => {
  it('shows the edited rows where it falls back to the sample data: the model it reloads has them', () => {
    const files = serializeModel(world.model)
    const outcome = applyEdit(files, 'fixture_row_update', { entity: 'ent_post', row: FIRST, values: { title: 'Edited on the grid' } })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const loaded = loadModel({ ...files, ...Object.fromEntries(outcome.changes.map(change => [change.path, change.content!])) })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const page = Object.values(loaded.model.modules).flatMap(mod => mod.pages).find(entry => entry.id === indexPage().id)
    const shown = Object.values(designData(loaded.model, page)).flat().map(entry => (entry as { title?: string }).title)
    expect(shown).toContain('Edited on the grid')
    expect(Object.values(designData(world.model, indexPage())).flat().map(entry => (entry as { title?: string }).title)).not.toContain('Edited on the grid')
  })
})
