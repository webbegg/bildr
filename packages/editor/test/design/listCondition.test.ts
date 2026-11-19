import { describe, expect, it } from 'vitest'
import { Failure, byTestId, click, settle } from '../helpers.ts'
import { behaviourModule, withHistory } from '../editor/dataKit.ts'
import { choose, find, indexPage, open, select, setupHarness, world } from './harness.ts'

/**
 * A List's conditional source (B4, S4), mounted as the Design screen over the module's own edits (`behaviourModule`): the golden blog's
 * `posts` (showDrafts → All posts, otherwise Featured posts) reads as a condition and is edited in place; a List on one query becomes
 * conditional when its condition and both lists are chosen; and going back to one source drops the computed value when nothing else
 * reads it. A refusal of the module shows under the condition, and the form shows the model again.
 */

setupHarness()

const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const value = (id: string) => (byTestId(id) as HTMLSelectElement).value
/** The values of a select's options, leaving out its "Choose …" placeholder. */
const options = (id: string) => [...(byTestId(id) as HTMLSelectElement).options].map(option => option.value).filter(Boolean)
const list = () => find(indexPage().root, 'n_list')!
const computed = () => (indexPage().uses?.computed ?? []) as Array<{ as: string, if?: unknown, then?: unknown, else?: unknown }>
const names = (actions: Awaited<ReturnType<typeof open>>['actions']) => actions.calls.map(call => call.name).filter(name => ['page_use_add', 'page_use_remove', 'page_computed_set', 'page_computed_remove', 'node_update_props'].includes(name))

/** The page's List on one query: `posts` is gone, and the List reads `all`. */
const singleSource = () => {
  delete indexPage().uses!.computed
  list().props!.items = { $bind: 'all' }
}

/** The page does not use the State: nothing holds `preferences` (the toggle's value and its interaction go). */
const withoutState = () => {
  const toggle = find(indexPage().root, 'n_toggle')!
  delete toggle.props!.value
  delete toggle.interactions
  delete indexPage().uses!.state
}

describe('the golden blog\'s posts', () => {
  it('shows as the condition it is, not as a name', async () => {
    await open(behaviourModule(), 'pg_index')
    await select('n_list')
    expect(value('list-items')).toBe('cond')
    expect(options('list-items')).toEqual(['featured', 'all', 'quotes', 'cond', 'new:ent_post', 'new:ent_quote'])
    expect(text(byTestId('list-condition-summary'))).toBe('If showDrafts is on: Then All posts, Otherwise Featured posts')
    expect(value('list-condition-if')).toBe('preferences.showDrafts')
    expect(value('list-condition-not')).toBe('on')
    expect(value('list-condition-then')).toBe('all')
    expect(value('list-condition-else')).toBe('featured')
    expect(options('list-condition-then')).toEqual(['featured', 'all'])
  })

  it('keeps each query\'s own sort, filter and limit, named by the branch it is', async () => {
    await open(behaviourModule(), 'pg_index')
    await select('n_list')
    const sources = [...document.body.querySelectorAll<HTMLElement>('[data-testid="source"]')]
    expect(sources.map(source => [source.dataset.alias, source.dataset.branch])).toEqual([['all', 'then'], ['featured', 'else']])
    expect(text(sources[0]!)).toMatch(/^Then:\s*All posts/)
    expect(text(sources[1]!)).toMatch(/^Otherwise:\s*Featured posts/)
  })

  it('edits the computed value in place: the opposite of the field, written as one page_computed_set', async () => {
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-condition-not', 'off')
    expect(names(actions)).toEqual(['page_computed_set'])
    expect(actions.named('page_computed_set')[0]!.input).toEqual({ page: 'pg_index', as: 'posts', if: { not: { $bind: 'preferences.showDrafts' } }, then: { $bind: 'all' }, else: { $bind: 'featured' } })
    expect(computed()[0]!.if).toEqual({ not: { $bind: 'preferences.showDrafts' } })
    expect(list().props!.items).toEqual({ $bind: 'posts' })
    expect(value('list-condition-not')).toBe('off')
  })

  it('shows the module\'s refusal under the condition and the form as the model has it', async () => {
    const { actions } = await open({ ...behaviourModule(), page_computed_set: () => new Failure(422, 'invalid', 'posts is a list of Post and the page reads it: keep it a list of Post') }, 'pg_index')
    await select('n_list')
    await choose('list-condition-not', 'off')
    expect(actions.named('page_computed_set')).toHaveLength(1)
    expect(text(byTestId('list-condition-error'))).toContain('keep it a list of Post')
    expect(byTestId('design-error')).toBeNull()
    expect(value('list-condition-not')).toBe('on')
    // A change that works clears it.
    await choose('list-condition-then', 'all')
  })
})

describe('the condition\'s form', () => {
  it('gives the If select its own full-width row, with the value as its title and the State as its group', async () => {
    await open(behaviourModule(), 'pg_index')
    await select('n_list')
    const ifSelect = byTestId('list-condition-if') as HTMLSelectElement
    // The is on / is off select is a row of its own, below it.
    expect(ifSelect.parentElement).not.toBe(byTestId('list-condition-not')!.parentElement)
    expect(ifSelect.title).toBe('showDrafts · Blog preferences')
    const groups = [...ifSelect.querySelectorAll('optgroup')]
    expect(groups.map(group => group.label)).toEqual(['Blog preferences'])
    expect([...groups[0]!.querySelectorAll('option')].map(option => option.textContent?.trim())).toEqual(['showDrafts'])
  })

  it('adds the State to a field only where two fields share a name', async () => {
    world.model.modules.blog!.state.push({ id: 'st_beta', name: 'beta', label: 'Beta flags', persist: 'memory', shape: 'single', fields: [{ id: 'fld_beta_show', name: 'showDrafts', type: 'boolean', default: false }] })
    await open(behaviourModule(), 'pg_index')
    await select('n_list')
    const labels = [...byTestId('list-condition-if')!.querySelectorAll('option')].filter(option => option.value).map(option => option.textContent?.trim())
    expect(labels).toEqual(['showDrafts · Blog preferences', 'showDrafts · Beta flags'])
  })

  it('says what to add when nothing is true or false yet', async () => {
    singleSource()
    withoutState()
    world.model.modules.blog!.state = []
    await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    expect(text(byTestId('list-condition-hint'))).toBe('Nothing true or false to depend on yet: add a true/false field to a State in Data.')
  })
})

describe('a computed value written by hand', () => {
  it('shows no condition and is left alone, whatever shape it has', async () => {
    ;(computed()[0] as { then: unknown }).then = { $template: 'x' }
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    expect(byTestId('list-condition')).toBeNull()
    expect(value('list-items')).toBe('posts')
    expect(names(actions)).toEqual([])
  })

  it('is not read as a condition when it holds more than the condition (the module would write it back without the rest)', async () => {
    ;(computed()[0] as Record<string, unknown>).note = 'by hand'
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    expect(byTestId('list-condition')).toBeNull()
    expect(value('list-items')).toBe('posts')
    expect(names(actions)).toEqual([])
    expect((computed()[0] as Record<string, unknown>).note).toBe('by hand')
  })
})

describe('the State the condition reads', () => {
  const flags = () => world.model.modules.blog!.state.push({ id: 'st_flags', name: 'flags', label: 'Flags', persist: 'memory', shape: 'single', fields: [{ id: 'fld_beta', name: 'beta', type: 'boolean', default: false }] })

  it('drops the page\'s use of the old State when nothing else reads it', async () => {
    flags()
    const toggle = find(indexPage().root, 'n_toggle')!
    delete toggle.props!.value
    delete toggle.interactions
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-condition-if', 'flags.beta')
    expect(names(actions)).toEqual(['page_use_add', 'page_computed_set', 'page_use_remove'])
    expect(actions.named('page_use_remove')[0]!.input).toEqual({ page: 'pg_index', as: 'preferences' })
    expect(indexPage().uses?.state).toEqual([{ as: 'flags', state: 'st_flags' }])
    expect(byTestId('list-condition-error')).toBeNull()
    expect(value('list-condition-if')).toBe('flags.beta')
  })

  it('keeps it, without a word, when something else reads it', async () => {
    flags()
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-condition-if', 'flags.beta')
    expect(actions.named('page_computed_set')).toHaveLength(1)
    expect(indexPage().uses?.state?.map(use => use.as)).toEqual(['preferences', 'flags'])
    expect(byTestId('list-condition-error')).toBeNull()
    expect(byTestId('design-error')).toBeNull()
    expect(value('list-condition-if')).toBe('flags.beta')
  })
})

describe('a write that is still going when another List is selected', () => {
  it('does not touch the other List\'s draft, failure or busy state, and the first List keeps its own', async () => {
    singleSource()
    indexPage().root.children!.push({ id: 'n_list2', type: 'List', props: { items: { $bind: 'quotes' }, as: 'quote' } })
    let release: () => void = () => undefined
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    const { actions } = await open({
      ...behaviourModule(),
      page_computed_set: async () => {
        await slow
        return new Failure(422, 'invalid', 'Refused: slow one')
      }
    }, 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')
    expect(actions.named('page_computed_set')).toHaveLength(1)
    expect((byTestId('list-items') as HTMLSelectElement).disabled).toBe(true)

    await select('n_list2')
    expect(value('list-items')).toBe('quotes')
    expect((byTestId('list-items') as HTMLSelectElement).disabled).toBe(false)
    // The other List starts a condition of its own while the first write is pending.
    await choose('list-items', 'cond')
    expect(value('list-condition-then')).toBe('quotes')

    release()
    await settle()
    // The refusal is the first List's: nothing of it reaches the second one.
    expect(byTestId('list-condition-error')).toBeNull()
    expect((byTestId('list-items') as HTMLSelectElement).disabled).toBe(false)
    expect(value('list-items')).toBe('cond')
    expect(value('list-condition-then')).toBe('quotes')
    expect(byTestId('design-error')).toBeNull()

    await select('n_list')
    expect(text(byTestId('list-condition-error'))).toContain('Refused: slow one')
    expect(value('list-condition-if')).toBe('preferences.showDrafts')
    expect(value('list-condition-else')).toBe('featured')
    expect((byTestId('list-items') as HTMLSelectElement).disabled).toBe(false)
  })

  it('does not bind the List that was selected when it finished to the first List\'s computed value', async () => {
    singleSource()
    indexPage().root.children!.push({ id: 'n_list2', type: 'List', props: { items: { $bind: 'quotes' }, as: 'quote' } })
    let release: () => void = () => undefined
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    const module = behaviourModule()
    const { actions } = await open({
      ...module,
      page_computed_set: async (input) => {
        await slow
        return module.page_computed_set!(input)
      }
    }, 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')
    await select('n_list2')
    release()
    await settle()
    expect(actions.named('node_update_props').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'posts' } } }])
    expect(list().props!.items).toEqual({ $bind: 'posts' })
    expect(find(indexPage().root, 'n_list2')!.props!.items).toEqual({ $bind: 'quotes' })
  })
})

describe('a condition not finished', () => {
  it('is kept for the List when another is selected and this one again', async () => {
    singleSource()
    indexPage().root.children!.push({ id: 'n_list2', type: 'List', props: { items: { $bind: 'quotes' }, as: 'quote' } })
    await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await select('n_list2')
    expect(value('list-items')).toBe('quotes')
    expect(byTestId('list-condition')).toBeNull()
    await select('n_list')
    expect(value('list-items')).toBe('cond')
    expect(value('list-condition-then')).toBe('all')
    expect(value('list-condition-else')).toBe('featured')
  })
})

describe('a rollback the module refuses', () => {
  it('says the computed value could not be taken off, keeps the draft, and a retry reuses its name', async () => {
    singleSource()
    withoutState()
    let refuse = true
    const module = behaviourModule()
    const { actions } = await open({
      ...module,
      node_update_props: input => (refuse ? new Failure(422, 'invalid', 'The List refuses it') : module.node_update_props!(input)),
      page_computed_remove: () => new Failure(422, 'invalid', 'Something still reads it')
    }, 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')

    // The use is not attempted while the value that reads it is still there.
    expect(names(actions)).toEqual(['page_use_add', 'page_computed_set', 'node_update_props', 'page_computed_remove'])
    const error = text(byTestId('list-condition-error'))
    expect(error).toContain('The List refuses it')
    expect(error).toContain('The computed value posts could not be taken off again')
    expect(error).toContain('Something still reads it')
    expect(computed().map(entry => entry.as)).toEqual(['posts'])
    expect(value('list-condition-if')).toBe('preferences.showDrafts')
    expect(value('list-condition-else')).toBe('featured')

    // The retry writes the value that is there, not a second one.
    refuse = false
    await choose('list-condition-not', 'off')
    expect(computed().map(entry => entry.as)).toEqual(['posts'])
    expect(computed()[0]!.if).toEqual({ not: { $bind: 'preferences.showDrafts' } })
    expect(list().props!.items).toEqual({ $bind: 'posts' })
    expect(actions.named('page_use_add')).toHaveLength(1)
    expect(byTestId('list-condition-error')).toBeNull()
  })

  it('says the use could not be taken off, keeps the draft, and a retry adds no second use', async () => {
    singleSource()
    withoutState()
    let refuse = true
    const module = behaviourModule()
    const { actions } = await open({
      ...module,
      page_computed_set: input => (refuse ? new Failure(422, 'invalid', 'Refused: nothing to switch on') : module.page_computed_set!(input)),
      page_use_remove: () => new Failure(422, 'invalid', 'The page still binds preferences')
    }, 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')

    expect(names(actions)).toEqual(['page_use_add', 'page_computed_set', 'page_use_remove'])
    const error = text(byTestId('list-condition-error'))
    expect(error).toContain('Refused: nothing to switch on')
    expect(error).toContain('The State Blog preferences could not be taken off this page again')
    expect(error).toContain('The page still binds preferences')
    expect(indexPage().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
    expect(value('list-condition-if')).toBe('preferences.showDrafts')

    refuse = false
    await choose('list-condition-not', 'off')
    expect(actions.named('page_use_add')).toHaveLength(1)
    expect(indexPage().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
    expect(computed().map(entry => entry.as)).toEqual(['posts'])
    expect(list().props!.items).toEqual({ $bind: 'posts' })
  })
})

describe('undoing a condition that added the page\'s use of the State', () => {
  it('takes the List\'s bind back, then the computed value, then the use: each undo leaves a page that reads', async () => {
    singleSource()
    withoutState()
    await open(withHistory(behaviourModule()), 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')
    expect(list().props!.items).toEqual({ $bind: 'posts' })
    const undo = () => click(document.body.querySelector<HTMLElement>('[aria-label="Undo"]'))

    await undo()
    expect(list().props!.items).toEqual({ $bind: 'all' })
    expect(computed().map(entry => entry.as)).toEqual(['posts'])
    expect(indexPage().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
    await undo()
    expect(computed()).toEqual([])
    expect(indexPage().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
    await undo()
    expect(indexPage().uses?.state).toBeUndefined()
    expect(list().props!.items).toEqual({ $bind: 'all' })
    expect(byTestId('design-error')).toBeNull()
  })
})

describe('a List on one query', () => {
  it('becomes conditional once the condition and both lists are chosen, and not before', async () => {
    singleSource()
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    expect(value('list-items')).toBe('all')
    expect(byTestId('list-condition')).toBeNull()

    await choose('list-items', 'cond')
    expect(value('list-items')).toBe('cond')
    // The List's own list is the first branch; nothing is written until the rest is chosen.
    expect(value('list-condition-then')).toBe('all')
    expect(options('list-condition-else')).toEqual(['featured', 'all'])
    await choose('list-condition-else', 'featured')
    expect(names(actions)).toEqual([])
    await choose('list-condition-if', 'preferences.showDrafts')

    expect(names(actions)).toEqual(['page_computed_set', 'node_update_props'])
    expect(actions.named('page_computed_set')[0]!.input).toEqual({ page: 'pg_index', as: 'posts', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } })
    expect(actions.named('node_update_props')[0]!.input).toEqual({ file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'posts' } } })
    expect(computed()).toEqual([{ as: 'posts', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } }])
    expect(value('list-items')).toBe('cond')
    expect(text(byTestId('list-condition-summary'))).toBe('If showDrafts is on: Then All posts, Otherwise Featured posts')
  })

  it('adds the page\'s use of the State first when the condition reads one it does not use yet', async () => {
    singleSource()
    withoutState()
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')

    expect(names(actions)).toEqual(['page_use_add', 'page_computed_set', 'node_update_props'])
    expect(actions.named('page_use_add')[0]!.input).toEqual({ page: 'pg_index', as: 'preferences', state: 'st_preferences' })
    expect(indexPage().uses?.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
  })

  it('takes the use of the State off again when the computed value is refused', async () => {
    singleSource()
    withoutState()
    const { actions } = await open({ ...behaviourModule(), page_computed_set: () => new Failure(422, 'invalid', 'Refused: nothing to switch on') }, 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')

    expect(names(actions)).toEqual(['page_use_add', 'page_computed_set', 'page_use_remove'])
    expect(indexPage().uses?.state).toBeUndefined()
    expect(list().props!.items).toEqual({ $bind: 'all' })
    expect(text(byTestId('list-condition-error'))).toContain('Refused: nothing to switch on')
  })

  it('takes the computed value and the use away again when the List\'s items are refused', async () => {
    singleSource()
    withoutState()
    const { actions } = await open({ ...behaviourModule(), node_update_props: () => new Failure(422, 'invalid', 'The List refuses it') }, 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')

    expect(names(actions)).toEqual(['page_use_add', 'page_computed_set', 'node_update_props', 'page_computed_remove', 'page_use_remove'])
    expect(computed()).toEqual([])
    expect(indexPage().uses?.state).toBeUndefined()
    expect(text(byTestId('list-condition-error'))).toContain('The List refuses it')
  })

  it('names the computed value after the collection, or the next free name', async () => {
    singleSource()
    // The page has a use called `posts` already.
    indexPage().uses!.queries!.push({ as: 'posts', query: 'q_all_posts' })
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')
    expect(actions.named('page_computed_set')[0]!.input).toMatchObject({ as: 'posts2' })
  })

  it('does not name it like the name a List gives its records', async () => {
    singleSource()
    list().props!.as = 'posts'
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-condition-else', 'featured')
    await choose('list-condition-if', 'preferences.showDrafts')
    expect(actions.named('page_computed_set')[0]!.input).toMatchObject({ as: 'posts2' })
  })
})

describe('going back to one source', () => {
  it('binds the List to the query and drops the computed value nothing else reads', async () => {
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'all')
    expect(names(actions)).toEqual(['node_update_props', 'page_computed_remove'])
    expect(actions.named('page_computed_remove')[0]!.input).toEqual({ page: 'pg_index', as: 'posts' })
    expect(computed()).toEqual([])
    expect(value('list-items')).toBe('all')
    expect(byTestId('list-condition')).toBeNull()
  })

  it('keeps a computed value something else still reads', async () => {
    indexPage().root.children!.push({ id: 'n_list2', type: 'List', props: { items: { $bind: 'posts' }, as: 'again' } })
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'all')
    expect(names(actions)).toEqual(['node_update_props'])
    expect(computed()).toHaveLength(1)
  })

  it('also drops it when the List goes to a new query', async () => {
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'new:ent_post')
    expect(names(actions)).toEqual(['page_computed_remove'])
    expect(computed()).toEqual([])
    await settle()
  })

  it('does not rebind to a name it was not asked for when the pick is left half way', async () => {
    singleSource()
    const { actions } = await open(behaviourModule(), 'pg_index')
    await select('n_list')
    await choose('list-items', 'cond')
    await choose('list-items', 'featured')
    expect(actions.named('node_update_props').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'featured' } } }])
    expect(byTestId('list-condition')).toBeNull()
  })
})
