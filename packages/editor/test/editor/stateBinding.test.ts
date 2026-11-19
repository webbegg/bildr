import { describe, expect, it } from 'vitest'
import { Failure, byTestId, click, settle } from '../helpers.ts'
import { find, menuItem, menuLabels, open, propRow, select, setupHarness, world } from '../design/harness.ts'
import { behaviourModule, withHistory } from './dataKit.ts'

/**
 * Binding a prop to State from the inspector's binding dot (B4, S3), mounted as the Design screen over the module's own edits
 * (`behaviourModule`): a rule the editor and the module disagree on shows as a refusal here. The blog fixture's index page uses the
 * state `preferences` (Blog preferences) and binds the checkbox `n_toggle` to its field `showDrafts`; its new-post page does not use
 * it, and gets a bare Checkbox `n_flag` here.
 */

setupHarness()

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const newPost = () => world.model.modules.blog!.pages.find(page => page.id === 'pg_new_post')!
const addFlag = () => {
  newPost().root.children!.push({ id: 'n_flag', type: 'Checkbox', props: { label: 'Flag' } })
  return 'n_flag'
}
const dot = (prop: string) => propRow(prop)?.querySelector<HTMLElement>('[data-binding-dot]') ?? null
const flagProps = () => find(newPost().root, 'n_flag')!.props

describe('binding a Checkbox\'s value to State', () => {
  it('lists the State fields the prop takes, under the State\'s label, before the page uses it', async () => {
    addFlag()
    await open(behaviourModule(), 'pg_new_post')
    await select('n_flag')
    const labels = await menuLabels(dot('value'))
    expect(labels).toEqual(['showDrafts'])
    // The State's label heads its fields.
    expect(text(q('[role="menu"]'))).toContain('Blog preferences')
    expect(text(q('[role="menu"]'))).toContain('State, added to this page')
    expect(q('[data-prop-group="Behaviour"] [data-prop-row="value"]')).not.toBeNull()
  })

  it('adds the page\'s use of the State first, then binds, in one pick', async () => {
    addFlag()
    const { actions } = await open(behaviourModule(), 'pg_new_post')
    await select('n_flag')
    await menuItem(dot('value'), 'showDrafts')

    expect(actions.calls.filter(call => ['page_use_add', 'node_update_props'].includes(call.name))).toEqual([
      { name: 'page_use_add', input: { page: 'pg_new_post', as: 'preferences', state: 'st_preferences' } },
      { name: 'node_update_props', input: { file: 'pg_new_post', nodeId: 'n_flag', props: { value: { $bind: 'preferences.showDrafts' } } } }
    ])
    expect(newPost().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
    expect(flagProps()?.value).toEqual({ $bind: 'preferences.showDrafts' })
    expect(byTestId('design-error')).toBeNull()
    // The bound field is a chip: "showDrafts · Blog preferences".
    expect(text(propRow('value')!.querySelector('[data-bound-expression]'))).toBe('showDrafts · Blog preferences')
  })

  it('only binds when the page uses the State already', async () => {
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_toggle')
    expect(text(propRow('value')!.querySelector('[data-bound-expression]'))).toBe('showDrafts · Blog preferences')
    await click(propRow('value')!.querySelector('[data-binding-chip-unbind]'))
    expect(actions.named('node_update_props').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_toggle', props: { value: null } }])
    await menuItem(dot('value'), 'showDrafts')
    expect(actions.named('page_use_add')).toEqual([])
    expect(actions.named('node_update_props').at(-1)!.input).toEqual({ file: 'pg_index', nodeId: 'n_toggle', props: { value: { $bind: 'preferences.showDrafts' } } })
  })

  it('leaves the page\'s use of the State in place when the field is unbound, which the generated app ignores', async () => {
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_toggle')
    await click(propRow('value')!.querySelector('[data-binding-chip-unbind]'))
    expect(actions.named('page_use_remove')).toEqual([])
    expect(world.model.modules.blog!.pages.find(page => page.id === 'pg_index')!.uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
  })

  it('takes the page\'s use of the State off again when the bind is refused, and says why', async () => {
    addFlag()
    const { actions } = await open({ ...behaviourModule(), node_update_props: () => new Failure(422, 'invalid', 'A Checkbox cannot be bound there') }, 'pg_new_post')
    await select('n_flag')
    await menuItem(dot('value'), 'showDrafts')

    expect(actions.calls.map(call => call.name).filter(name => name.startsWith('page_use') || name === 'node_update_props')).toEqual(['page_use_add', 'node_update_props', 'page_use_remove'])
    expect(actions.named('page_use_remove')[0]!.input).toEqual({ page: 'pg_new_post', as: 'preferences' })
    expect(newPost().uses?.state).toBeUndefined()
    await settle()
    expect(text(byTestId('design-error'))).toContain('A Checkbox cannot be bound there')
  })

  it('does not take away a use the page had when the bind is refused', async () => {
    const { actions } = await open({ ...behaviourModule(), node_update_props: () => new Failure(422, 'invalid', 'Refused') }, 'pg_index')
    await select('n_toggle')
    await click(propRow('value')!.querySelector('[data-binding-chip-unbind]'))
    await menuItem(dot('value'), 'showDrafts')
    expect(actions.named('page_use_add')).toEqual([])
    expect(actions.named('page_use_remove')).toEqual([])
  })
})

describe('what the menu says about a State', () => {
  it('says a State the page uses is "Used on this page", and one it does not use is added to it', async () => {
    await open(behaviourModule(), 'pg_index')
    await select('n_toggle')
    await click(propRow('value')!.querySelector('[data-binding-chip-unbind]'))
    await menuLabels(dot('value'))
    expect(text(q('[role="menu"]'))).toContain('Used on this page')
    expect(text(q('[role="menu"]'))).not.toContain('added to this page')
  })
})

describe('undoing a bind that added the page\'s use of the State', () => {
  it('takes the bind back first and the use after it, each undo leaving a model that loads and reads', async () => {
    addFlag()
    const { actions } = await open(withHistory(behaviourModule()), 'pg_new_post')
    await select('n_flag')
    await menuItem(dot('value'), 'showDrafts')
    expect(actions.calls.filter(call => ['page_use_add', 'node_update_props'].includes(call.name)).map(call => call.name)).toEqual(['page_use_add', 'node_update_props'])
    expect(flagProps()?.value).toEqual({ $bind: 'preferences.showDrafts' })

    // One undo is one edit: the bind goes, and the page still uses the State, which nothing reads (a use the generated app ignores).
    await click(document.body.querySelector<HTMLElement>('[aria-label="Undo"]'))
    expect(flagProps()?.value).toBeUndefined()
    expect(newPost().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
    expect(text(propRow('value')!.querySelector('[data-bound-expression]'))).toBe('')
    expect(byTestId('design-error')).toBeNull()

    // The next one takes the use away: the page is as it was.
    await click(document.body.querySelector<HTMLElement>('[aria-label="Undo"]'))
    expect(newPost().uses?.state).toBeUndefined()
    expect(byTestId('design-error')).toBeNull()
  })
})

describe('a rollback the module refuses', () => {
  it('says the use could not be taken off, keeps the page as it is, and a second pick does not add another use', async () => {
    addFlag()
    let refuse = true
    const module = behaviourModule()
    const { actions } = await open({
      ...module,
      node_update_props: input => (refuse ? new Failure(422, 'invalid', 'A Checkbox cannot be bound there') : module.node_update_props!(input)),
      page_use_remove: () => new Failure(422, 'invalid', 'The page still binds preferences')
    }, 'pg_new_post')
    await select('n_flag')
    await menuItem(dot('value'), 'showDrafts')

    expect(actions.calls.map(call => call.name).filter(name => name.startsWith('page_use') || name === 'node_update_props')).toEqual(['page_use_add', 'node_update_props', 'page_use_remove'])
    await settle()
    const banner = text(byTestId('design-error'))
    expect(banner).toContain('A Checkbox cannot be bound there')
    expect(banner).toContain('The State Blog preferences could not be taken off this page again')
    expect(banner).toContain('The page still binds preferences')
    expect(newPost().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])

    // The use is there now: the next pick only binds, under the same name.
    refuse = false
    await menuItem(dot('value'), 'showDrafts')
    expect(actions.named('page_use_add')).toHaveLength(1)
    expect(newPost().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
    expect(flagProps()?.value).toEqual({ $bind: 'preferences.showDrafts' })
  })
})

describe('a Checkbox that fills a Form field', () => {
  it('is not offered State, or a binding of its value: the row is disabled and says why', async () => {
    newPost().root.children!.push({ id: 'n_flag', type: 'Checkbox', props: { label: 'Flag', field: 'done' } })
    await open(behaviourModule(), 'pg_new_post')
    await select('n_flag')
    expect(dot('value')).toBeNull()
    const row = propRow('value')!
    expect(text(row.querySelector('[data-prop-locked]'))).toContain('gets its value from the Form')
    expect([...row.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
  })

  it('offers State again once the Field is cleared', async () => {
    newPost().root.children!.push({ id: 'n_flag', type: 'Checkbox', props: { label: 'Flag' } })
    await open(behaviourModule(), 'pg_new_post')
    await select('n_flag')
    expect(dot('value')).not.toBeNull()
    expect(propRow('value')!.querySelector('[data-prop-locked]')).toBeNull()
  })
})

describe('where State is not offered', () => {
  it('offers no State to a prop that takes none', async () => {
    addFlag()
    await open(behaviourModule(), 'pg_new_post')
    await select('n_flag')
    expect(propRow('label')!.querySelector('[data-binding-dot]')).toBeNull()
  })
})
