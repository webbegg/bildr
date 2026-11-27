import { afterEach, describe, expect, it } from 'vitest'
import { click, Failure, settle, typeInto } from '../helpers.ts'
import { applyEdit } from '@bildr/codegen/edit'
import { serializeModel } from '@bildr/codegen/model'
import { FOLDED_KEY } from '../../src/editor/dataTree.ts'
import { takeStart } from '../../src/editor/views.ts'
import { FakeEventSource, combo, inputOf, menuItem, menuLabels, must, optionLabels, selectOption, setupHarness, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'
import { activeTab, artifactModule, confirmText, inputs, open, q, qa, tab, tabNames, text, treeItem } from './dataKit.ts'
import type { Mounted } from './dataKit.ts'

/**
 * The Steps tab of an action (S10, D10c) over the module's own edits: its list and the forms of each kind of step, what the editor
 * says before the module does, the errors, saving, unsaved edits and an action changing elsewhere. The helpers say what a test
 * means: `stepCard`, `fieldOf`, `dragStep` and `kindsOf`.
 */

setupHarness()

afterEach(() => {
  takeStart()
  localStorage.removeItem('bildr:panel-width')
  localStorage.removeItem(FOLDED_KEY)
})

describe('Action Steps (S10, D10c)', () => {
  const stepsTab = (id = 'act_create_post', extra: Handlers = {}) => open({ ...artifactModule(), ...extra }, {}, `/data?item=action:${id}&tab=steps`)
  const updates = (actions: Mounted['actions']) => inputs(actions, 'action_update')
  /** The card of step `index` (from 0), and the kinds of all the cards in order. */
  const stepCard = (index: number) => q(`[data-step-card="${index}"]`)
  const kindsOf = () => qa('[data-step-card]').map(entry => entry.getAttribute('data-step-kind'))
  /** The selector of a field of a card's form: `[data-step-card="1"] [data-step-field="op"]`. */
  const fieldOf = (index: number, name: string) => `[data-step-card="${index}"] [data-step-field="${name}"]`
  const opened = () => qa('[data-step-card]').flatMap((entry, at) => entry.querySelector('[aria-expanded="true"]') ? [at] : [])
  const summaries = () => qa('[data-step-summary]').map(text)
  /** Opens the form of step `index`, when it is not open, and leaves the others as they are. */
  const show = async (index: number) => {
    if (!opened().includes(index)) await click(stepCard(index)!.querySelector('[data-step-toggle]'))
  }
  /** Shows the form of step `index` and no other (the first card is open to start with), so a selector finds one form. */
  const expand = async (index: number) => {
    for (const at of opened()) if (at !== index) await click(stepCard(at)!.querySelector('[data-step-toggle]'))
    await show(index)
  }
  const addStep = (label: string) => menuItem(q('[data-step-add]'), label)
  const save = () => click(q('[data-steps-save]'))
  const problemsOf = (index: number) => qa(`[data-step-card="${index}"] [data-step-problem]`).map(text)
  const within = (index: number, selector: string) => stepCard(index)!.querySelector<HTMLElement>(selector)
  const stored = (id = 'act_create_post') => world.model.modules.blog!.actions.find(entry => entry.id === id)!
  /** A blank action made by the module, as the "+" of the Actions section makes it: one return that always runs. */
  const blank = () => {
    artifactModule().action_create!({ entity: 'ent_post', template: 'blank', name: 'archive post' })
    return 'act_archive_post'
  }
  /** Drags the grip of step `from` to the upper half (`before`) or the lower half of step `to`, as the pointer does. */
  const dragStep = async (from: number, to: number, half: 'before' | 'after' = 'before') => {
    within(from, '[data-step-handle]')!.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: { setData() {}, setDragImage() {}, effectAllowed: '' } }))
    const target = stepCard(to)!.parentElement!
    target.getBoundingClientRect = () => ({ top: 0, height: 36, bottom: 36, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} })
    target.dispatchEvent(Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { clientY: half === 'before' ? 6 : 30 }))
    target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    await settle()
  }
  /** Closes the select a test left open. */
  const closeMenus = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
  }

  describe('the list', () => {
    it('lists the steps in order, each with its kind and a sentence of what it does, and the errors below', async () => {
      await stepsTab()
      expect(activeTab()).toBe('steps')
      expect(kindsOf()).toEqual(['validate', 'assert', 'repository'])
      expect(qa('[data-step-label]').map(text)).toEqual(['Check', 'Refuse', 'Write'])
      expect(summaries()).toEqual(['Checks the input', 'Refuses with “slug_taken” if a Post with this slug already exists', 'Creates a Post'])
      expect(inputOf('[data-error-row="0"] [data-error-field="type"]').value).toBe('slug_taken')
      expect(inputOf('[data-error-row="0"] [data-error-field="status"]').value).toBe('409')
      expect(inputOf('[data-error-row="0"] [data-error-field="message"]').value).toBe('The slug "{slug}" is already used by another post.')
      // Only the first card is open, nothing is changed, and nothing is wrong.
      expect(opened()).toEqual([0])
      expect(qa('[data-step-form]')).toHaveLength(1)
      expect(q('[data-steps-unsaved]')).toBeNull()
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      expect(qa('[data-step-problem]')).toEqual([])
    })

    it('is the Steps tab, between Overview and Used in, and the URL has it', async () => {
      const { router } = await open({ ...artifactModule() }, {}, '/data?item=action:act_create_post&tab=overview')
      expect(tabNames()).toEqual(['overview', 'steps', 'used', 'json'])
      await click(tab('steps'))
      expect(router.currentRoute.value.query).toEqual({ item: 'action:act_create_post', tab: 'steps' })
      expect(q('[data-action-steps]')).not.toBeNull()
      await click(tab('used'))
      expect(router.currentRoute.value.query.tab).toBe('used')
    })

    it('shows a step that is not generated yet read-only, with a link to the JSON tab, and does not offer to add one', async () => {
      stored().steps.splice(1, 0, { kind: 'call', service: 'mail' })
      await stepsTab()
      expect(kindsOf()).toEqual(['validate', 'call', 'assert', 'repository'])
      expect(text(within(1, '[data-step-not-generated]'))).toBe('Not generated yet')
      expect(text(within(1, '[data-step-summary]'))).toBe('Calls a service. Not generated yet')
      expect(within(1, '[data-step-toggle]')?.getAttribute('aria-expanded')).toBe('false')
      expect(within(1, '[data-step-duplicate]')).toBeNull()
      await click(within(1, '[data-step-toggle]'))
      expect(within(1, '[data-step-form]')).toBeNull()
      await click(within(1, '[data-step-json]'))
      expect(activeTab()).toBe('json')
      await click(tab('steps'))
      const labels = await menuLabels(q('[data-step-add]'))
      expect(labels).toEqual(['Check the input', 'Refuse if found', 'Load a row', 'Write', 'Return', 'Call a service (not generated yet)', 'Run custom code (not generated yet)'])
      expect(qa('[role^="menuitem"]').slice(-2).map(item => item.getAttribute('aria-disabled'))).toEqual(['true', 'true'])
    })

    it('says there are no steps in an action that has none', async () => {
      const { actions } = await stepsTab()
      await click(within(2, '[data-step-remove]'))
      await click(within(1, '[data-step-remove]'))
      await click(within(0, '[data-step-remove]'))
      expect(kindsOf()).toEqual([])
      expect(text(q('[data-steps-empty]'))).toContain('No steps yet')
      expect(text(q('[data-steps-problems]'))).toBe('An action needs at least one step')
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      expect(updates(actions)).toEqual([])
    })
  })

  describe('adding, moving, copying and removing a step', () => {
    it('adds a step from the menu of kinds, before the step that must stay last, opened and filled as far as the action says', async () => {
      const id = blank()
      await stepsTab(id)
      expect(kindsOf()).toEqual(['return'])
      await addStep('Load a row')
      expect(kindsOf()).toEqual(['load', 'return'])
      expect(within(0, '[data-step-toggle]')?.getAttribute('aria-expanded')).toBe('true')
      expect(inputOf('[data-step-field="as"]').value).toBe('post')
      expect(text(combo('[data-step-field="repository"]'))).toBe('Post')
      expect(text(combo('[data-step-field="op"]'))).toBe('Get by id')
      expect(text(q('[data-step-arg="id"] [data-value-source]'))).toBe('Input: id')
      expect(text(q('[data-steps-unsaved]'))).toBe('Unsaved changes')
      expect(problemsOf(0)).toEqual([])
    })

    it('puts a write last: after the other steps, and in place of the blank action\'s bare return, which only ended the action', async () => {
      const id = blank()
      await stepsTab(id)
      await addStep('Load a row')
      await addStep('Write')
      expect(kindsOf()).toEqual(['load', 'repository'])
      expect(problemsOf(0)).toEqual([])
      expect(problemsOf(1)).toEqual(['Create writes the checked input: add a “Check the input” step before it'])
      expect(q('[data-steps-problems]')).toBeNull()
    })

    it('replaces the bare return of a blank action with the write, which asks for a check before a create', async () => {
      const id = blank()
      await stepsTab(id)
      await addStep('Write')
      expect(kindsOf()).toEqual(['repository'])
      expect(problemsOf(0)).toEqual(['Create writes the checked input: add a “Check the input” step before it'])
    })

    it('keeps the return of an action that returns a row, as an early return that asks when it should run', async () => {
      await stepsTab('act_publish_post')
      await click(within(2, '[data-step-remove]'))
      await expand(1)
      await selectOption(combo('[data-step-field="if"]'), 'Always')
      expect(kindsOf()).toEqual(['load', 'return'])
      expect(problemsOf(1)).toEqual([])
      await addStep('Write')
      expect(kindsOf()).toEqual(['load', 'return', 'repository'])
      expect(problemsOf(1)).toEqual(['Pick when it returns: always, or when a condition holds'])
      expect(text(combo(fieldOf(1, 'if')))).toBe('When…')
    })

    it('says a write step that is not last is wrong, on its card, and Save waits', async () => {
      await stepsTab()
      await click(within(1, '[data-step-down]'))
      expect(kindsOf()).toEqual(['validate', 'repository', 'assert'])
      expect(problemsOf(1)).toEqual(['A write step must be the last step: the action returns its result'])
      expect(q('[data-step-card="1"]')?.hasAttribute('data-step-invalid')).toBe(true)
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      expect(text(q('[data-steps-blocked]'))).toBe('Fix 1 problem to save.')
      await click(within(2, '[data-step-up]'))
      expect(kindsOf()).toEqual(['validate', 'assert', 'repository'])
      expect(q('[data-steps-unsaved]')).toBeNull()
      expect(q('[data-steps-blocked]')).toBeNull()
    })

    it('moves a step by dragging its grip to the half of another step it is dropped on', async () => {
      await stepsTab()
      await dragStep(0, 2, 'after')
      expect(kindsOf()).toEqual(['assert', 'repository', 'validate'])
      await dragStep(2, 0, 'before')
      expect(kindsOf()).toEqual(['validate', 'assert', 'repository'])
    })

    it('does not drag a step while a save is in flight', async () => {
      const pending = { release: () => {} }
      const handler = () => new Promise((done) => {
        pending.release = () => done({ actionId: 'act_create_post', changed: [] })
      })
      await stepsTab('act_create_post', { action_update: handler })
      await click(within(1, '[data-step-remove]'))
      await save()
      expect(within(0, '[data-step-handle]')?.getAttribute('draggable')).toBe('false')
      pending.release()
      await settle()
      expect(within(0, '[data-step-handle]')?.getAttribute('draggable')).toBe('true')
    })

    it('copies a step right after it, and a copy of a load is named apart', async () => {
      await stepsTab()
      await click(within(1, '[data-step-duplicate]'))
      expect(kindsOf()).toEqual(['validate', 'assert', 'assert', 'repository'])
      expect(summaries()[2]).toBe(summaries()[1])
      expect(within(2, '[data-step-toggle]')?.getAttribute('aria-expanded')).toBe('true')
    })

    it('names the copy of a load apart from the row it loads', async () => {
      await stepsTab('act_publish_post')
      await click(within(0, '[data-step-duplicate]'))
      expect(kindsOf()).toEqual(['load', 'load', 'return', 'repository'])
      expect(inputOf('[data-step-card="1"] [data-step-field="as"]').value).toBe('post2')
    })

    it('removes a step, and saves the steps that are left with one action_update', async () => {
      const { actions } = await stepsTab('act_publish_post')
      await click(within(1, '[data-step-remove]'))
      expect(kindsOf()).toEqual(['load', 'repository'])
      await save()
      expect(updates(actions)).toEqual([{ action: 'act_publish_post', steps: stored('act_publish_post').steps }])
      expect(stored('act_publish_post').steps.map(step => step.kind)).toEqual(['load', 'repository'])
      expect(q('[data-steps-unsaved]')).toBeNull()
      expect(q('[data-steps-error]')).toBeNull()
    })
  })

  describe('the form of each kind', () => {
    it('check: says what it checks', async () => {
      await stepsTab()
      await expand(0)
      expect(text(q('[data-step-form]'))).toBe('Checks the body against the fields of Post: a value that is missing or does not fit is refused.')
    })

    it('refuse: shows the lookup, the error it refuses with and what the error carries, and changes the lookup', async () => {
      const { actions } = await stepsTab()
      await expand(1)
      expect(text(combo('[data-step-field="repository"]'))).toBe('Post')
      expect(text(combo('[data-step-field="op"]'))).toBe('Find by slug')
      expect(text(q('[data-step-arg="slug"] [data-value-source]'))).toBe('Input: slug')
      expect(text(combo('[data-step-field="error"]'))).toBe('slug_taken (409)')
      expect(text(q('[data-step-error-data="slug"] [data-value-source]'))).toBe('Input: slug')
      await selectOption(combo('[data-step-field="op"]'), 'Get by id')
      expect(q('[data-step-arg="slug"]')).toBeNull()
      expect(text(q('[data-step-arg="id"] [data-value-source]'))).toBe('Input: id')
      expect(summaries()[1]).toBe('Refuses with “slug_taken” if a Post with this id already exists')
      await save()
      expect(updates(actions)).toEqual([{ action: 'act_create_post', steps: [{ kind: 'validate' }, { ...stored().steps[1] }, stored().steps[2]] }])
      expect(stored().steps[1]!.unless).toEqual({ repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } })
    })

    it('refuse: adds the error it refuses with inline, which is declared with the steps in one save', async () => {
      const { actions } = await stepsTab()
      await expand(1)
      await selectOption(combo('[data-step-field="error"]'), 'New error…')
      expect(q('[data-step-new-error]')).not.toBeNull()
      await typeInto(q('[data-new-error="type"]'), 'Not Allowed')
      await typeInto(q('[data-new-error="message"]'), 'Not allowed.')
      expect(text(q('[data-new-error-problem]'))).toBe('Use a name like “slug_taken”: lowercase letters, digits and _')
      expect(q('[data-new-error-add]')?.hasAttribute('disabled')).toBe(true)
      // The blog reads the "quotes" REST source: what a call to it fails with is its name, not the action's.
      await typeInto(q('[data-new-error="type"]'), 'timeout')
      expect(text(q('[data-new-error-problem]'))).toBe('“timeout” is what a call to the “quotes” data source fails with: name it another way')
      expect(q('[data-new-error-add]')?.hasAttribute('disabled')).toBe(true)
      await typeInto(q('[data-new-error="type"]'), 'not_allowed')
      await typeInto(q('[data-new-error="status"]'), '403')
      await click(q('[data-new-error-add]'))
      expect(q('[data-step-new-error]')).toBeNull()
      expect(qa('[data-error-row]').map(row => inputOf(`[data-error-row="${row.getAttribute('data-error-row')}"] [data-error-field="type"]`).value)).toEqual(['slug_taken', 'not_allowed'])
      expect(text(combo('[data-step-field="error"]'))).toBe('not_allowed (403)')
      expect(q('[data-step-error-data]')).toBeNull()
      await save()
      expect(updates(actions)).toHaveLength(1)
      const [update] = updates(actions) as Array<{ steps: Array<Record<string, unknown>>, errors: unknown[] }>
      expect(update!.steps[1]).toEqual({ kind: 'assert', unless: { repository: 'repo_post', op: 'findBySlug', args: { slug: { $input: 'slug' } } }, error: 'not_allowed' })
      expect(update!.errors).toEqual([stored().errors[0], { type: 'not_allowed', status: 403, message: 'Not allowed.' }])
      expect(stored().errors.map(error => error.type)).toEqual(['slug_taken', 'not_allowed'])
    })

    it('load: shows the name, the lookup, the error when there is none and what it carries', async () => {
      await stepsTab('act_publish_post')
      await expand(0)
      expect(inputOf('[data-step-field="as"]').value).toBe('post')
      expect(text(combo('[data-step-field="repository"]'))).toBe('Post')
      expect(text(combo('[data-step-field="op"]'))).toBe('Get by id')
      expect(text(q('[data-step-arg="id"] [data-value-source]'))).toBe('Input: id')
      expect(text(combo('[data-step-field="orError"]'))).toBe('post_not_found (404)')
      expect(text(q('[data-step-error-data="id"] [data-value-source]'))).toBe('Input: id')
    })

    it('load: carries on without the row when no error is chosen, and the error\'s values go with it', async () => {
      const { actions } = await stepsTab('act_publish_post')
      await expand(0)
      await selectOption(combo('[data-step-field="orError"]'), 'Carry on without it')
      expect(q('[data-step-error-data]')).toBeNull()
      await save()
      expect(updates(actions)).toEqual([{ action: 'act_publish_post', steps: [{ kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } }, ...stored('act_publish_post').steps.slice(1)] }])
    })

    it('write: shows the collection, what it does, the key, the row and what it sets', async () => {
      await stepsTab('act_publish_post')
      await expand(2)
      expect(text(combo('[data-step-field="repository"]'))).toBe('Post')
      expect(text(combo('[data-step-field="op"]'))).toBe('Update')
      expect(text(q('[data-step-field="id"] [data-value-source]'))).toBe('Input: id')
      expect(text(q('[data-step-field="from"] [data-value-source]'))).toBe('Variable: post')
      expect(qa('[data-step-set]').map(row => row.getAttribute('data-step-set'))).toEqual(['published', 'publishedAt'])
      expect(text(q('[data-step-set="published"] [data-value-literal]'))).toBe('Yes')
      expect(text(q('[data-step-set="publishedAt"] [data-value-source]'))).toBe('Now')
    })

    it('write: sets a field, typed by the field\'s type, and does not set another', async () => {
      const { actions } = await stepsTab('act_publish_post')
      await expand(2)
      await selectOption(combo('[data-step-set="published"] [data-value-literal]'), 'No')
      await click(q('[data-step-set="publishedAt"] [data-step-set-remove]'))
      await menuItem(q('[data-step-set-add]'), 'body')
      await typeInto(q('[data-step-set="body"] [data-value-literal]'), 'Published.')
      await save()
      expect(updates(actions)).toHaveLength(1)
      expect(stored('act_publish_post').steps[2]).toEqual({ kind: 'repository', repository: 'repo_post', op: 'update', id: { $input: 'id' }, from: { $var: 'post' }, set: { published: false, body: 'Published.' } })
    })

    it('write: a field set to a number is a number, and what is not one is said on the card', async () => {
      world.model.modules.blog!.entities.find(entity => entity.id === 'ent_post')!.fields.push({ id: 'fld_views', name: 'views', type: 'integer', default: 0 } as never)
      await stepsTab('act_publish_post')
      await expand(2)
      await menuItem(q('[data-step-set-add]'), 'views')
      expect(inputOf('[data-step-set="views"] [data-value-literal]').value).toBe('0')
      await typeInto(q('[data-step-set="views"] [data-value-literal]'), '12')
      expect(problemsOf(2)).toEqual([])
      await typeInto(q('[data-step-set="views"] [data-value-literal]'), '1.5')
      expect(problemsOf(2)).toEqual(['views must be a whole number'])
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
    })

    it('write: changing the collection\'s operation keeps what still applies', async () => {
      await stepsTab('act_publish_post')
      await expand(2)
      await selectOption(combo('[data-step-field="op"]'), 'Delete')
      expect(q('[data-step-field="from"]')).toBeNull()
      expect(q('[data-step-sets]')).toBeNull()
      expect(text(q('[data-step-field="id"] [data-value-source]'))).toBe('Input: id')
      await selectOption(combo('[data-step-field="op"]'), 'Create')
      expect(q('[data-step-field="id"]')).toBeNull()
      expect(text(q('[data-step-sets]'))).toContain('Nothing is set but the checked input.')
    })

    it('return: runs always or when a condition holds, and returns a row', async () => {
      await stepsTab('act_publish_post')
      await expand(1)
      expect(text(combo('[data-step-field="if"]'))).toBe('When…')
      expect(text(q('[data-step-field="condition"] [data-value-source]'))).toBe('Variable: post.published')
      expect(text(q('[data-step-field="value"] [data-value-source]'))).toBe('Variable: post')
      await selectOption(combo('[data-step-field="if"]'), 'Always')
      expect(q('[data-step-field="condition"]')).toBeNull()
      expect(problemsOf(1)).toEqual(['A return that always runs must be the last step: the steps after it would never run'])
      await selectOption(combo('[data-step-field="if"]'), 'When')
      expect(problemsOf(1)).toEqual(['Pick when it returns: always, or when a condition holds'])
      expect(text(q('[data-step-field="condition"] [data-value-source]'))).toBe('Pick a value')
    })

    it('return: of an action with no output returns nothing', async () => {
      const id = blank()
      await stepsTab(id)
      await expand(0)
      expect(text(combo('[data-step-field="if"]'))).toBe('Always')
      expect(text(q('[data-step-nothing]'))).toBe('Nothing')
      expect(q('[data-step-field="value"]')).toBeNull()
    })
  })

  describe('the values a step can read', () => {
    it('offers the input fields, the rows earlier steps loaded and now, and a value typed by the type of its field', async () => {
      await stepsTab('act_publish_post')
      await expand(1)
      const labels = await optionLabels(combo('[data-step-field="condition"] [data-value-source]'))
      expect(labels).toEqual(['Input: id', 'Variable: post', 'Variable: post.id', 'Variable: post.title', 'Variable: post.slug', 'Variable: post.body', 'Variable: post.published', 'Variable: post.publishedAt', 'Variable: post.createdAt', 'Variable: post.updatedAt'])
      await closeMenus()
    })

    it('offers a value and now to a field, and only rows to the row a write puts back', async () => {
      await stepsTab('act_publish_post')
      await expand(2)
      expect(await optionLabels(combo('[data-step-field="from"] [data-value-source]'))).toEqual(['Variable: post'])
      await closeMenus()
      const labels = await optionLabels(combo('[data-step-set="published"] [data-value-source]'))
      expect(labels.slice(0, 2)).toEqual(['Input: id', 'Variable: post'])
      expect(labels.slice(-3)).toEqual(['Now', 'Empty', 'A value…'])
      await closeMenus()
    })

    it('does not offer a row to the step before the one that loads it, nor a row loaded by a later step', async () => {
      await stepsTab('act_publish_post')
      // Added after the load (and before the repository step, which stays last): it sees the row. The load itself sees none.
      await addStep('Load a row')
      expect(kindsOf()).toEqual(['load', 'return', 'load', 'repository'])
      expect(inputOf('[data-step-card="2"] [data-step-field="as"]').value).toBe('post2')
      await show(0)
      const first = await optionLabels(combo('[data-step-card="0"] [data-step-arg="id"] [data-value-source]'))
      expect(first).toEqual(['Input: id', 'Now', 'Empty', 'A value…'])
      await closeMenus()
      const second = await optionLabels(combo('[data-step-card="2"] [data-step-arg="id"] [data-value-source]'))
      expect(second.filter(label => label.startsWith('Variable')).slice(0, 2)).toEqual(['Variable: post', 'Variable: post.id'])
      expect(second).not.toContain('Variable: post2')
      await closeMenus()
    })

    it('keeps a value the form does not edit as it is, and shows it', async () => {
      await stepsTab()
      await expand(2)
      expect(text(q('[data-step-set="publishedAt"] [data-value-source]'))).toBe('Computed value')
      expect(q('[data-step-set="publishedAt"] [data-value-computed]')?.textContent).toContain('"then":{"$now":true}')
      expect(q('[data-steps-unsaved]')).toBeNull()
    })
  })

  describe('what the editor says before the module does', () => {
    it('says a row no step loads, on the steps that read it, and blocks Save', async () => {
      await stepsTab('act_publish_post')
      await click(within(0, '[data-step-remove]'))
      expect(kindsOf()).toEqual(['return', 'repository'])
      expect(problemsOf(0)).toEqual(['“post” is not loaded by any step'])
      expect(problemsOf(1)).toEqual(['“post” is not loaded by any step'])
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      expect(text(q('[data-steps-blocked]'))).toBe('Fix 2 problems to save.')
      await click(q('[data-steps-discard]'))
      expect(qa('[data-step-problem]')).toEqual([])
      expect(q('[data-steps-unsaved]')).toBeNull()
    })

    it('renames a row in the steps after it, which read it by the new name', async () => {
      const { actions } = await stepsTab('act_publish_post')
      await typeInto(q('[data-step-field="as"]'), 'article')
      expect(qa('[data-step-problem]')).toEqual([])
      await expand(2)
      expect(text(q('[data-step-field="from"] [data-value-source]'))).toBe('Variable: article')
      expect(summaries()[0]).toBe('“article”: a Post by id, refusing with “post_not_found” if there is none')
      await expand(1)
      expect(text(q('[data-step-field="condition"] [data-value-source]'))).toBe('Variable: article.published')
      expect(text(q('[data-step-field="value"] [data-value-source]'))).toBe('Variable: article')
      await save()
      expect(updates(actions)).toHaveLength(1)
      expect(stored('act_publish_post').steps[0]).toMatchObject({ kind: 'load', as: 'article' })
      expect(stored('act_publish_post').steps[2]).toMatchObject({ from: { $var: 'article' } })
      expect(stored('act_publish_post').steps[1]).toMatchObject({ if: { $var: 'article.published' }, value: { $var: 'article' } })
    })

    describe('a load named like another, `post` and `posts`', () => {
      const twoLoads = () => {
        stored('act_publish_post').steps = [
          { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
          { kind: 'load', as: 'posts', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
          { kind: 'return', if: { $var: 'post.published' }, value: { $var: 'post' } },
          { kind: 'repository', repository: 'repo_post', op: 'update', id: { $input: 'id' }, from: { $var: 'posts' } }
        ] as never
      }
      /** A keystroke: the field's text changes and the input event fires; the change event (the commit) does not. */
      const keystroke = async (selector: string, value: string) => {
        const input = inputOf(selector)
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
      }
      const readsOf = async (index: number, field: string) => {
        await expand(index)
        return text(q(`[data-step-card="${index}"] [data-step-field="${field}"] [data-value-source]`))
      }

      it('renames the later row\'s readers when the name is committed, not as it is typed through the first row\'s name', async () => {
        twoLoads()
        await stepsTab('act_publish_post')
        await expand(1)
        for (const name of ['p', 'po', 'pos', 'post', 'posts2', 'item']) await keystroke(fieldOf(1, 'as'), name)
        // Nothing was committed: the rows read what they read.
        expect(await readsOf(3, 'from')).toBe('Variable: posts')
        expect(await readsOf(2, 'value')).toBe('Variable: post')
        await expand(1)
        await typeInto(q(fieldOf(1, 'as')), 'items')
        expect(await readsOf(3, 'from')).toBe('Variable: items')
        expect(await readsOf(2, 'value')).toBe('Variable: post')
        expect(await readsOf(2, 'condition')).toBe('Variable: post.published')
        expect(qa('[data-step-problem]')).toEqual([])
      })

      it('leaves the readers alone when the committed name is another row\'s, and says it is a duplicate', async () => {
        twoLoads()
        await stepsTab('act_publish_post')
        await expand(1)
        await typeInto(q(fieldOf(1, 'as')), 'post')
        expect(problemsOf(1)).toEqual(['“post” is the name of an earlier row: pick another'])
        expect(await readsOf(3, 'from')).toBe('Variable: posts')
        expect(await readsOf(2, 'value')).toBe('Variable: post')
        expect(problemsOf(3)).toEqual(['“posts” is not loaded by any step'])
        expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      })

      it('leaves the readers alone when the committed name is empty', async () => {
        twoLoads()
        await stepsTab('act_publish_post')
        await expand(1)
        await typeInto(q(fieldOf(1, 'as')), '')
        expect(await readsOf(3, 'from')).toBe('Variable: posts')
        expect(problemsOf(1)).toContain('Name the loaded row')
      })
    })

    it('says the step that loads a row comes after the one that reads it', async () => {
      await stepsTab('act_publish_post')
      await click(within(0, '[data-step-down]'))
      expect(kindsOf()).toEqual(['return', 'load', 'repository'])
      expect(problemsOf(0)).toEqual(['Reads “post” before it is loaded: the step that loads it comes after (step 2)'])
    })

    it('says an error a step raises is not declared, and a row with no name', async () => {
      await stepsTab()
      await click(q('[data-error-row="0"] [data-error-remove]'))
      expect(problemsOf(1)).toEqual(['The error “slug_taken” is not declared: add it below, or pick another'])
      await click(q('[data-error-add]'))
      await typeInto(q('[data-error-row="0"] [data-error-field="type"]'), 'slug_taken')
      expect(problemsOf(1)).toEqual([])
      expect(qa('[data-error-row="0"] [data-error-problem]').map(text)).toEqual(['Add the message the client gets'])
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
    })

    it('renames an error in the steps that raise it', async () => {
      const { actions } = await stepsTab()
      await typeInto(q('[data-error-row="0"] [data-error-field="type"]'), 'slug_in_use')
      expect(problemsOf(1)).toEqual([])
      await save()
      expect(updates(actions)).toHaveLength(1)
      expect(stored().errors[0]!.type).toBe('slug_in_use')
      expect(stored().steps[1]!.error).toBe('slug_in_use')
    })

    it('says a required field that is empty on the card that has it', async () => {
      const id = blank()
      await stepsTab(id)
      await addStep('Load a row')
      await typeInto(q('[data-step-field="as"]'), '')
      expect(problemsOf(0)).toEqual(['Name the loaded row'])
      expect(stepCard(0)?.hasAttribute('data-step-invalid')).toBe(true)
      expect(stepCard(1)?.hasAttribute('data-step-invalid')).toBe(false)
    })

    it('says the one return of an action that has no write step may not run', async () => {
      const id = blank()
      await stepsTab(id)
      await expand(0)
      expect(q('[data-steps-problems]')).toBeNull()
      await selectOption(combo('[data-step-field="if"]'), 'When')
      expect(problemsOf(0)).toEqual(['Pick when it returns: always, or when a condition holds'])
      expect(text(q('[data-steps-problems]'))).toBe('An action needs a Write step (create, update or delete), or a last Return step that always runs, to do its work')
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      await selectOption(combo('[data-step-field="condition"] [data-value-source]'), 'Input: published')
      expect(problemsOf(0)).toEqual([])
      // A condition that holds is not an answer on every run: the module wants the always-return or a repository step.
      expect(text(q('[data-steps-problems]'))).toContain('An action needs a Write step')
    })

    it('says a create with nothing that checks the input before it', async () => {
      const id = blank()
      await stepsTab(id)
      await addStep('Write')
      expect(kindsOf()).toEqual(['repository'])
      expect(problemsOf(0)).toEqual(['Create writes the checked input: add a “Check the input” step before it'])
      await addStep('Check the input')
      expect(kindsOf()).toEqual(['validate', 'repository'])
      expect(problemsOf(1)).toEqual([])
    })
  })

  describe('the errors', () => {
    it('edits an error\'s status and message, and saves them without the steps', async () => {
      const { actions } = await stepsTab()
      await typeInto(q('[data-error-row="0"] [data-error-field="status"]'), '422')
      await typeInto(q('[data-error-row="0"] [data-error-field="message"]'), 'The slug "{slug}" is taken.')
      await save()
      expect(updates(actions)).toEqual([{ action: 'act_create_post', errors: [{ type: 'slug_taken', status: 422, message: 'The slug "{slug}" is taken.', data: { slug: 'text' } }] }])
      expect(stored().errors[0]).toEqual({ type: 'slug_taken', status: 422, message: 'The slug "{slug}" is taken.', data: { slug: 'text' } })
    })

    it('edits what an error carries, and the step that raises it asks for a value of it before Save', async () => {
      await stepsTab()
      await click(q('[data-error-row="0"] [data-error-data-add]'))
      await typeInto(q('[data-error-row="0"] [data-error-data="1"] [data-error-data-name]'), 'count')
      await selectOption(combo('[data-error-row="0"] [data-error-data="1"] [data-error-data-type]'), 'Integer')
      expect(problemsOf(1)).toEqual(['Give the count the error carries'])
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      await click(q('[data-error-row="0"] [data-error-data="1"] [data-error-data-remove]'))
      expect(problemsOf(1)).toEqual([])
    })

    it('says a status that is not an HTTP error, a name taken, and a name that is not a name', async () => {
      await stepsTab()
      await click(q('[data-error-add]'))
      await typeInto(q('[data-error-row="1"] [data-error-field="type"]'), 'slug_taken')
      await typeInto(q('[data-error-row="1"] [data-error-field="status"]'), '200')
      expect(qa('[data-error-row="1"] [data-error-problem]').map(text)).toEqual(['“slug_taken” is already declared', 'The status is an HTTP error code, from 400 to 599', 'Add the message the client gets'])
      await typeInto(q('[data-error-row="1"] [data-error-field="type"]'), 'Slug Taken')
      expect(text(q('[data-error-row="1"] [data-error-problem]'))).toBe('Use a name like “slug_taken”: lowercase letters, digits and _')
      await typeInto(q('[data-error-row="1"] [data-error-field="type"]'), 'not_found')
      expect(text(q('[data-error-row="1"] [data-error-problem]'))).toBe('“not_found” is what a call to the “quotes” data source fails with: name it another way')
    })
  })

  describe('saving', () => {
    it('adds a load and an update to a blank action, saves them with one action_update, and the JSON tab has them', async () => {
      const id = blank()
      const { actions } = await stepsTab(id)
      await click(within(0, '[data-step-remove]'))
      expect(kindsOf()).toEqual([])
      await addStep('Load a row')
      await addStep('Write')
      await selectOption(combo('[data-step-card="1"] [data-step-field="op"]'), 'Update')
      expect(kindsOf()).toEqual(['load', 'repository'])
      expect(text(q('[data-step-card="1"] [data-step-field="from"] [data-value-source]'))).toBe('Variable: post')
      expect(qa('[data-step-problem]')).toEqual([])
      await save()
      expect(updates(actions)).toEqual([{ action: id, steps: [
        { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
        { kind: 'repository', repository: 'repo_post', op: 'update', id: { $input: 'id' }, from: { $var: 'post' } }
      ] }])
      expect(q('[data-steps-error]')).toBeNull()
      expect(q('[data-steps-unsaved]')).toBeNull()
      // The module wrote them (the JSON tab shows the file: the e2e reads it there).
      expect(stored(id).steps.map(step => step.kind)).toEqual(['load', 'repository'])
    })

    it('keeps the open cards open after a save', async () => {
      await stepsTab('act_publish_post')
      await expand(2)
      await click(within(1, '[data-step-remove]'))
      await save()
      expect(kindsOf()).toEqual(['load', 'repository'])
      expect(within(1, '[data-step-toggle]')?.getAttribute('aria-expanded')).toBe('true')
    })

    it('shows what the module refused under the footer, keeps the draft, and marks the step it names', async () => {
      const { actions } = await stepsTab('act_create_post', { action_update: () => new Failure(422, 'invalid', 'steps.2: this action returns nothing (it has no output), so the return\'s value is { "$var": "undefined" }') })
      await click(within(1, '[data-step-duplicate]'))
      await save()
      expect(updates(actions)).toHaveLength(1)
      expect(text(q('[data-steps-error]'))).toContain('steps.2: this action returns nothing')
      expect(q('[data-steps-footer]')?.contains(q('[data-steps-error]'))).toBe(true)
      expect(q('[data-testid="error-banner"]')).toBeNull()
      expect(kindsOf()).toEqual(['validate', 'assert', 'assert', 'repository'])
      expect(qa('[data-step-refused]').map(entry => entry.getAttribute('data-step-card'))).toEqual(['1'])
      // Editing again clears the mark with the message.
      await click(within(3, '[data-step-up]'))
      expect(q('[data-steps-error]')).toBeNull()
      expect(qa('[data-step-refused]')).toEqual([])
    })

    it('marks the step and the error a model problem names, counting from 0 as the model does', async () => {
      await stepsTab('act_create_post', { action_update: () => new Failure(422, 'invalid', 'The edit would leave the model with problems: steps.1: bad (.bildr/modules/blog/actions/create-post.json)') })
      await click(within(1, '[data-step-duplicate]'))
      await save()
      expect(qa('[data-step-refused]').map(entry => entry.getAttribute('data-step-card'))).toEqual(['1'])
    })

    it('marks the steps and the errors a refusal quotes by name', async () => {
      await stepsTab('act_create_post', { action_update: () => new Failure(422, 'invalid', 'The edit would leave a model the generator can\'t build: act_create_post: the error "slug_taken" is not declared in the action\'s errors') })
      await click(within(1, '[data-step-duplicate]'))
      await save()
      expect(qa('[data-step-refused]').map(entry => entry.getAttribute('data-step-card'))).toEqual(['1', '2'])
      expect(q('[data-error-row="0"]')?.hasAttribute('data-error-refused')).toBe(true)
    })

    it('saves an early return before the one that always runs, which the module takes', async () => {
      const id = blank()
      const { actions } = await stepsTab(id)
      await addStep('Return')
      expect(kindsOf()).toEqual(['return', 'return'])
      expect(problemsOf(0)).toEqual(['Pick when it returns: always, or when a condition holds'])
      await selectOption(combo('[data-step-card="0"] [data-step-field="condition"] [data-value-source]'), 'Input: published')
      expect(qa('[data-step-problem]')).toEqual([])
      await save()
      expect(updates(actions)).toEqual([{ action: id, steps: [{ kind: 'return', if: { $input: 'published' }, value: { $var: 'undefined' } }, { kind: 'return', if: true, value: { $var: 'undefined' } }] }])
      expect(q('[data-steps-error]')).toBeNull()
      expect(stored(id).steps).toHaveLength(2)
    })
  })

  describe('unsaved edits', () => {
    const DISCARD = 'Discard unsaved changes to Create post?'

    it('asks before another tab or item is shown, keeps the draft when it is declined, and discards it when it is confirmed', async () => {
      await stepsTab()
      await click(within(1, '[data-step-remove]'))
      await click(tab('used'))
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-cancel]'))
      expect(activeTab()).toBe('steps')
      expect(kindsOf()).toEqual(['validate', 'repository'])
      await click(treeItem('publishPost'))
      expect(confirmText()).toContain(DISCARD)
      await click(q('[data-confirm-ok]'))
      expect(text(q('[data-data-title] h2'))).toBe('Publish post')
      await click(treeItem('createPost'))
      await click(tab('steps'))
      expect(kindsOf()).toEqual(['validate', 'assert', 'repository'])
    })

    it('does not ask when nothing changed, after a discard, or after a save', async () => {
      await stepsTab()
      await click(tab('used'))
      expect(q('[data-confirm]')).toBeNull()
      await click(tab('steps'))
      await click(within(1, '[data-step-remove]'))
      await click(q('[data-steps-discard]'))
      expect(kindsOf()).toEqual(['validate', 'assert', 'repository'])
      expect(q('[data-steps-unsaved]')).toBeNull()
      await click(tab('used'))
      expect(q('[data-confirm]')).toBeNull()
      await click(tab('steps'))
      await click(within(1, '[data-step-remove]'))
      await click(q('[data-steps-save]'))
      await click(treeItem('publishPost'))
      expect(q('[data-confirm]')).toBeNull()
    })

    it('asks for a draft the editor says is wrong, too', async () => {
      await stepsTab()
      await click(within(1, '[data-step-down]'))
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      await click(tab('used'))
      expect(confirmText()).toContain(DISCARD)
    })
  })

  describe('the action changing elsewhere while its steps are edited', () => {
    let version = 200
    const FILE = '.bildr/modules/blog/actions/create-post.json'
    /** Another editor, an undo or a JSON-tab save: the model has a different action, and the editor reads it. */
    const outside = async (change: (action: ReturnType<typeof stored>) => void) => {
      change(stored())
      FakeEventSource.instances.at(-1)!.send({ type: 'model', version: version++, files: [FILE], source: 'disk' })
      await settle()
    }
    const notice = () => q('[data-steps-changed]')

    it('says so, leaves the edits, and blocks Save until the user chooses', async () => {
      const { actions } = await stepsTab()
      await click(within(1, '[data-step-remove]'))
      await outside((action) => {
        action.errors[0]!.message = 'Taken elsewhere.'
      })
      expect(text(notice())).toContain('This action changed since you started editing')
      expect(kindsOf()).toEqual(['validate', 'repository'])
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(true)
      await save()
      expect(updates(actions)).toEqual([])
    })

    it('shows no notice while nothing was edited: the form just follows the model', async () => {
      await stepsTab()
      await outside((action) => {
        action.steps.splice(0, 1)
      })
      expect(notice()).toBeNull()
      expect(kindsOf()).toEqual(['assert', 'repository'])
    })

    it('does not take what Overview edits for a change of the steps', async () => {
      await stepsTab()
      await click(within(1, '[data-step-remove]'))
      await outside((action) => {
        action.label = 'Add post'
      })
      expect(notice()).toBeNull()
      expect(kindsOf()).toEqual(['validate', 'repository'])
    })

    it('loads the new version over the edits on request', async () => {
      const { actions } = await stepsTab()
      await click(within(1, '[data-step-remove]'))
      await outside((action) => {
        action.errors[0]!.message = 'Taken elsewhere.'
      })
      await click(q('[data-steps-load-new]'))
      expect(notice()).toBeNull()
      expect(kindsOf()).toEqual(['validate', 'assert', 'repository'])
      expect(inputOf('[data-error-row="0"] [data-error-field="message"]').value).toBe('Taken elsewhere.')
      expect(q('[data-steps-unsaved]')).toBeNull()
      expect(updates(actions)).toEqual([])
    })

    it('keeps the edits on request, and Save sends only the part the user touched', async () => {
      const { actions } = await stepsTab()
      await click(within(1, '[data-step-remove]'))
      await outside((action) => {
        action.errors[0]!.message = 'Taken elsewhere.'
      })
      await click(q('[data-steps-keep-mine]'))
      expect(notice()).toBeNull()
      expect(kindsOf()).toEqual(['validate', 'repository'])
      expect(inputOf('[data-error-row="0"] [data-error-field="message"]').value).toBe('Taken elsewhere.')
      await save()
      expect(updates(actions)).toEqual([{ action: 'act_create_post', steps: stored().steps }])
      expect(stored().errors[0]!.message).toBe('Taken elsewhere.')
      expect(stored().steps.map(step => step.kind)).toEqual(['validate', 'repository'])
    })
  })

  describe('what is said in words a person reads', () => {
    it('says a refuse as "Refuse if", labels each argument and says what the error carries', async () => {
      await stepsTab()
      await expand(1)
      expect(text(q('[data-step-form]'))).toContain('Refuse if a row is found')
      expect(text(q('[data-step-form]'))).not.toContain('The action refuses when')
      const rows = qa('[data-step-form] [data-form-row]').map(row => text(row.querySelector('label, [data-form-label]')))
      expect(rows).toEqual(['Collection', 'Look up', 'Slug', 'Refuse with', 'Slug'])
    })

    it('calls the write kind Write: in the menu, on the card, in the summary and in the form', async () => {
      await stepsTab()
      expect(text(within(2, '[data-step-label]'))).toBe('Write')
      expect(text(within(2, '[data-step-summary]'))).toBe('Creates a Post')
      await expand(2)
      expect(qa('[data-step-form] [data-form-row]').map(row => text(row.querySelector('label, [data-form-label]')))).toEqual(['Collection', 'Write'])
      expect(await menuLabels(q('[data-step-add]'))).toContain('Write')
      await closeMenus()
    })

    it('shows the hint of each kind in the Add step menu', async () => {
      await stepsTab()
      await menuLabels(q('[data-step-add]'))
      const items = qa('[role^="menuitem"]').slice(0, 5)
      expect(items.map(item => item.querySelector('[data-slot="itemLabel"]')?.textContent?.trim())).toEqual(['Check the input', 'Refuse if found', 'Load a row', 'Write', 'Return'])
      expect(items.map(item => item.querySelector('[data-slot="itemDescription"]')?.textContent?.trim())).toEqual([
        'Checks the body against the collection\'s fields',
        'Stops with an error if a row is found',
        'Reads a row, and may refuse if there is none',
        'Creates, updates or deletes a row: the last step',
        'Ends the action, always or when a condition holds'
      ])
      await closeMenus()
    })

    it('says a load carries on without the row as "Carry on without it", and the name of a reserved word as one bildr uses', async () => {
      await stepsTab('act_publish_post')
      await selectOption(combo('[data-step-field="orError"]'), 'Carry on without it')
      expect(text(combo('[data-step-field="orError"]'))).toBe('Carry on without it')
      await typeInto(q('[data-step-field="as"]'), 'input')
      expect(problemsOf(0)).toEqual(['“input” is a name bildr uses: pick another'])
    })

    it('adds a field a write sets from an "Add a field" button under the list, which offers the fields not set yet', async () => {
      await stepsTab('act_publish_post')
      await expand(2)
      const add = q('[data-step-set-add]')!
      expect(text(add)).toBe('Add a field')
      const list = q('[data-step-sets]')!
      expect(list.lastElementChild?.contains(add)).toBe(true)
      expect(await menuLabels(add)).toEqual(['title', 'slug', 'body'])
      await closeMenus()
    })

    it('has no repository, use-case or generated code in what the tab says', async () => {
      const id = blank()
      await stepsTab(id)
      await addStep('Load a row')
      await addStep('Write')
      await expand(0)
      const page = document.body.cloneNode(true) as HTMLElement
      const said = [page.textContent ?? '', ...[...page.querySelectorAll('[title], [aria-label], [placeholder]')].flatMap(element => ['title', 'aria-label', 'placeholder'].map(name => element.getAttribute(name) ?? ''))].join(' | ')
      expect(said).not.toMatch(/repository|use-case|generated code/i)
    })
  })

  describe('what is open to start with, and the way to the errors', () => {
    it('opens only the first card, for each action it shows', async () => {
      await stepsTab('act_publish_post')
      expect(opened()).toEqual([0])
      await click(treeItem('createPost'))
      await click(tab('steps'))
      expect(opened()).toEqual([0])
    })

    it('has an "Errors (n)" link near the top that scrolls to the errors', async () => {
      const scrolled: Element[] = []
      const original = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this)
      }
      try {
        await stepsTab()
        expect(text(q('[data-errors-jump]'))).toBe('Errors (1)')
        await click(q('[data-errors-jump]'))
        expect(scrolled).toEqual([q('[data-action-errors]')])
        await click(q('[data-error-add]'))
        expect(text(q('[data-errors-jump]'))).toBe('Errors (2)')
      } finally {
        Element.prototype.scrollIntoView = original
      }
    })
  })

  describe('a refusal that names no step', () => {
    /** The loader\'s own message about the list as a whole: it quotes "repository", "return" and "if", which are words of the model. */
    const NO_INDEX = (() => {
      const outcome = applyEdit(serializeModel(world.model), 'action_update', { action: 'act_create_post', steps: [{ kind: 'validate' }] })
      return outcome.ok ? '' : outcome.message
    })()

    it('is the message the loader gives, as the test needs it', () => {
      expect(NO_INDEX).toContain('"repository"')
      expect(NO_INDEX).toContain('"return"')
      expect(NO_INDEX).not.toMatch(/steps\.\d/)
    })

    it('marks no card and no error, and shows the message at the top, with the draft kept', async () => {
      await stepsTab('act_create_post', { action_update: () => new Failure(422, 'invalid', NO_INDEX) })
      await click(within(1, '[data-step-duplicate]'))
      await save()
      expect(qa('[data-step-refused]')).toEqual([])
      expect(qa('[data-error-refused]')).toEqual([])
      expect(qa('[data-step-card][data-step-invalid]')).toEqual([])
      expect(text(q('[data-steps-refusal]'))).toContain('An action needs a "repository" step')
      expect(kindsOf()).toEqual(['validate', 'assert', 'assert', 'repository'])
      // Editing again clears it, with the message.
      await click(within(3, '[data-step-up]'))
      expect(q('[data-steps-refusal]')).toBeNull()
    })

    it('does not mark the steps a common field name matches, and shows the refusal at the top', async () => {
      await stepsTab('act_publish_post', { action_update: () => new Failure(422, 'invalid', 'input: "id" must be text') })
      await click(within(0, '[data-step-duplicate]'))
      await save()
      expect(qa('[data-step-refused]')).toEqual([])
      expect(text(q('[data-steps-refusal]'))).toBe('input: "id" must be text')
    })

    it('does not show at the top a refusal that marks a step', async () => {
      await stepsTab('act_create_post', { action_update: () => new Failure(422, 'invalid', 'steps.2: this action returns nothing') })
      await click(within(1, '[data-step-duplicate]'))
      await save()
      expect(qa('[data-step-refused]')).toHaveLength(1)
      expect(q('[data-steps-refusal]')).toBeNull()
    })
  })

  describe('steps the editor does not model', () => {
    /** A list that mixes what the form edits with what it keeps: a call, a custom step, a computed value and keys of its own. */
    const MIXED = [
      { kind: 'validate' },
      { kind: 'call', service: 'mail', template: 'welcome', args: { to: { $input: 'slug' }, cc: [1, 2, { x: null }] }, retry: { times: 2, backoff: [1, 2, 4] } },
      { kind: 'assert', unless: { repository: 'repo_post', op: 'findBySlug', args: { slug: { $input: 'slug' } } }, error: 'slug_taken', errorData: { slug: { $input: 'slug' } }, note: 'kept', ttl: 5 },
      { kind: 'custom', code: 'audit(input)', imports: ['audit'], meta: { b: 1, a: 2 } },
      { kind: 'repository', repository: 'repo_post', op: 'create', set: { title: 'Untitled', publishedAt: { if: { $input: 'published' }, then: { $now: true }, else: null } }, trace: { id: 1, tags: ['x'] } }
    ]

    it('sends them, and stores them, byte for byte when a sibling field is edited', async () => {
      stored().steps = structuredClone(MIXED) as never
      const original = JSON.stringify(MIXED)
      // The module refuses a call it cannot generate yet: this one keeps what it is sent, to see what the editor sends.
      const keep = (input: Record<string, unknown>) => {
        stored().steps = structuredClone(input.steps) as never
        return { actionId: 'act_create_post', changed: [] }
      }
      const { actions } = await stepsTab('act_create_post', { action_update: keep })
      expect(kindsOf()).toEqual(['validate', 'call', 'assert', 'custom', 'repository'])
      expect(qa('[data-step-not-generated]')).toHaveLength(2)
      expect(qa('[data-step-problem]')).toEqual([])
      await expand(4)
      await typeInto(q('[data-step-set="title"] [data-value-literal]'), 'Draft')
      expect(q('[data-steps-save]')?.hasAttribute('disabled')).toBe(false)
      await save()
      const expected = structuredClone(MIXED)
      ;(expected[4]!.set as Record<string, unknown>).title = 'Draft'
      expect(updates(actions)).toHaveLength(1)
      const [sent] = updates(actions) as Array<{ steps: unknown[] }>
      expect(JSON.stringify(sent!.steps)).toBe(JSON.stringify(expected))
      expect(JSON.stringify(stored().steps)).toBe(JSON.stringify(expected))
      // Everything but the edited field is what was stored.
      expect(JSON.stringify(sent!.steps.slice(0, 4))).toBe(JSON.stringify(JSON.parse(original).slice(0, 4)))
    })

    it('sends a step the form edits with the keys it does not know, in the order they were stored', async () => {
      stored().steps = structuredClone(MIXED) as never
      const keep = (input: Record<string, unknown>) => {
        stored().steps = structuredClone(input.steps) as never
        return { actionId: 'act_create_post', changed: [] }
      }
      const { actions } = await stepsTab('act_create_post', { action_update: keep })
      await expand(2)
      await selectOption(combo('[data-step-field="op"]'), 'Get by id')
      await save()
      const [sent] = updates(actions) as Array<{ steps: Array<Record<string, unknown>> }>
      expect(sent!.steps[2]).toEqual({ ...MIXED[2], unless: { repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } } })
      expect(Object.keys(sent!.steps[2]!)).toEqual(Object.keys(MIXED[2]!))
    })
  })

  describe('while a save is in flight', () => {
    /** An `action_update` that answers when the test lets it. */
    const held = () => {
      const pending: { release: () => void } = { release: () => {} }
      const handler = () => new Promise((done) => {
        pending.release = () => done({ actionId: 'act_create_post', changed: [] })
      })
      return { handler, pending }
    }

    it('disables the form\'s controls until the answer comes, and enables them again', async () => {
      const { handler, pending } = held()
      await stepsTab('act_create_post', { action_update: handler })
      await expand(1)
      await click(within(0, '[data-step-duplicate]'))
      const controls = () => [must('[data-step-add]'), must('[data-step-card="1"] [data-step-remove]'), must('[data-error-add]'), inputOf('[data-error-row="0"] [data-error-field="message"]'), combo(fieldOf(2, 'op'))]
      for (const control of controls()) expect(control.matches(':disabled'), `${control.outerHTML.slice(0, 60)} before`).toBe(false)
      await save()
      for (const control of controls()) expect(control.matches(':disabled'), `${control.outerHTML.slice(0, 60)} while saving`).toBe(true)
      expect(q('[data-steps-discard]')?.hasAttribute('disabled')).toBe(true)
      pending.release()
      await settle()
      for (const control of controls()) expect(control.matches(':disabled'), `${control.outerHTML.slice(0, 60)} after`).toBe(false)
    })

    it('ignores a drop while it is saving, and does not take a step dragged over it', async () => {
      const { handler, pending } = held()
      await stepsTab('act_create_post', { action_update: handler })
      await click(within(1, '[data-step-remove]'))
      expect(kindsOf()).toEqual(['validate', 'repository'])
      within(0, '[data-step-handle]')!.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: { setData() {}, setDragImage() {}, effectAllowed: '' } }))
      const target = stepCard(1)!.parentElement!
      target.getBoundingClientRect = () => ({ top: 0, height: 36, bottom: 36, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} })
      await save()
      const over = Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { clientY: 30 })
      target.dispatchEvent(over)
      expect(over.defaultPrevented).toBe(false)
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      target.dispatchEvent(drop)
      await settle()
      expect(kindsOf()).toEqual(['validate', 'repository'])
      pending.release()
      await settle()
    })

    it('leaves a control outside the form enabled: the tree\'s "+" and the tab strip', async () => {
      const { handler, pending } = held()
      await stepsTab('act_create_post', { action_update: handler })
      await click(within(1, '[data-step-remove]'))
      const outside = () => [must('[data-synced-add]'), tab('json')!, tab('overview')!]
      for (const control of outside()) expect(control.matches(':disabled'), `${control.outerHTML.slice(0, 60)} before`).toBe(false)
      await save()
      expect(must('[data-step-add]').matches(':disabled')).toBe(true)
      for (const control of outside()) expect(control.matches(':disabled'), `${control.outerHTML.slice(0, 60)} while saving`).toBe(false)
      pending.release()
      await settle()
    })

    it('cannot be edited by a key or a click while it is saving: what the steps hold is what was sent', async () => {
      const { handler, pending } = held()
      const { actions } = await stepsTab('act_create_post', { action_update: handler })
      await click(within(1, '[data-step-remove]'))
      await save()
      await click(within(0, '[data-step-remove]'))
      expect(kindsOf()).toEqual(['validate', 'repository'])
      pending.release()
      await settle()
      expect(updates(actions)).toHaveLength(1)
    })
  })
})
