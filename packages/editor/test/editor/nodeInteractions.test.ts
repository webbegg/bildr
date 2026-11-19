import { describe, expect, it } from 'vitest'
import { Failure, click, settle, typeInto } from '../helpers.ts'
import { byLabel, combo, find, indexPage, menuItem, must, open, optionLabels, postCard, sectionAdd, select, selectOption, setupHarness, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'
import { interactionModule } from './dataKit.ts'

/**
 * The inspector's Interactions on any node (B3, S2), mounted as the Design screen over the mocked actions, whose
 * `node_interaction_*` edits are the module's own (`interactionModule`): a rule the editor and the module disagree on shows as a
 * refusal here, not as a test that passes against a copy. The blog fixture's checkbox `n_toggle` sets the state `preferences` on
 * change; its detail page's button `n_publish` runs an action and shows a message when it worked.
 */

setupHarness()

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const section = () => q('[data-node-interactions]')
const rowTexts = () => qa('[data-node-interactions] [data-node-interaction-toggle]').map(row => text(row))
const calls = (actions: Awaited<ReturnType<typeof open>>['actions'], name: string) => actions.named(name).map(call => call.input)

/** A Button on the index page's header, which no interaction has yet. */
const addButton = (id = 'n_open') => {
  const head = indexPage().root.children!.find(node => node.id === 'n_head')!
  head.children!.push({ id, type: 'Button', props: { text: 'Open' } })
  return id
}

const mounted = (file: string, extra: Handlers = {}) => open({ ...interactionModule(), ...extra }, file)
const rowButton = (index = 0) => must(`[data-node-interaction="${index}"] button[aria-label^="Edit"]`)
const step = (index: number) => must(`[data-step="${index}"]`)
/** Opens the steps of the row at `index`, under it. */
const openRow = async (index = 0) => {
  await click(rowButton(index))
  return must('[data-node-interaction-fields]')
}
/** Picks `label` in the select found by `selector`, in the steps. */
const choose = (selector: string, label: string) => selectOption(combo(selector), label)
const addStep = async (label: string) => menuItem(must('[data-interaction-add-step]'), label)
const fieldValue = (selector: string) => (must(selector).querySelector('input') ?? must(selector) as HTMLInputElement).value
/** Picks `event` in the "+" of the Interactions section. */
const pickEvent = async (event: string) => {
  sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  qa('[role^="menuitem"]').find(item => text(item) === event)!.click()
  await settle()
}
const titleInput = (index = 0) => must(`[data-step="${index}"] [data-step-title] input, [data-step="${index}"] input[data-step-title]`)
const pageNode = (file: string, id: string) => find(world.model.modules.blog!.pages.find(page => page.id === file)!.root, id)!

describe('which nodes show Interactions', () => {
  it('shows a Button, a Checkbox and a Form the section with a + for the events they take', async () => {
    addButton()
    await mounted('pg_index')
    await select('n_open')
    expect(section()).not.toBeNull()
    expect(q('[data-node-interactions] [data-section-action="add"]')).not.toBeNull()
    await select('n_toggle')
    expect(q('[data-node-interactions] [data-section-action="add"]')).not.toBeNull()
    expect(rowTexts()).toHaveLength(1)
  })

  it('shows a Form its section', async () => {
    await mounted('pg_new_post')
    await select('n_form')
    expect(q('[data-node-interactions] [data-section-action="add"]')).not.toBeNull()
  })

  it('hides the section on any other node: it can\'t react to events, and a note there would only be noise', async () => {
    await mounted('pg_index')
    for (const id of ['n_h1', 'n_head', 'n_list', 'n_page']) {
      await select(id)
      expect(section(), id).toBeNull()
      expect(q('[data-interactions-note]'), id).toBeNull()
    }
  })

  it('shows a component\'s button the section, apart from the component\'s own variant changes, which keep their section, and the card none', async () => {
    postCard().root.children!.push({ id: 'n_card_button', type: 'Button', props: { text: 'Go' } })
    await mounted('cmp_post_card')
    await select('n_card')
    expect(qa('[data-style-section="Interactions"]')).toHaveLength(0)
    expect(qa('[data-style-section="Variant changes"]')).toHaveLength(1)
    await select('n_card_button')
    expect(qa('[data-style-section="Interactions"]')).toHaveLength(1)
    expect(qa('[data-style-section="Variant changes"]')).toHaveLength(1)
    expect(q('[data-component-interactions]')?.getAttribute('data-style-section')).toBe('Variant changes')
    expect(q('[data-node-interactions]')?.getAttribute('data-style-section')).toBe('Interactions')
  })
})

describe('the events a node lists', () => {
  it('lists a Button\'s click, mouse enter and mouse leave, and Appear as not generated yet', async () => {
    addButton()
    await mounted('pg_index')
    await select('n_open')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    const items = qa('[role^="menuitem"]').map(item => ({ text: text(item), disabled: item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('data-disabled') }))
    expect(items).toEqual([
      { text: 'Click', disabled: false },
      { text: 'Mouse enter', disabled: false },
      { text: 'Mouse leave', disabled: false },
      { text: 'AppearNot generated yet', disabled: true }
    ])
  })

  it('disables the event a node already has: one interaction per event', async () => {
    await mounted('pg_index')
    await select('n_toggle')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    const items = qa('[role^="menuitem"]').map(item => ({ text: text(item), disabled: item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('data-disabled') }))
    expect(items.map(item => item.text)).toEqual(['Click', 'ChangeAlready has one', 'Mouse enter', 'Mouse leave', 'AppearNot generated yet'])
    expect(items.filter(item => item.disabled).map(item => item.text)).toEqual(['ChangeAlready has one', 'AppearNot generated yet'])
  })

  it('lists a Form\'s submit, which the new-post form already has', async () => {
    await mounted('pg_new_post')
    await select('n_form')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(qa('[role^="menuitem"]').map(item => text(item))).toEqual(['Click', 'SubmitAlready has one', 'Mouse enter', 'Mouse leave', 'AppearNot generated yet'])
  })
})

describe('a row', () => {
  it('says "When Change → Set showDrafts · Blog preferences to the checkbox\'s value" for the checkbox', async () => {
    await mounted('pg_index')
    await select('n_toggle')
    expect(rowTexts()).toEqual(['When Change → Set showDrafts · Blog preferences to the checkbox\'s value'])
  })

  it('says a button\'s steps in order: the action, then what follows', async () => {
    await mounted('pg_post_detail')
    await select('n_publish')
    expect(rowTexts()).toEqual(['When Click → Run Publish post, then show “Post published”'])
  })

  it('uses none of the code\'s words', async () => {
    await mounted('pg_index')
    await select('n_toggle')
    await openRow()
    expect(text(section()) + text(q('[data-node-interaction-fields]'))).not.toMatch(/setState|\$event|composable|\$bind|runAction/)
  })
})

describe('a Set state step', () => {
  it('shows the checkbox\'s step: the state, its field and the control\'s value', async () => {
    await mounted('pg_index')
    await select('n_toggle')
    await openRow()
    expect(text(must('[data-step="0"] [data-step-state]'))).toBe('Blog preferences')
    expect(text(must('[data-step="0"] [data-step-field]'))).toBe('showDrafts')
    expect(text(must('[data-step="0"] [data-value-way-select]'))).toBe('The control\'s value')
    expect(text(must('[data-interaction-event]'))).toBe('Change')
  })

  it('changes the value to the opposite of the current one in one update, naming the event it saw', async () => {
    const { actions } = await mounted('pg_index')
    await select('n_toggle')
    await openRow()
    await choose('[data-step="0"] [data-value-way-select]', 'The opposite of its current value')
    expect(calls(actions, 'node_interaction_update')).toEqual([{
      file: 'pg_index', nodeId: 'n_toggle', index: 0, expectedOn: 'change',
      do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { not: { $bind: 'preferences.showDrafts' } } }]
    }])
    expect(world.model.modules.blog!.pages.find(page => page.id === 'pg_index')!.root.children![0]!.children!.find(node => node.id === 'n_toggle')!.interactions![0]!.do[0]!.value).toEqual({ not: { $bind: 'preferences.showDrafts' } })
    expect(rowTexts()).toEqual(['When Change → Set showDrafts · Blog preferences to the opposite of the current value'])
  })

  it('sets a fixed value: On or Off for a toggle, written as true or false', async () => {
    const { actions } = await mounted('pg_index')
    await select('n_toggle')
    await openRow()
    await choose('[data-step="0"] [data-value-way-select]', 'A fixed value')
    // The way is chosen, the value not yet: nothing is written.
    expect(calls(actions, 'node_interaction_update')).toEqual([])
    expect(text(step(0))).toContain('Choose On or Off')
    await choose('[data-step="0"] [data-value-fixed]', 'On')
    expect(calls(actions, 'node_interaction_update').map(input => (input.do as Array<{ value: unknown }>)[0]!.value)).toEqual([true])
  })

  it('offers the control\'s value and the opposite only where they fit: a click on a checkbox has no control\'s value', async () => {
    await mounted('pg_index')
    await select('n_toggle')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    const click = qa('[role^="menuitem"]').find(item => text(item) === 'Click')!
    click.click()
    await settle()
    await addStep('Set state')
    await choose('[data-step="0"] [data-step-state]', 'Blog preferences')
    // The state has one field: nothing to choose between.
    expect(text(must('[data-step="0"] [data-step-field]'))).toBe('showDrafts')
    const ways = await optionLabels(combo('[data-step="0"] [data-value-way-select]'))
    expect(ways).toEqual(['A fixed value', 'The opposite of its current value', 'A value from the page'])
  })

  it('lists the state the page does not use yet, and says the page starts using it', async () => {
    const index = indexPage()
    index.uses!.state = []
    index.root.children![0]!.children = index.root.children![0]!.children!.filter(node => node.id !== 'n_toggle')
    delete index.uses!.computed
    index.root.children!.find(node => node.id === 'n_list')!.props!.items = { $bind: 'featured' }
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === 'Click')!.click()
    await settle()
    await addStep('Set state')
    await choose('[data-step="0"] [data-step-state]', 'Blog preferences')
    expect(text(must('[data-step="0"] [data-step-adds]'))).toBe('The page starts using this state.')
    // The opposite needs the name the page reads it under: not offered before the page uses it.
    expect(await optionLabels(combo('[data-step="0"] [data-value-way-select]'))).toEqual(['A fixed value'])
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    await choose('[data-step="0"] [data-value-way-select]', 'A fixed value')
    await choose('[data-step="0"] [data-value-fixed]', 'Off')
    expect(calls(actions, 'node_interaction_add')).toEqual([{
      file: 'pg_index', nodeId: 'n_open', on: 'click', do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: false }]
    }])
    expect(indexPage().uses!.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
  })
})

describe('adding an interaction', () => {
  it('adds click → Show message once the title is written, and not before', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === 'Click')!.click()
    await settle()
    expect(rowTexts()).toEqual(['When Click → choose a step'])
    expect(text(must('[data-interaction-empty]'))).toBe('What should happen? Add a step.')
    await addStep('Show message')
    expect(text(step(0))).toContain('Write a title')
    expect(calls(actions, 'node_interaction_add')).toEqual([])
    await typeInto(must('[data-step-title] input, input[data-step-title]'), 'Saved')
    expect(calls(actions, 'node_interaction_add')).toEqual([{ file: 'pg_index', nodeId: 'n_open', on: 'click', do: [{ kind: 'toast', title: 'Saved' }] }])
    expect(rowTexts()).toEqual(['When Click → Show “Saved”'])
    expect(text(must('[data-step="0"]'))).not.toContain('Write a title')
  })

  it('writes the colour and the icon of the message when they are set', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === 'Mouse enter')!.click()
    await settle()
    await addStep('Show message')
    await typeInto(must('[data-step-title] input, input[data-step-title]'), 'Hi')
    await choose('[data-step-color]', 'success')
    await typeInto(must('[data-step-icon] input, input[data-step-icon]'), 'i-lucide-check')
    expect(calls(actions, 'node_interaction_add')).toHaveLength(1)
    expect(calls(actions, 'node_interaction_update').at(-1)).toMatchObject({ index: 0, expectedOn: 'mouseenter', do: [{ kind: 'toast', title: 'Hi', color: 'success', icon: 'i-lucide-check' }] })
  })

  it('changes it to Go to page: the page, and a value for each :segment of its path', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === 'Click')!.click()
    await settle()
    await addStep('Go to page')
    await choose('[data-step-page]', '/posts/:slug')
    expect(text(step(0))).toContain('Give a value for slug')
    expect(calls(actions, 'node_interaction_add')).toEqual([])
    await choose('[data-step="0"] [data-value-way-select]', 'A fixed value')
    await typeInto(must('[data-value-fixed] input, input[data-value-fixed]'), 'hello-world')
    expect(calls(actions, 'node_interaction_add')).toEqual([{ file: 'pg_index', nodeId: 'n_open', on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 'hello-world' } } }] }])
    expect(rowTexts()).toEqual(['When Click → Go to posts-slug'])
  })

  it('removes an interaction from its row, naming the event it saw', async () => {
    const { actions } = await mounted('pg_index')
    await select('n_toggle')
    await click(must('[data-node-interaction="0"] [data-node-interaction-delete]'))
    expect(calls(actions, 'node_interaction_remove')).toEqual([{ file: 'pg_index', nodeId: 'n_toggle', index: 0, on: 'change' }])
    expect(rowTexts()).toEqual([])
    expect(q('[data-interactions-empty]')).not.toBeNull()
  })

  it('keeps a new interaction closed before it was complete, as a row that says it is not saved: nothing is written', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    await pickEvent('Click')
    await addStep('Show message')
    await click(rowButton(0))
    expect(rowTexts()).toEqual(['When Click → not saved yet'])
    expect(q('[data-node-interaction-fields]')).toBeNull()
    expect(calls(actions, 'node_interaction_add')).toEqual([])
    // Opened again, the step is where it was left, and finishing it writes the interaction.
    await click(rowButton(0))
    expect(text(step(0))).toContain('Show message')
    expect(text(step(0))).toContain('Write a title')
    await typeInto(titleInput(), 'Saved')
    expect(calls(actions, 'node_interaction_add')).toEqual([{ file: 'pg_index', nodeId: 'n_open', on: 'click', do: [{ kind: 'toast', title: 'Saved' }] }])
  })

  it('drops a new interaction that was not saved when its row is removed', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    await pickEvent('Click')
    await addStep('Show message')
    await click(rowButton(0))
    await click(must('[data-node-interaction="0"] [data-node-interaction-delete]'))
    expect(rowTexts()).toEqual([])
    expect(q('[data-node-interaction-fields]')).toBeNull()
    expect(calls(actions, 'node_interaction_add')).toEqual([])
    expect(calls(actions, 'node_interaction_remove')).toEqual([])
  })

  it('keeps a new interaction that was not saved when another node is selected, and gives it back', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    await pickEvent('Click')
    await addStep('Show message')
    await select('n_toggle')
    expect(rowTexts()).toEqual(['When Change → Set showDrafts · Blog preferences to the checkbox\'s value'])
    await select('n_open')
    expect(rowTexts()).toEqual(['When Click → not saved yet'])
    await click(rowButton(0))
    expect(text(step(0))).toContain('Write a title')
    await typeInto(titleInput(), 'Back')
    expect(calls(actions, 'node_interaction_add')).toEqual([{ file: 'pg_index', nodeId: 'n_open', on: 'click', do: [{ kind: 'toast', title: 'Back' }] }])
  })

  it('writes the event of the second "+" when a first interaction is still being made, and keeps the first as a row', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    await pickEvent('Click')
    await addStep('Show message')
    await pickEvent('Mouse enter')
    await addStep('Show message')
    await typeInto(titleInput(), 'Hi')
    expect(calls(actions, 'node_interaction_add')).toEqual([{ file: 'pg_index', nodeId: 'n_open', on: 'mouseenter', do: [{ kind: 'toast', title: 'Hi' }] }])
    expect(pageNode('pg_index', 'n_open').interactions).toEqual([{ on: 'mouseenter', do: [{ kind: 'toast', title: 'Hi' }] }])
    expect(rowTexts()).toEqual(['When Mouse enter → Show “Hi”', 'When Click → not saved yet'])
  })

  it('lists the event being made as taken in the "+", so it is not made twice', async () => {
    addButton()
    await mounted('pg_index')
    await select('n_open')
    await pickEvent('Click')
    await addStep('Show message')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    const items = qa('[role^="menuitem"]').map(item => ({ text: text(item), disabled: item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('data-disabled') }))
    expect(items[0]).toEqual({ text: 'ClickAlready has one', disabled: true })
  })
})

describe('an edit of a saved interaction that is not written yet', () => {
  it('stays when its row is closed and another node is selected, and the row says it is not saved', async () => {
    const { actions } = await mounted('pg_post_detail')
    await select('n_publish')
    await openRow()
    await typeInto(titleInput(1), '')
    expect(text(step(1))).toContain('Write a title')
    expect(calls(actions, 'node_interaction_update')).toEqual([])
    await click(rowButton(0))
    expect(q('[data-interaction-unsaved]')).not.toBeNull()
    await select('n_title')
    await select('n_publish')
    expect(q('[data-interaction-unsaved]')).not.toBeNull()
    await click(rowButton(0))
    expect(fieldValue('[data-step="1"] [data-step-title]')).toBe('')
    expect(text(step(1))).toContain('Write a title')
    await typeInto(titleInput(1), 'Done')
    expect(calls(actions, 'node_interaction_update')).toHaveLength(1)
    expect(q('[data-interaction-unsaved]')).toBeNull()
  })
})

describe('an interaction that changed under the editor', () => {
  const undoing = (change: () => void): Handlers => ({
    history_get: () => ({ undo: [{ action: 'node_interaction_update' }], redo: [] }),
    history_undo: () => {
      change()
      return { action: 'node_interaction_update', files: [] }
    }
  })
  const undo = async () => click(byLabel('Undo'))

  it('says so when a step was edited elsewhere while this form held an edit, keeps the edit, and writes nothing until the latest is loaded', async () => {
    const { actions } = await mounted('pg_post_detail', undoing(() => {
      pageNode('pg_post_detail', 'n_publish').interactions![0]!.do[1]!.title = 'Changed elsewhere'
    }))
    await select('n_publish')
    await openRow()
    await typeInto(titleInput(1), '')
    await undo()
    expect(text(must('[data-interaction-stale]'))).toContain('This interaction changed since you opened it')
    expect(fieldValue('[data-step="1"] [data-step-title]')).toBe('')
    await typeInto(titleInput(1), 'Mine')
    expect(calls(actions, 'node_interaction_update')).toEqual([])
    await click(must('[data-interaction-reload]'))
    expect(q('[data-interaction-stale]')).toBeNull()
    expect(fieldValue('[data-step="1"] [data-step-title]')).toBe('Changed elsewhere')
    expect(calls(actions, 'node_interaction_update')).toEqual([])
  })

  it('shows the steps the model has again after an undo, when the form held no edit of its own', async () => {
    addButton()
    const { actions } = await mounted('pg_index', undoing(() => {
      pageNode('pg_index', 'n_open').interactions![0]!.do[0]!.title = 'Saved'
    }))
    await select('n_open')
    await pickEvent('Click')
    await addStep('Show message')
    await typeInto(titleInput(), 'Saved')
    await typeInto(titleInput(), 'Saved again')
    expect(calls(actions, 'node_interaction_update')).toHaveLength(1)
    await undo()
    expect(q('[data-interaction-stale]')).toBeNull()
    expect(fieldValue('[data-step="0"] [data-step-title]')).toBe('Saved')
  })

  it('says so when the interaction is gone (an undo of its add), keeps what was typed, and Load the latest closes it', async () => {
    addButton()
    const { actions } = await mounted('pg_index', undoing(() => {
      delete pageNode('pg_index', 'n_open').interactions
    }))
    await select('n_open')
    await pickEvent('Click')
    await addStep('Show message')
    await typeInto(titleInput(), 'Saved')
    expect(calls(actions, 'node_interaction_add')).toHaveLength(1)
    await undo()
    expect(q('[data-interaction-stale]')).not.toBeNull()
    expect(fieldValue('[data-step="0"] [data-step-title]')).toBe('Saved')
    await typeInto(titleInput(), 'Again')
    expect(calls(actions, 'node_interaction_update')).toEqual([])
    expect(calls(actions, 'node_interaction_add')).toHaveLength(1)
    await click(must('[data-interaction-reload]'))
    expect(q('[data-node-interaction-fields]')).toBeNull()
    expect(rowTexts()).toEqual([])
  })

  it('does not write into the interaction that moved into its place when an earlier one was removed', async () => {
    addButton()
    const button = pageNode('pg_index', 'n_open')
    button.interactions = [
      { on: 'click', do: [{ kind: 'toast', title: 'A' }] },
      { on: 'mouseenter', do: [{ kind: 'toast', title: 'B' }] },
      { on: 'mouseleave', do: [{ kind: 'toast', title: 'C' }] }
    ]
    const { actions } = await mounted('pg_index', undoing(() => {
      button.interactions!.splice(0, 1)
    }))
    await select('n_open')
    await openRow(1)
    expect(fieldValue('[data-step="0"] [data-step-title]')).toBe('B')
    await undo()
    expect(q('[data-interaction-stale]')).not.toBeNull()
    expect(fieldValue('[data-step="0"] [data-step-title]')).toBe('B')
    await typeInto(titleInput(), 'B edited')
    expect(calls(actions, 'node_interaction_update')).toEqual([])
    expect(button.interactions![1]!.do[0]!.title).toBe('C')
    await click(must('[data-interaction-reload]'))
    expect(fieldValue('[data-step="0"] [data-step-title]')).toBe('C')
  })
})

describe('a step written by hand', () => {
  const handwritten = () => {
    addButton()
    pageNode('pg_index', 'n_open').interactions = [{ on: 'click', do: [{ kind: 'toast', title: 'Hi' }, { kind: 'setVariant', variant: 'v_hover' }] }]
  }

  it('is a read-only card that says so, with no fields, instead of an empty message', async () => {
    handwritten()
    await mounted('pg_index')
    await select('n_open')
    expect(rowTexts()).toEqual(['When Click → Show “Hi”, then a step written by hand'])
    await openRow()
    expect(text(step(1))).toContain('This step was written by hand and can\'t be edited here')
    expect(step(1).getAttribute('data-step-kind')).toBe('unknown')
    expect(step(1).querySelector('input, [role="combobox"]')).toBeNull()
    expect(step(1).querySelector('[data-step-remove]')).not.toBeNull()
  })

  it('goes back unchanged when a step next to it is edited, and the module\'s refusal shows on its card', async () => {
    handwritten()
    const { actions } = await mounted('pg_index', {})
    await select('n_open')
    await openRow()
    await typeInto(titleInput(0), 'Hello')
    expect(calls(actions, 'node_interaction_update')).toEqual([{
      file: 'pg_index', nodeId: 'n_open', index: 0, expectedOn: 'click',
      do: [{ kind: 'toast', title: 'Hello' }, { kind: 'setVariant', variant: 'v_hover' }]
    }])
    expect(text(must('[data-step="1"] [data-step-error]'))).toContain('not generated yet')
  })

  it('can be removed, which leaves the other steps to be written', async () => {
    handwritten()
    const { actions } = await mounted('pg_index', {})
    await select('n_open')
    await openRow()
    await click(must('[data-step="1"] [data-step-remove]'))
    expect(calls(actions, 'node_interaction_update')).toEqual([{ file: 'pg_index', nodeId: 'n_open', index: 0, expectedOn: 'click', do: [{ kind: 'toast', title: 'Hi' }] }])
    expect(pageNode('pg_index', 'n_open').interactions).toEqual([{ on: 'click', do: [{ kind: 'toast', title: 'Hi' }] }])
  })
})

describe('a stored value that is not text', () => {
  it('stays a number when a step is added next to a Go to page that gives the page a number', async () => {
    addButton()
    pageNode('pg_index', 'n_open').interactions = [{ on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 5 } } }] }]
    const { actions } = await mounted('pg_index', {})
    await select('n_open')
    await openRow()
    await addStep('Show message')
    await typeInto(titleInput(1), 'Hi')
    expect(calls(actions, 'node_interaction_update')).toEqual([{
      file: 'pg_index', nodeId: 'n_open', index: 0, expectedOn: 'click',
      do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 5 } } }, { kind: 'toast', title: 'Hi' }]
    }])
  })
})

describe('a Run action step', () => {
  const addFirst = async (event: string) => {
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === event)!.click()
    await settle()
  }

  it('gives a Form the values of the form, which a click on it runs', async () => {
    const { actions } = await mounted('pg_new_post')
    await select('n_form')
    await addFirst('Click')
    await addStep('Run action')
    expect(await optionLabels(combo('[data-step="0"] [data-step-action]'))).toEqual(['Create post', 'Publish post'])
    await choose('[data-step="0"] [data-step-action]', 'Create post')
    expect(text(must('[data-step-form]'))).toBe('The values of the form')
    expect(calls(actions, 'node_interaction_add')).toEqual([{ file: 'pg_new_post', nodeId: 'n_form', on: 'click', do: [{ kind: 'runAction', action: 'act_create_post', args: { $form: true } }] }])
    // The form's own submit is the first row, the new click the second.
    expect(rowTexts()).toEqual(['When Submit → Run Create post, then go to posts-slug', 'When Click → Run Create post'])
  })

  it('lists an action that needs a form, outside one, as disabled with why, and gives the others their one parameter', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    await addFirst('Click')
    await addStep('Run action')
    expect(await optionLabels(combo('[data-step="0"] [data-step-action]'))).toEqual(['Create post (needs a form around this element)', 'Publish post'])
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    await choose('[data-step="0"] [data-step-action]', 'Publish post')
    expect(text(step(0))).toContain('Choose a value for id')
    expect(text(step(0))).toContain('The page starts using this action.')
    // No name of the page is text that is not empty: only a fixed value.
    expect(await optionLabels(combo('[data-step="0"] [data-value-way-select]'))).toEqual(['A fixed value'])
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    await choose('[data-step="0"] [data-value-way-select]', 'A fixed value')
    await typeInto(must('[data-step="0"] [data-value-fixed] input, [data-step="0"] input[data-value-fixed]'), 'not an id')
    expect(text(step(0))).toContain('Use an id like')
    expect(calls(actions, 'node_interaction_add')).toEqual([])
    await typeInto(must('[data-step="0"] [data-value-fixed] input, [data-step="0"] input[data-value-fixed]'), '123e4567-e89b-12d3-a456-426614174000')
    expect(calls(actions, 'node_interaction_add')).toEqual([{ file: 'pg_index', nodeId: 'n_open', on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: '123e4567-e89b-12d3-a456-426614174000' } }] }])
    expect(indexPage().uses!.actions).toEqual([{ as: 'publishPost', action: 'act_publish_post' }])
  })
})

describe('the order of steps', () => {
  it('offers after an action only Go to page and Show message, and writes the ones after it with when: success', async () => {
    const { actions } = await mounted('pg_post_detail')
    await select('n_publish')
    await openRow()
    expect(text(step(0))).toContain('Run action')
    expect(text(step(1))).toContain('Show message')
    expect(text(step(1))).toContain('if it worked')
    await menuItem(must('[data-interaction-add-step]'), 'Go to page')
    // The page is not chosen yet: the first two steps stay as they are.
    expect(calls(actions, 'node_interaction_update')).toEqual([])
    await choose('[data-step="2"] [data-step-page]', 'Home')
    expect(calls(actions, 'node_interaction_update')).toEqual([{
      file: 'pg_post_detail', nodeId: 'n_publish', index: 0, expectedOn: 'click',
      do: [
        { kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } },
        { kind: 'toast', when: 'success', title: 'Post published', color: 'success' },
        { kind: 'navigate', when: 'success', to: { page: 'pg_index' } }
      ]
    }])
  })

  it('offers no step after Set state, and says why', async () => {
    await mounted('pg_index')
    await select('n_toggle')
    await openRow()
    expect(q('[data-interaction-add-step]')).toBeNull()
    expect(text(must('[data-interaction-no-more]'))).toBe('Set state runs on its own. Remove it to run an action, go to a page or show a message.')
  })

  it('offers a first step of every kind on a page, but no Set state on a submit', async () => {
    await mounted('pg_new_post')
    await select('n_form')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === 'Click')!.click()
    await settle()
    must('[data-interaction-add-step]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(qa('[role^="menuitem"]').map(item => text(item))).toEqual(['Set state', 'Run action', 'Go to page', 'Show message'])
  })

  it('offers no Set state or Run action in a layout or a component: they have no state or actions to use', async () => {
    const layout = world.model.layouts.find(entry => entry.id === 'lay_main')!
    const footer = layout.root.children!.find(node => node.id === 'n_footer')!
    footer.children = [...(footer.children ?? []), { id: 'n_lay_button', type: 'Button', props: { text: 'Go' } }]
    const layoutMounted = await mounted('lay_main')
    await select('n_lay_button')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === 'Click')!.click()
    await settle()
    must('[data-interaction-add-step]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(qa('[role^="menuitem"]').map(item => text(item))).toEqual(['Go to page', 'Show message'])
    expect(calls(layoutMounted.actions, 'node_interaction_add')).toEqual([])
  })

  it('offers a component\'s button the same two', async () => {
    postCard().root.children!.push({ id: 'n_card_button', type: 'Button', props: { text: 'Go' } })
    await mounted('cmp_post_card')
    await select('n_card_button')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === 'Click')!.click()
    await settle()
    must('[data-interaction-add-step]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(qa('[role^="menuitem"]').map(item => text(item))).toEqual(['Go to page', 'Show message'])
    // Its section and the component's variant changes are two sections with two titles.
    expect(qa('[data-style-section="Interactions"], [data-style-section="Variant changes"]').map(entry => entry.getAttribute('data-style-section'))).toEqual(['Variant changes', 'Interactions'])
  })
})

describe('the value picker', () => {
  it('offers an action\'s parameter only the names that are text of the page: never a whole row, a true-or-false field, or one that may be empty', async () => {
    await mounted('pg_post_detail')
    await select('n_publish')
    await openRow()
    await choose('[data-step="0"] [data-value-way-select]', 'A value from the page')
    const names = await optionLabels(combo('[data-step="0"] [data-value-bind]'))
    expect(names).toEqual(expect.arrayContaining(['post.id', 'post.title', 'post.slug', 'slug']))
    expect(names).not.toContain('post')
    expect(names).not.toContain('post.published')
    expect(names).not.toContain('post.publishedAt')
    expect(names).not.toContain('publish.pending')
  })

  it('offers a route parameter of the page as a value', async () => {
    addButton()
    await mounted('pg_post_detail')
    // The detail page's own button runs publish with the post's id: the route's slug is text too.
    await select('n_publish')
    await openRow()
    await choose('[data-step="0"] [data-value-way-select]', 'A value from the page')
    expect(await optionLabels(combo('[data-step="0"] [data-value-bind]'))).toContain('slug')
  })

  it('offers a toggle only true-or-false names: the state field, and an action\'s pending', async () => {
    await mounted('pg_index')
    await select('n_toggle')
    await openRow()
    await choose('[data-step="0"] [data-value-way-select]', 'A value from the page')
    expect(await optionLabels(combo('[data-step="0"] [data-value-bind]'))).toEqual(['preferences.showDrafts'])
  })
})

describe('what the module refuses', () => {
  it('shows a refusal that names a step under that step, without its "step N" prefix, and keeps the edit', async () => {
    const { actions } = await mounted('pg_post_detail', {
      node_interaction_update: () => new Failure(422, 'invalid', 'step 2 (Show message): "x" is not something n_publish can read (post, publish)')
    })
    await select('n_publish')
    await openRow()
    await typeInto(must('[data-step="1"] [data-step-title] input, [data-step="1"] input[data-step-title]'), 'Done')
    expect(calls(actions, 'node_interaction_update')).toHaveLength(1)
    expect(text(must('[data-step="1"] [data-step-error]'))).toBe('"x" is not something n_publish can read (post, publish)')
    expect(q('[data-step="0"] [data-step-error]')).toBeNull()
    expect(q('[data-interaction-error]')).toBeNull()
    expect(fieldValue('[data-step="1"] [data-step-title]')).toBe('Done')
    // No error banner over the canvas: the refusal is where the edit is.
    expect(q('[data-testid="design-error"]')).toBeNull()
  })

  it('shows a refusal that names no step under the steps', async () => {
    await mounted('pg_index', {
      node_interaction_update: () => new Failure(422, 'invalid', 'n_toggle already has a click interaction (index 1): change it with node_interaction_update')
    })
    await select('n_toggle')
    await openRow()
    await choose('[data-step="0"] [data-value-way-select]', 'The opposite of its current value')
    expect(text(must('[data-interaction-error]'))).toContain('already has a click interaction')
    expect(qa('[data-step-error]')).toHaveLength(0)
  })

  it('shows the module\'s own refusal of a new interaction whose event another editor took meanwhile, under the steps', async () => {
    addButton()
    const { actions } = await mounted('pg_index')
    await select('n_open')
    sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    qa('[role^="menuitem"]').find(item => text(item) === 'Click')!.click()
    await settle()
    await addStep('Show message')
    // Another editor gives the button a click first: the editor has not read the model since.
    const button = indexPage().root.children!.find(node => node.id === 'n_head')!.children!.find(node => node.id === 'n_open')!
    button.interactions = [{ on: 'click', do: [{ kind: 'toast', title: 'Theirs' }] }]
    await typeInto(must('[data-step-title] input, input[data-step-title]'), 'Mine')
    expect(calls(actions, 'node_interaction_add')).toHaveLength(1)
    expect(text(must('[data-interaction-error]'))).toContain('n_open already has a click interaction')
    expect(fieldValue('[data-step="0"] [data-step-title]')).toBe('Mine')
    expect(button.interactions).toHaveLength(1)
    expect(q('[data-testid="design-error"]')).toBeNull()
  })

  it('refuses an edit of an interaction that changed since it was opened (expectedOn), and writes nothing', async () => {
    const { actions } = await mounted('pg_index')
    await select('n_toggle')
    await openRow()
    // Another editor moved the interaction to another event: the form still has what it opened.
    const toggle = indexPage().root.children![0]!.children!.find(node => node.id === 'n_toggle')!
    toggle.interactions![0]!.on = 'mouseenter'
    await choose('[data-step="0"] [data-value-way-select]', 'The opposite of its current value')
    expect(calls(actions, 'node_interaction_update')[0]).toMatchObject({ index: 0, expectedOn: 'change' })
    expect(text(must('[data-interaction-error]'))).toContain('it changed since you opened it')
    expect(toggle.interactions![0]!.do[0]!.value).toEqual({ $event: 'checked' })
  })

  it('refuses a remove of an interaction that changed since it was read, and keeps it', async () => {
    const { actions } = await mounted('pg_index')
    await select('n_toggle')
    const toggle = indexPage().root.children![0]!.children!.find(node => node.id === 'n_toggle')!
    toggle.interactions![0]!.on = 'mouseenter'
    await click(must('[data-node-interaction="0"] [data-node-interaction-delete]'))
    expect(calls(actions, 'node_interaction_remove')).toEqual([{ file: 'pg_index', nodeId: 'n_toggle', index: 0, on: 'change' }])
    expect(text(must('[data-interactions-error]'))).toContain('it changed since you opened it')
    expect(toggle.interactions).toHaveLength(1)
  })
})

describe('the event', () => {
  it('changes the event of an interaction in one update, naming the one it saw', async () => {
    const { actions } = await mounted('pg_post_detail')
    await select('n_publish')
    await openRow()
    await choose('[data-interaction-event]', 'Mouse enter')
    expect(calls(actions, 'node_interaction_update')).toEqual([expect.objectContaining({ index: 0, expectedOn: 'click', on: 'mouseenter' })])
    expect(rowTexts()[0]).toMatch(/^When Mouse enter → /)
  })

  it('disables the events a node has and the ones a step can\'t go with', async () => {
    await mounted('pg_index')
    await select('n_toggle')
    await openRow()
    const labels = await optionLabels(combo('[data-interaction-event]'))
    // The checkbox's own step uses the control's value, which only a change has.
    expect(labels).toEqual(['Click (uses the control\'s value)', 'Change', 'Mouse enter (uses the control\'s value)', 'Mouse leave (uses the control\'s value)', 'Appear (not generated yet)'])
  })
})
