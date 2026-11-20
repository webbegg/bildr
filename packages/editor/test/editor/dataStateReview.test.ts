import { afterEach, describe, expect, it } from 'vitest'
import { Failure, click, settle, typeInto } from '../helpers.ts'
import { FOLDED_KEY } from '../../src/editor/dataTree.ts'
import { takeStart } from '../../src/editor/views.ts'
import { byLabel, combo, inputOf, menuItem, selectOption, setupHarness, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'
import { activeTab, confirmText, inputs, open, q, qa, stateModule, tab, text } from './dataKit.ts'

/**
 * B2 review fixes, over the State section as the Data screen shows it (the mocked actions' `state_*` edits are the module's own):
 * which field an entry is when one save renames a field and adds another, which row a refusal is shown on, the dirty report after a
 * refused create, the header's late refusal, a double save, the defaults, and the words of the dialogs.
 */

setupHarness()

afterEach(() => {
  takeStart()
  localStorage.removeItem(FOLDED_KEY)
})

const STATE = '/data?item=state:st_preferences&tab=fields'
const mounted = (extra: Handlers = {}, path = STATE) => open({ ...stateModule(), ...extra }, {}, path)
const calls = (actions: Awaited<ReturnType<typeof open>>['actions'], name: string) => inputs(actions, name)
const stored = () => world.model.modules.blog!.state.find(entry => entry.id === 'st_preferences')!
const rows = () => qa('[data-state-fields] [data-state-field]')
const row = (id: string) => q(`[data-state-field="${id}"]`)!
const last = () => rows().at(-1)!
const inRow = (element: Element, hook: string) => element.querySelector<HTMLElement>(`[${hook}]`)!
const save = () => click(q('[data-state-fields-save]'))
const nameOf = (id: string) => inputOf(`[data-state-field="${id}"] [data-state-name]`)
const textButton = (label: string) => qa('button').find(candidate => candidate.textContent?.trim() === label) ?? null

const pick = async (trigger: Element, label: string) => {
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  const option = qa('[role="option"]').find(element => element.textContent?.trim() === label)
  if (!option) throw new Error(`no option ${label}`)
  option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  option.click()
  await settle()
}
const addField = async (name: string, type?: string, defaultText?: string) => {
  await click(q('[data-state-add]'))
  await typeInto(inRow(last(), 'data-state-name'), name)
  if (type) await pick(combo(`[data-state-field="${last().getAttribute('data-state-field')}"] [data-state-type]`), type)
  if (defaultText !== undefined) await typeInto(inRow(last(), 'data-state-default'), defaultText)
}
const SHOW_DRAFTS = { id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false }

describe('one save that renames a field and adds another', () => {
  /** A saved field `search` (nothing uses it), next to the used `showDrafts`. */
  const withSearch = async () => {
    const mount = await mounted()
    await addField('search', 'Text')
    await save()
    expect(stored().fields.map(field => field.id)).toEqual(['fld_show_drafts', 'fld_search'])
    return mount
  }
  const noRefusal = () => {
    expect(q('[data-state-field-error]')).toBeNull()
    expect(q('[data-state-fields-error]')).toBeNull()
  }

  it('renames a saved field and adds a new one with its old name', async () => {
    const { actions } = await withSearch()
    await typeInto(nameOf('fld_search'), 'query')
    await addField('search', 'Text')
    await save()
    expect(calls(actions, 'state_update').at(-1)!.fields).toEqual([SHOW_DRAFTS, { id: 'fld_search', name: 'query', type: 'text' }, { name: 'search', type: 'text' }])
    noRefusal()
    expect(stored().fields.map(field => [field.id, field.name])).toEqual([['fld_show_drafts', 'showDrafts'], ['fld_search', 'query'], ['fld_search_2', 'search']])
    expect(q('[data-state-fields-unsaved]')).toBeNull()
  })

  it('does it when the fields are reordered as well', async () => {
    const { actions } = await withSearch()
    await typeInto(nameOf('fld_search'), 'query')
    await addField('search', 'Text')
    await click(inRow(last(), 'data-state-up'))
    await click(inRow(rows()[1]!, 'data-state-up'))
    expect(rows().map(entry => inputOf(`[data-state-field="${entry.getAttribute('data-state-field')}"] [data-state-name]`).value)).toEqual(['search', 'showDrafts', 'query'])
    await save()
    expect(calls(actions, 'state_update').at(-1)!.fields).toEqual([{ name: 'search', type: 'text' }, SHOW_DRAFTS, { id: 'fld_search', name: 'query', type: 'text' }])
    noRefusal()
    expect(stored().fields.map(field => [field.id, field.name])).toEqual([['fld_search_2', 'search'], ['fld_show_drafts', 'showDrafts'], ['fld_search', 'query']])
  })

  it('makes a field removed and added again under the same name a new field, with a new id', async () => {
    const { actions } = await withSearch()
    await click(inRow(row('fld_search'), 'data-state-remove'))
    await addField('search', 'Text')
    await save()
    expect(calls(actions, 'state_update').at(-1)!.fields).toEqual([SHOW_DRAFTS, { name: 'search', type: 'text' }])
    noRefusal()
    expect(stored().fields.map(field => [field.id, field.name])).toEqual([['fld_show_drafts', 'showDrafts'], ['fld_search_2', 'search']])
  })
})

describe('the row a refusal is shown on', () => {
  const refusal = () => text(q('[data-state-field-error]'))

  it('is the saved field the module names by its id, whatever the draft calls it', async () => {
    await mounted()
    await typeInto(nameOf('fld_show_drafts'), 'showAll')
    await addField('other', 'Text')
    await save()
    expect(text(row('fld_show_drafts').querySelector('[data-state-field-error]'))).toContain('The field showDrafts of the state preferences')
    expect(qa('[data-state-field-error]')).toHaveLength(1)
    expect(q('[data-state-fields-error]')).toBeNull()
  })

  it('is the new field for the name of another, in the words it was typed in', async () => {
    await mounted()
    await addField('Show Drafts', 'Toggle')
    await save()
    expect(text(last().querySelector('[data-state-field-error]'))).toBe('Two fields are named "showDrafts"')
    expect(row('fld_show_drafts').querySelector('[data-state-field-error]')).toBeNull()
    expect(q('[data-state-fields-error]')).toBeNull()
  })

  it.each([
    ['id', '"id" is the key of the state\'s row'],
    ['toString', 'is a name every object already has'],
    ['1st', 'can\'t be a field name']
  ])('is the field named %s, which the module refuses as a name', async (name, message) => {
    await mounted()
    await addField(name, 'Text')
    await save()
    expect(text(last().querySelector('[data-state-field-error]'))).toContain(message)
    expect(q('[data-state-fields-error]')).toBeNull()
  })

  it('is the row the module names, not the one the message seems to name', async () => {
    await mounted({ state_update: () => new Failure(422, 'invalid', 'perPage: something the editor does not read', undefined, { id: 'fld_show_drafts', name: 'showDrafts' }) })
    await addField('perPage', 'Integer')
    await save()
    expect(row('fld_show_drafts').querySelector('[data-state-field-error]')).not.toBeNull()
    expect(last().querySelector('[data-state-field-error]')).toBeNull()
    expect(refusal()).toBe('perPage: something the editor does not read')
  })

  it('is shown in the footer when the module names a field the draft does not have, or none', async () => {
    await mounted({ state_update: () => new Failure(422, 'invalid', 'Nothing here', undefined, { id: 'fld_gone', name: 'gone' }) })
    await addField('perPage', 'Integer')
    await save()
    expect(q('[data-state-field-error]')).toBeNull()
    expect(text(q('[data-state-fields-error]'))).toBe('Nothing here')
  })
})

describe('a confirmed discard, then a refused create', () => {
  it('keeps reporting the Fields draft that is still unsaved', async () => {
    await mounted()
    await addField('search', 'Text')
    await click(byLabel('New state'))
    await typeInto(inputOf('[data-artifact-name]'), 'preferences')
    await click(q('[data-artifact-submit]'))
    expect(confirmText()).toContain('Discard unsaved changes to Blog preferences?')
    await click(q('[data-confirm-ok]'))
    expect(text(q('[data-artifact-error]'))).toContain('already has the state preferences')
    await click(textButton('Cancel'))
    // The draft is still there, and the workspace still asks before it moves away.
    expect(rows()).toHaveLength(2)
    await click(tab('used'))
    expect(confirmText()).toContain('Discard unsaved changes to Blog preferences?')
    await click(q('[data-confirm-cancel]'))
    expect(activeTab()).toBe('fields')
  })
})

describe('the header of a state, over a late answer and a draft', () => {
  const persist = () => combo('[data-state-persist]')
  const another = () => world.model.modules.blog!.state.push({ id: 'st_cart', name: 'cart', label: 'Cart', persist: 'memory', shape: 'single', fields: [{ id: 'fld_item', name: 'item', type: 'text' }] })

  it('does not show a refusal that arrives after another state was chosen under the new one', async () => {
    another()
    let answer!: (failure: Failure) => void
    await mounted({
      state_update: () => new Promise<Failure>((resolve) => {
        answer = resolve
      })
    })
    await selectOption(persist(), 'Kept for this tab')
    await click(q('[data-tree-item="state:st_cart"]'))
    expect(text(q('[data-data-title] h2'))).toBe('Cart')
    answer(new Failure(422, 'invalid', 'The state can\'t be saved right now'))
    await settle()
    expect(q('[data-state-persist-error]')).toBeNull()
    expect(text(q('[data-state-header]'))).toContain('Forgotten on reload')
  })

  it('keeps a dirty Fields draft when the persistence changes, with no notice that the state changed', async () => {
    const { actions } = await mounted()
    await addField('search', 'Text')
    await selectOption(persist(), 'Kept for this tab')
    expect(calls(actions, 'state_update')).toEqual([{ state: 'st_preferences', persist: 'session' }])
    expect(stored().persist).toBe('session')
    expect(rows()).toHaveLength(2)
    expect(q('[data-state-fields-changed]')).toBeNull()
    expect(text(q('[data-state-fields-unsaved]'))).toBe('Unsaved changes')
    expect(q('[data-state-fields-save]')?.hasAttribute('disabled')).toBe(false)
  })
})

describe('saving twice', () => {
  it('sends one state_update while the first is still on its way', async () => {
    let finish!: (value: unknown) => void
    const module = stateModule()
    const { actions } = await mounted({
      state_update: input => new Promise((resolve) => {
        finish = resolve
      }).then(() => module.state_update!(input))
    })
    await addField('search', 'Text')
    const button = q('[data-state-fields-save]')!
    button.click()
    button.click()
    await settle()
    expect(calls(actions, 'state_update')).toHaveLength(1)
    finish(undefined)
    await settle()
    expect(calls(actions, 'state_update')).toHaveLength(1)
    expect(q('[data-state-fields-unsaved]')).toBeNull()
    expect(stored().fields.map(field => field.name)).toEqual(['showDrafts', 'search'])
  })
})

describe('the default of a text field', () => {
  const empty = (element: Element) => inRow(element, 'data-state-empty')

  it('can be an empty text, which is not the same as no default', async () => {
    const { actions } = await mounted()
    await addField('note', 'Text')
    expect(empty(last()).getAttribute('aria-pressed')).toBe('false')
    await click(empty(last()))
    expect(empty(last()).getAttribute('aria-pressed')).toBe('true')
    await addField('other', 'Text')
    await save()
    expect(calls(actions, 'state_update')[0]!.fields).toEqual([SHOW_DRAFTS, { name: 'note', type: 'text', default: '' }, { name: 'other', type: 'text' }])
    expect(stored().fields.map(field => field.default)).toEqual([false, '', undefined])
    // Saved, the form shows which it is.
    expect(empty(row('fld_note')).getAttribute('aria-pressed')).toBe('true')
    expect(empty(row('fld_other')).getAttribute('aria-pressed')).toBe('false')
  })

  it('stops being the empty text when a text is typed, and offers it only for a text field', async () => {
    await mounted()
    await addField('note', 'Text')
    await click(empty(last()))
    await typeInto(inRow(last(), 'data-state-default'), 'hi')
    expect(empty(last()).getAttribute('aria-pressed')).toBe('false')
    await pick(combo(`[data-state-field="${last().getAttribute('data-state-field')}"] [data-state-type]`), 'Integer')
    expect(inRow(last(), 'data-state-empty')).toBeNull()
  })
})

describe('the default of a date and time', () => {
  const at = '2026-11-18T10:30:15+02:00'
  const withAt = () => stored().fields.push({ id: 'fld_at', name: 'at', type: 'datetime', default: at })

  it('shows the minutes the box holds, and sends a stored value with seconds and a zone unchanged until it is edited', async () => {
    withAt()
    const { actions } = await mounted()
    expect((inRow(row('fld_at'), 'data-state-default') as HTMLInputElement).value).toBe('2026-11-18T10:30')
    await click(inRow(row('fld_at'), 'data-state-required'))
    await save()
    expect(calls(actions, 'state_update')[0]!.fields).toEqual([SHOW_DRAFTS, { id: 'fld_at', name: 'at', type: 'datetime', required: true, default: at }])
    expect(stored().fields[1]!.default).toBe(at)
  })

  it('is sent as UTC once the box is edited', async () => {
    withAt()
    const { actions } = await mounted()
    await typeInto(inRow(row('fld_at'), 'data-state-default'), '2026-11-18T11:00')
    await save()
    expect((calls(actions, 'state_update')[0]!.fields as Array<Record<string, unknown>>)[1]).toEqual({ id: 'fld_at', name: 'at', type: 'datetime', default: '2026-11-18T11:00:00Z' })
  })
})

describe('the words of the State dialogs and notices', () => {
  it('says a state that is not editable holds several sets of values', async () => {
    world.model.modules.blog!.state.push({ id: 'st_cart', name: 'cart', label: 'Cart', persist: 'memory', shape: 'many', fields: [{ id: 'fld_item', name: 'item', type: 'text' }] })
    await mounted({}, '/data?item=state:st_cart&tab=fields')
    expect(text(q('[data-state-many]'))).toBe('This state holds several sets of values, which the editor can\'t edit yet.')
  })

  it('words the rename warning around code the user wrote, with the generated name as a hint', async () => {
    await mounted({}, '/data/advanced')
    await menuItem(q('[data-artifact-menu="st_preferences"]'), 'Rename')
    expect(text(q('[data-artifact-warning]'))).toBe('Code you wrote yourself that uses this state needs the same rename.')
    expect(text(q('[data-artifact-hint]'))).toBe('It is generated as `useBlogPreferences`.')
    expect(text(q('[data-artifact-warning]'))).not.toContain('useBlogPreferences')
  })

  it('words the rename warning of a query and an action the same way', async () => {
    await mounted({}, '/data/advanced')
    await menuItem(q('[data-artifact-menu="q_featured_posts"]'), 'Rename')
    expect(text(q('[data-artifact-warning]'))).toBe('Code you wrote yourself that uses this query needs the same rename.')
    expect(text(q('[data-artifact-hint]'))).toBe('It is generated as `useFeaturedPosts`.')
  })
})
