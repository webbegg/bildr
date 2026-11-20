import { afterEach, describe, expect, it, vi } from 'vitest'
import { Failure, click, settle, typeInto } from '../helpers.ts'
import { FOLDED_KEY } from '../../src/editor/dataTree.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { FakeEventSource, byLabel, combo, inputOf, menuItem, selectOption, setupHarness, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'
import { ITEMS, activeTab, confirmText, inputs, open, q, qa, stateModule, tab, tabNames, text, treeItem } from './dataKit.ts'

/**
 * State in the Data workspace (B2, S1), mounted as the Data screen over the mocked actions, whose `state_*` and `page_use_*` edits are
 * the module's own (`stateModule`): the State section of the tree, an item's header (its persistence) and its Fields, Used in and JSON
 * tabs, and the New, Rename and Delete dialogs. The blog fixture has one state, `preferences` ("Blog preferences", kept in this browser,
 * one toggle `showDrafts`), which the page index binds and a checkbox sets.
 */

setupHarness()

afterEach(() => {
  takeStart()
  localStorage.removeItem(FOLDED_KEY)
})

const STATE = '/data?item=state:st_preferences&tab=fields'
const FILE = '.bildr/modules/blog/state/preferences.json'
const mounted = (extra: Handlers = {}, path = '/data/advanced') => open({ ...stateModule(), ...extra }, {}, path)
const textButton = (label: string) => qa('button').find(candidate => candidate.textContent?.trim() === label) ?? null
const calls = (actions: Awaited<ReturnType<typeof open>>['actions'], name: string) => inputs(actions, name)
const stored = () => world.model.modules.blog!.state.find(entry => entry.id === 'st_preferences')!

/** Picks the option whose text is exactly `label` (`selectOption` takes the first that starts with it: "Date" is also the start of "Date & time"). */
const pick = async (trigger: Element, label: string) => {
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  const option = qa('[role="option"]').find(element => element.textContent?.trim() === label)
  if (!option) throw new Error(`no option ${label}`)
  option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  option.click()
  await settle()
}

describe('the State section of the Data tree', () => {
  it('lists each state after the Actions, with its label', async () => {
    await mounted()
    const section = q('[data-artifacts="state"]')
    expect(text(section?.querySelector('[data-artifact-toggle]'))).toBe('State')
    expect(qa('[data-artifacts="state"] [data-tree-item]').map(item => item.getAttribute('data-tree-item'))).toEqual([ITEMS.preferences])
    expect(text(treeItem('preferences')?.querySelector('[data-artifact-label]'))).toBe('Blog preferences')
    expect(treeItem('preferences')?.getAttribute('title')).toBe('preferences')
  })

  it('says what state is when there is none, in one line', async () => {
    world.model.modules.blog!.state = []
    await mounted()
    expect(text(q('[data-artifacts-empty="state"]'))).toBe('No state yet. Values the app remembers while it runs, like a filter or a toggle.')
  })

  it('has a + that opens the New state dialog, and a … menu on the row that renames or deletes it', async () => {
    await mounted()
    expect(byLabel('New state')).not.toBeNull()
    expect(byLabel('State options')).not.toBeNull()
    await click(byLabel('New state'))
    expect(q('[data-artifact-dialog="create"]')).not.toBeNull()
    expect(text(q('[role="dialog"]'))).toContain('New state')
  })

  it('folds from its header like the other sections, and remembers it', async () => {
    await mounted()
    await click(q('[data-artifact-toggle="state"]'))
    expect(q('[data-artifact-toggle="state"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(qa('[data-artifacts="state"] [data-tree-item]')).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(FOLDED_KEY)!)).toEqual(['state'])
  })

  it('shows the state in the workspace with its Fields, Used in and JSON tabs, and puts it in the URL', async () => {
    const { router } = await mounted()
    await click(treeItem('preferences'))
    expect(text(q('[data-data-title] h2'))).toBe('Blog preferences')
    expect(text(q('[data-data-title]'))).toContain('State')
    expect(tabNames()).toEqual(['fields', 'used', 'json'])
    expect(activeTab()).toBe('fields')
    expect(router.currentRoute.value.query).toEqual({ item: 'state:st_preferences', tab: 'fields' })
    expect(treeItem('preferences')?.getAttribute('aria-selected')).toBe('true')
  })

  it('opens the state and the tab a deep link names', async () => {
    await mounted({}, '/data?item=state:st_preferences&tab=used')
    expect(text(q('[data-data-title] h2'))).toBe('Blog preferences')
    expect(activeTab()).toBe('used')
  })

  it('falls back to the first collection for a deep link to a state that is gone', async () => {
    const { router } = await mounted({}, '/data/advanced?item=state:st_gone')
    expect(text(q('[data-data-title] h2'))).toBe('Post')
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_post', tab: 'rows' })
  })
})

describe('the words of State', () => {
  /** Everything the screen says: its text, and the titles, labels and placeholders a user reads or hears. */
  const said = () => {
    const page = document.body.cloneNode(true) as HTMLElement
    return [page.textContent ?? '', ...[...page.querySelectorAll('[title], [aria-label], [placeholder]')].flatMap(element => ['title', 'aria-label', 'placeholder'].map(name => element.getAttribute(name) ?? ''))].join(' | ')
  }
  const UNWANTED = /composable|entit(y|ies)|\bshape\b|localStorage|sessionStorage|synced|fixtures?\b|data source/i

  it('never says composable, entity, shape or a storage name, on any tab or in any dialog', async () => {
    await mounted({}, STATE)
    expect(said()).not.toMatch(UNWANTED)
    // (The JSON tab is the file as it is, with its own keys.)
    await click(tab('used'))
    expect(said(), 'used').not.toMatch(UNWANTED)
    await click(tab('fields'))
    await click(q('[data-state-add]'))
    expect(said()).not.toMatch(UNWANTED)
    await click(q('[data-state-fields-discard]'))
    await click(byLabel('New state'))
    expect(said(), 'New').not.toMatch(UNWANTED)
    await click(textButton('Cancel'))
    await menuItem(q('[data-artifact-menu="st_preferences"]'), 'Rename')
    expect(said(), 'Rename').not.toMatch(/entit(y|ies)|\bshape\b|localStorage|sessionStorage/i)
    await click(textButton('Cancel'))
    await menuItem(q('[data-artifact-menu="st_preferences"]'), 'Delete')
    expect(said(), 'Delete').not.toMatch(UNWANTED)
  })
})

describe('the header of a state: how long it keeps its values', () => {
  const persist = () => combo('[data-state-persist]')

  it('says it in the words of the workspace, and never the storage\'s', async () => {
    await mounted({}, STATE)
    expect(text(q('[data-state-header]'))).toContain('Kept in this browser')
    expect(text(q('[data-state-header]'))).not.toMatch(/localStorage|sessionStorage|memory/i)
  })

  it('offers Forgotten on reload, Kept for this tab and Kept in this browser, and saves the choice with state_update', async () => {
    const { actions } = await mounted({}, STATE)
    await selectOption(persist(), 'Kept for this tab')
    expect(calls(actions, 'state_update')).toEqual([{ state: 'st_preferences', persist: 'session' }])
    expect(stored().persist).toBe('session')
    expect(text(q('[data-state-header]'))).toContain('Kept for this tab')
    await selectOption(persist(), 'Forgotten on reload')
    expect(calls(actions, 'state_update').at(-1)).toEqual({ state: 'st_preferences', persist: 'memory' })
  })

  it('shows what the module refused, beside the choice, and keeps the state as it was', async () => {
    await mounted({ state_update: () => new Failure(422, 'invalid', 'The state can\'t be saved right now') }, STATE)
    await selectOption(persist(), 'Kept for this tab')
    expect(text(q('[data-state-persist-error]'))).toBe('The state can\'t be saved right now')
    expect(stored().persist).toBe('localStorage')
    expect(text(q('[data-state-header]'))).toContain('Kept in this browser')
    expect(q('[data-testid="error-banner"]')).toBeNull()
  })
})

describe('the Fields tab of a state', () => {
  const rows = () => qa('[data-state-fields] [data-state-field]')
  const row = (id: string) => q(`[data-state-field="${id}"]`)!
  const last = () => rows().at(-1)!
  const inRow = (element: Element, hook: string) => element.querySelector<HTMLElement>(`[${hook}]`)!
  const save = () => click(q('[data-state-fields-save]'))
  const addField = async (name: string, type?: string, defaultText?: string) => {
    await click(q('[data-state-add]'))
    await typeInto(inRow(last(), 'data-state-name'), name)
    if (type) await pick(combo(`[data-state-field="${last().getAttribute('data-state-field')}"] [data-state-type]`), type)
    if (defaultText !== undefined) await typeInto(inRow(last(), 'data-state-default'), defaultText)
  }

  it('lists each field with its name, type, default and whether it is required', async () => {
    await mounted({}, STATE)
    expect(rows().map(entry => entry.getAttribute('data-state-field'))).toEqual(['fld_show_drafts'])
    const showDrafts = row('fld_show_drafts')
    expect(inputOf('[data-state-field="fld_show_drafts"] [data-state-name]').value).toBe('showDrafts')
    expect(text(inRow(showDrafts, 'data-state-type'))).toContain('Toggle')
    expect((inRow(showDrafts, 'data-state-default') as HTMLInputElement).type).toBe('checkbox')
    expect((inRow(showDrafts, 'data-state-default') as HTMLInputElement).checked).toBe(false)
    expect((inRow(showDrafts, 'data-state-required') as HTMLInputElement).checked).toBe(false)
  })

  it('says how many places use a field, as a collection\'s field does, and lists them', async () => {
    await mounted({}, STATE)
    const badge = q('[data-state-field="fld_show_drafts"] [data-field-uses]')
    expect(text(badge)).toBe('1')
    await click(badge)
    expect(text(q('[data-field-uses-list="showDrafts"]'))).toContain('A computed value reads “preferences.showDrafts”')
  })

  it('has nothing to save until something is edited', async () => {
    await mounted({}, STATE)
    expect(q('[data-state-fields-unsaved]')).toBeNull()
    expect(q('[data-state-fields-save]')?.hasAttribute('disabled')).toBe(true)
    expect(q('[data-state-fields-discard]')?.hasAttribute('disabled')).toBe(true)
  })

  it('adds a field with a type, a default that fits it and required, and saves the whole list with state_update', async () => {
    const { actions } = await mounted({}, STATE)
    await addField('perPage', 'Integer', '10')
    await click(inRow(last(), 'data-state-required'))
    expect(text(q('[data-state-fields-unsaved]'))).toBe('Unsaved changes')
    expect(calls(actions, 'state_update')).toEqual([])
    await save()
    expect(calls(actions, 'state_update')).toEqual([{
      state: 'st_preferences',
      fields: [{ id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false }, { name: 'perPage', type: 'integer', required: true, default: 10 }]
    }])
    expect(stored().fields.map(field => [field.id, field.name, field.type, field.required, field.default])).toEqual([
      ['fld_show_drafts', 'showDrafts', 'boolean', undefined, false],
      ['fld_per_page', 'perPage', 'integer', true, 10]
    ])
    expect(q('[data-state-fields-unsaved]')).toBeNull()
    expect(rows().map(entry => entry.getAttribute('data-state-field'))).toEqual(['fld_show_drafts', 'fld_per_page'])
  })

  it('offers an input that fits each type: a checkbox, a number, a date, a date and time and text', async () => {
    await mounted({}, STATE)
    const kinds: Record<string, string> = {}
    for (const [label, type] of [['Toggle', 'checkbox'], ['Integer', 'number'], ['Number', 'number'], ['Date', 'date'], ['Date & time', 'datetime-local'], ['Text', 'text'], ['UUID', 'text'], ['Image', 'text']] as const) {
      await click(q('[data-state-add]'))
      await pick(combo(`[data-state-field="${last().getAttribute('data-state-field')}"] [data-state-type]`), label)
      kinds[label] = (inRow(last(), 'data-state-default') as HTMLInputElement).type
      expect(kinds[label], label).toBe(type)
    }
  })

  it('starts a toggle on no, so what its checkbox shows is what the state starts with', async () => {
    const { actions } = await mounted({}, STATE)
    await addField('open', 'Toggle')
    expect((inRow(last(), 'data-state-default') as HTMLInputElement).checked).toBe(false)
    await save()
    expect((calls(actions, 'state_update')[0]!.fields as Array<Record<string, unknown>>).at(-1)).toEqual({ name: 'open', type: 'boolean', default: false })
  })

  it('saves a date and a toggle default as the value of the type', async () => {
    const { actions } = await mounted({}, STATE)
    await addField('since', 'Date', '2026-11-18')
    await addField('open', 'Toggle')
    await click(inRow(last(), 'data-state-default'))
    await save()
    expect(calls(actions, 'state_update')[0]!.fields).toEqual([
      { id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false },
      { name: 'since', type: 'date', default: '2026-11-18' },
      { name: 'open', type: 'boolean', default: true }
    ])
  })

  it('does not send a default that does not fit, and says which', async () => {
    const { actions } = await mounted({}, STATE)
    await addField('perPage', 'Integer', '1.5')
    await save()
    expect(calls(actions, 'state_update')).toEqual([])
    expect(text(q('[data-state-fields-error]'))).toBe('perPage: its default is a whole number')
  })

  it('reorders fields with the arrows, and sends the order', async () => {
    const { actions } = await mounted({}, STATE)
    await addField('search', 'Text')
    await click(inRow(last(), 'data-state-up'))
    expect(inputOf('[data-state-field]:first-child [data-state-name]').value).toBe('search')
    expect(inRow(rows()[0]!, 'data-state-up').hasAttribute('disabled')).toBe(true)
    expect(inRow(rows().at(-1)!, 'data-state-down').hasAttribute('disabled')).toBe(true)
    await save()
    expect((calls(actions, 'state_update')[0]!.fields as Array<{ name: string }>).map(field => field.name)).toEqual(['search', 'showDrafts'])
  })

  it('removes a field it just added without asking, and a field nothing uses with the list', async () => {
    const { actions } = await mounted({}, STATE)
    await addField('search', 'Text')
    await click(inRow(last(), 'data-state-remove'))
    expect(rows()).toHaveLength(1)
    expect(q('[data-confirm]')).toBeNull()
    expect(q('[data-state-fields-unsaved]')).toBeNull()
    await addField('search', 'Text')
    await save()
    await click(inRow(last(), 'data-state-remove'))
    expect(rows()).toHaveLength(1)
    await save()
    expect((calls(actions, 'state_update').at(-1)!.fields as Array<{ name: string }>).map(field => field.name)).toEqual(['showDrafts'])
    expect(stored().fields.map(field => field.name)).toEqual(['showDrafts'])
  })

  it('warns before a field a page uses is removed, lists its uses, has only a Close button, and keeps the field', async () => {
    const { actions } = await mounted({}, STATE)
    await click(inRow(row('fld_show_drafts'), 'data-state-remove'))
    expect(confirmText()).toContain('“showDrafts” is used in 1 place')
    expect(confirmText()).toContain('A field can\'t be removed while it is used')
    // The one button of a blocked change is Close (the Cancel hook): there is nothing to confirm.
    expect(q('[data-confirm-cancel]')?.textContent?.trim()).toBe('Close')
    expect(q('[data-confirm-ok]')).toBeNull()
    expect(q('[data-confirm] [data-use-open="page:pg_index"]')).not.toBeNull()
    await click(q('[data-confirm-cancel]'))
    expect(rows()).toHaveLength(1)
    expect(q('[data-state-fields-unsaved]')).toBeNull()
    expect(calls(actions, 'state_update')).toEqual([])
  })

  it('shows what the module refused next to the field it is about, and keeps the draft', async () => {
    const { actions } = await mounted({}, STATE)
    await typeInto(inputOf('[data-state-field="fld_show_drafts"] [data-state-name]'), 'showAll')
    await save()
    expect(calls(actions, 'state_update')).toHaveLength(1)
    expect(text(q('[data-state-field="fld_show_drafts"] [data-state-field-error]'))).toContain('The field showDrafts of the state preferences')
    expect(text(q('[data-state-field="fld_show_drafts"] [data-state-field-error]'))).toContain('is still used')
    expect(q('[data-state-fields-error]')).toBeNull()
    expect(inputOf('[data-state-field="fld_show_drafts"] [data-state-name]').value).toBe('showAll')
    expect(stored().fields[0]!.name).toBe('showDrafts')
    // Editing again clears it.
    await typeInto(inputOf('[data-state-field="fld_show_drafts"] [data-state-name]'), 'showDrafts')
    expect(q('[data-state-field-error]')).toBeNull()
  })

  it('shows a refusal about the state itself in the footer, and keeps the draft', async () => {
    await mounted({ state_update: () => new Failure(404, 'not_found', 'No state "st_preferences"') }, STATE)
    await addField('search', 'Text')
    await save()
    expect(text(q('[data-state-fields-error]'))).toBe('No state "st_preferences"')
    expect(q('[data-state-field-error]')).toBeNull()
    expect(rows()).toHaveLength(2)
  })

  it('shows a required field with no default as the module refuses it, next to the field', async () => {
    await mounted({}, STATE)
    await addField('search', 'Text')
    await click(inRow(last(), 'data-state-required'))
    await save()
    expect(text(q('[data-state-field-error]'))).toContain('search: a required field needs a default')
    expect(q('[data-state-fields-error]')).toBeNull()
  })

  it('discards the edits without asking', async () => {
    await mounted({}, STATE)
    await addField('search', 'Text')
    await click(q('[data-state-fields-discard]'))
    expect(rows()).toHaveLength(1)
    expect(q('[data-state-fields-unsaved]')).toBeNull()
    expect(q('[data-confirm]')).toBeNull()
  })

  describe('unsaved edits', () => {
    const DISCARD = 'Discard unsaved changes to Blog preferences?'

    it('asks before another tab or another item is shown, keeps the draft when it is declined, and drops it when it is confirmed', async () => {
      await mounted({}, STATE)
      await addField('search', 'Text')
      await click(tab('used'))
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      expect(activeTab()).toBe('fields')
      expect(rows()).toHaveLength(2)
      await click(treeItem('allPosts'))
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-ok]'))
      expect(text(q('[data-data-title] h2'))).toBe('All posts')
      await click(treeItem('preferences'))
      expect(rows()).toHaveLength(1)
    })
  })

  describe('the state changing elsewhere while the form is edited', () => {
    let version = 100
    /** Another editor, a rename, an undo or a JSON-tab save: the model has a different state, and the editor reads it. */
    const outside = async (change: () => void) => {
      change()
      FakeEventSource.instances.at(-1)!.send({ type: 'model', version: version++, files: [FILE], source: 'disk' })
      await settle()
    }

    it('says so, leaves the edits, and blocks Save until the user chooses', async () => {
      const { actions } = await mounted({}, STATE)
      await addField('search', 'Text')
      await outside(() => {
        stored().fields[0]!.default = true
      })
      expect(text(q('[data-state-fields-changed]'))).toContain('This state changed since you started editing')
      expect(textButton('Load the new version')).not.toBeNull()
      expect(textButton('Keep my edits')).not.toBeNull()
      expect(rows()).toHaveLength(2)
      expect(q('[data-state-fields-save]')?.hasAttribute('disabled')).toBe(true)
      await save()
      expect(calls(actions, 'state_update')).toEqual([])
    })

    it('shows no notice while nothing was edited: the form follows the model', async () => {
      await mounted({}, STATE)
      await outside(() => {
        stored().fields[0]!.default = true
      })
      expect(q('[data-state-fields-changed]')).toBeNull()
      expect((inRow(row('fld_show_drafts'), 'data-state-default') as HTMLInputElement).checked).toBe(true)
    })

    it('loads the new version over the edits on request', async () => {
      await mounted({}, STATE)
      await addField('search', 'Text')
      await outside(() => {
        stored().fields[0]!.default = true
      })
      await click(textButton('Load the new version'))
      expect(q('[data-state-fields-changed]')).toBeNull()
      expect(rows()).toHaveLength(1)
      expect((inRow(row('fld_show_drafts'), 'data-state-default') as HTMLInputElement).checked).toBe(true)
    })

    it('keeps the edits over the new version, and sends the whole list with what changed elsewhere', async () => {
      const { actions } = await mounted({}, STATE)
      await addField('search', 'Text')
      await outside(() => {
        stored().fields[0]!.default = true
      })
      await click(textButton('Keep my edits'))
      expect(q('[data-state-fields-changed]')).toBeNull()
      expect((inRow(row('fld_show_drafts'), 'data-state-default') as HTMLInputElement).checked).toBe(true)
      await save()
      expect(calls(actions, 'state_update')[0]!.fields).toEqual([
        { id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: true },
        { name: 'search', type: 'text' }
      ])
    })

    it('does not count a change of the persistence or the label as the fields changing', async () => {
      await mounted({}, STATE)
      await addField('search', 'Text')
      await outside(() => {
        stored().persist = 'session'
      })
      expect(q('[data-state-fields-changed]')).toBeNull()
      expect(rows()).toHaveLength(2)
    })
  })
})

describe('a state that holds several sets of values', () => {
  const several = async () => {
    world.model.modules.blog!.state.push({ id: 'st_cart', name: 'cart', label: 'Cart', persist: 'memory', shape: 'many', fields: [{ id: 'fld_item', name: 'item', type: 'text' }] })
    return mounted({}, '/data?item=state:st_cart&tab=fields')
  }

  it('is read-only, and says it is not generated yet', async () => {
    await several()
    expect(text(q('[data-state-many]'))).toBe('This state holds several sets of values, which the editor can\'t edit yet.')
    expect(q('[data-state-field] input')).toBeNull()
    expect(q('[data-state-add]')).toBeNull()
    expect(q('[data-state-fields-save]')).toBeNull()
    expect(text(q('[data-state-field="fld_item"]'))).toContain('item')
    expect(combo('[data-state-persist]').hasAttribute('disabled')).toBe(true)
  })

  it('says nothing of shapes, entities or composables', async () => {
    await several()
    expect(text(q('[data-state-many]'))).not.toMatch(/shape|entity|composable|\brows?\b/i)
  })
})

describe('Used in, for a state', () => {
  const entries = () => qa('[data-used-in] [data-use]').map(entry => entry.getAttribute('data-use'))

  it('lists the page that reads it, with how', async () => {
    await mounted({}, '/data?item=state:st_preferences&tab=used')
    expect(entries()).toEqual(['page:pg_index'])
    const entry = text(q('[data-use="page:pg_index"]'))
    expect(entry).toContain('index')
    expect(entry).toContain('Reads it as “preferences”')
    expect(entry).toContain('A computed value reads “preferences”')
    expect(entry).toContain('changes it on an interaction')
  })

  it('says a page that lists the state but nothing on it reads or sets it is just that', async () => {
    const post = world.model.modules.blog!.pages.find(page => page.id === 'pg_new_post')!
    post.uses = { ...post.uses, state: [{ as: 'prefs', state: 'st_preferences' }] }
    await mounted({}, '/data?item=state:st_preferences&tab=used')
    expect(entries()).toEqual(['page:pg_index', 'page:pg_new_post'])
    const bare = text(q('[data-use="page:pg_new_post"]'))
    expect(bare).toContain('Is listed in the page\'s data, but nothing reads it')
    expect(bare).not.toContain('Reads it')
    // A page that reads it keeps saying how.
    expect(text(q('[data-use="page:pg_index"]'))).toContain('Reads it as “preferences”')
  })

  it('opens the page on the Canvas from its entry', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await mounted({}, '/data?item=state:st_preferences&tab=used')
      await click(q('[data-use-open="page:pg_index"]'))
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.pageId).toBe('pg_index')
    } finally {
      off()
    }
  })

  it('says nothing uses a state that is not used', async () => {
    const { actions } = await mounted({}, '/data/advanced')
    await click(byLabel('New state'))
    await typeInto(inputOf('[data-artifact-name]'), 'cart')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'state_create')).toHaveLength(1)
    await click(tab('used'))
    expect(entries()).toEqual([])
    expect(text(q('[data-used-in]'))).toContain('Not used yet. No page reads or sets this state.')
  })
})

describe('the JSON tab of a state', () => {
  it('edits the state\'s own file in the raw editor', async () => {
    await mounted({}, '/data?item=state:st_preferences&tab=json')
    const raw = q('[data-testid="raw-content"]')
    const area = (raw?.matches('textarea') ? raw : raw?.querySelector('textarea')) as HTMLTextAreaElement
    expect((JSON.parse(area.value) as { id: string }).id).toBe('st_preferences')
    expect(text(q('[data-data-json]'))).toContain('.bildr/modules/blog/state/preferences.json')
  })
})

describe('the dialogs of state', () => {
  const dialog = (kind: 'create' | 'rename' | 'delete') => q(`[data-artifact-dialog="${kind}"]`)
  const nameInput = () => inputOf('[data-artifact-name]')
  const submit = () => click(q('[data-artifact-submit]'))
  const error = () => text(q('[data-artifact-error]'))
  const choices = () => qa('[data-state-persistence]').map(choice => [choice.getAttribute('data-state-persistence'), choice.getAttribute('aria-checked')])

  describe('New state', () => {
    const openCreate = async (extra: Handlers = {}) => {
      const mount = await mounted(extra)
      await click(byLabel('New state'))
      return mount
    }

    it('asks for a name and where the values are kept, on Forgotten on reload, and says what it starts with', async () => {
      await openCreate()
      expect(text(q('[role="dialog"]'))).toContain('New state')
      expect(text(q('[data-state-persistence="memory"]'))).toContain('Forgotten on reload')
      expect(text(q('[data-state-persistence="session"]'))).toContain('Kept for this tab')
      expect(text(q('[data-state-persistence="localStorage"]'))).toContain('Kept in this browser')
      expect(choices()).toEqual([['memory', 'true'], ['session', 'false'], ['localStorage', 'false']])
      // One text field, as New collection makes one: the user names it in the Fields tab, so the dialog asks for less.
      expect(text(q('[data-state-first-field]'))).toBe('It starts with one text field, “value”. Rename it and add the others in its Fields tab.')
    })

    it('says nothing of composables, entities, shapes or storage names', async () => {
      await openCreate()
      expect(text(q('[role="dialog"]'))).not.toMatch(/composable|entit(y|ies)|shape|localStorage|sessionStorage/i)
    })

    it('creates it with state_create over the persistence chosen, and opens it on Fields', async () => {
      const { actions, router } = await openCreate()
      await click(q('[data-state-persistence="session"]'))
      await typeInto(nameInput(), 'cart filter')
      await submit()
      expect(calls(actions, 'state_create')).toEqual([{ name: 'cart filter', persist: 'session' }])
      expect(dialog('create')).toBeNull()
      expect(activeTab()).toBe('fields')
      expect(router.currentRoute.value.query).toEqual({ item: 'state:st_cart_filter', tab: 'fields' })
      expect(inputOf('[data-state-field] [data-state-name]').value).toBe('value')
      expect(text(q('[data-state-header]'))).toContain('Kept for this tab')
    })

    it('makes a state kept only in memory by default', async () => {
      const { actions } = await openCreate()
      await typeInto(nameInput(), 'cart')
      await submit()
      expect(calls(actions, 'state_create')).toEqual([{ name: 'cart', persist: 'memory' }])
    })

    it('shows what the module refused inside the dialog, and keeps the input', async () => {
      const { actions } = await openCreate()
      await typeInto(nameInput(), 'preferences')
      await click(q('[data-state-persistence="localStorage"]'))
      await submit()
      expect(calls(actions, 'state_create')).toHaveLength(1)
      expect(error()).toBe('Module "blog" already has the state preferences (st_preferences)')
      expect(nameInput().value).toBe('preferences')
      expect(q('[data-state-persistence="localStorage"]')?.getAttribute('aria-checked')).toBe('true')
      expect(dialog('create')).not.toBeNull()
    })

    it('asks to discard unsaved edits first, and makes nothing when that is declined', async () => {
      const { actions } = await mounted({}, STATE)
      await click(q('[data-state-add]'))
      await click(byLabel('New state'))
      await typeInto(nameInput(), 'cart')
      await submit()
      expect(confirmText()).toContain('Discard unsaved changes to Blog preferences?')
      await click(q('[data-confirm-cancel]'))
      expect(calls(actions, 'state_create')).toEqual([])
      expect(dialog('create')).not.toBeNull()
    })
  })

  describe('Rename', () => {
    const openRename = async (id = 'st_preferences') => {
      const mount = await mounted()
      await menuItem(q(`[data-artifact-menu="${id}"]`), 'Rename')
      return mount
    }

    it('starts on the name and says code the user wrote that uses the state needs the same rename, with the generated name as a hint', async () => {
      await openRename()
      expect(text(q('[role="dialog"]'))).toContain('Rename state')
      expect(nameInput().value).toBe('preferences')
      expect(text(q('[data-artifact-warning]'))).toBe('Code you wrote yourself that uses this state needs the same rename.')
      expect(text(q('[data-artifact-hint]'))).toBe('It is generated as `useBlogPreferences`.')
      expect(text(q('[data-artifact-dialog="rename"]'))).toContain('Pages and steps that use it refer to it by id: they are updated with it.')
    })

    it('renames with state_rename, keeps the state shown, and closes', async () => {
      const { actions, router } = await mounted({}, STATE)
      await menuItem(q('[data-artifact-menu="st_preferences"]'), 'Rename')
      await typeInto(nameInput(), 'settings')
      await submit()
      expect(calls(actions, 'state_rename')).toEqual([{ state: 'st_preferences', name: 'settings' }])
      expect(dialog('rename')).toBeNull()
      expect(treeItem('preferences')?.getAttribute('title')).toBe('settings')
      expect(router.currentRoute.value.query).toEqual({ item: 'state:st_preferences', tab: 'fields' })
    })

    it('shows what the module refused inside the dialog, and keeps the input', async () => {
      await openRename()
      await typeInto(nameInput(), 'default')
      await submit()
      expect(error()).toContain('reserved word')
      expect(nameInput().value).toBe('default')
      expect(dialog('rename')).not.toBeNull()
    })

    it('does not send a rename to the same name', async () => {
      const { actions } = await openRename()
      await submit()
      expect(calls(actions, 'state_rename')).toEqual([])
      expect(dialog('rename')).toBeNull()
    })

    it('opens with F2 on the focused row', async () => {
      await mounted()
      treeItem('preferences')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }))
      await settle()
      expect(dialog('rename')).not.toBeNull()
    })
  })

  describe('Delete', () => {
    const made = async () => {
      const mount = await mounted()
      await click(byLabel('New state'))
      await typeInto(nameInput(), 'cart')
      await submit()
      return mount
    }

    it('is refused while a page uses the state: the uses are listed as links, and the button is disabled with the reason', async () => {
      const { actions } = await mounted()
      await menuItem(q('[data-artifact-menu="st_preferences"]'), 'Delete')
      expect(text(q('[role="dialog"]'))).toContain('Delete state')
      expect(text(q('[role="dialog"]'))).toContain('Blog preferences (preferences)')
      expect(text(q('[data-artifact-uses]'))).toContain('Used in 1 place')
      expect(q('[data-artifact-uses] [data-use-open="page:pg_index"]')).not.toBeNull()
      expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(true)
      expect(q('[data-artifact-submit]')?.getAttribute('title')).toBe('Used in 1 place: change it first')
      await submit()
      expect(calls(actions, 'state_delete')).toEqual([])
      expect(treeItem('preferences')).not.toBeNull()
    })

    it('deletes a state nothing uses with state_delete, and falls back to the first collection when it was shown', async () => {
      const { actions, router } = await made()
      expect(router.currentRoute.value.query.item).toBe('state:st_cart')
      await menuItem(q('[data-artifact-menu="st_cart"]'), 'Delete')
      expect(q('[data-artifact-uses]')).toBeNull()
      expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(false)
      await submit()
      expect(calls(actions, 'state_delete')).toEqual([{ state: 'st_cart' }])
      expect(dialog('delete')).toBeNull()
      expect(q('[data-tree-item="state:st_cart"]')).toBeNull()
      // The collection is shown again, on the tab the state had when the collection has it too.
      expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_post', tab: 'fields' })
    })

    it('shows the module\'s refusal in the dialog for a state the editor did not know was used', async () => {
      const module = stateModule()
      const { actions } = await mounted({
        state_delete: (input) => {
          // Another editor has the page read the state after this dialog opened: the module is the one that knows.
          const page = world.model.modules.blog!.pages.find(entry => entry.id === 'pg_new_post')!
          page.uses = { ...page.uses, state: [{ as: 'cart', state: 'st_cart' }] }
          return module.state_delete!(input)
        }
      })
      await click(byLabel('New state'))
      await typeInto(nameInput(), 'cart')
      await submit()
      await menuItem(q('[data-artifact-menu="st_cart"]'), 'Delete')
      await submit()
      expect(calls(actions, 'state_delete')).toEqual([{ state: 'st_cart' }])
      expect(dialog('delete')).not.toBeNull()
      expect(error()).toContain('State cart (st_cart) is still used')
      expect(q('[data-testid="error-banner"]')).toBeNull()
    })
  })
})
