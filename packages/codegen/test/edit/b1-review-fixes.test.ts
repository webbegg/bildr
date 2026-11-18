import { describe, expect, it } from 'vitest'
import { composableNameProblem, composableProblem } from '../../src/edit/reserved-names'
import { project } from './helpers'
import { expectGenerates, INDEX, nodeOf } from './behaviour-helpers'
import type { Project } from './behaviour-helpers'

/**
 * B1 review fixes: what the interaction edits do with the page uses they made or found (a use nothing else reads goes with the last
 * step that needed it), indexes that are not there, an update or remove that is refused, and the `on` a caller says it saw.
 */

const UUID = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01'
const BUTTON = 'n_button_1'
const OTHER = 'n_button_2'

/** The state "reading" and two Buttons on pg_index; the page does not use "reading" yet. */
const base = (): Project => {
  const p = project()
  p.edit('state_create', { name: 'reading', fields: [{ name: 'dark', type: 'boolean', default: false }] })
  p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Go' } })
  p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Also' } })
  return p
}
const add = (p: Project, input: Record<string, unknown>, nodeId = BUTTON) => p.edit('node_interaction_add', { file: 'pg_index', nodeId, ...input })
const remove = (p: Project, index: number, nodeId = BUTTON, extra: Record<string, unknown> = {}) => p.edit('node_interaction_remove', { file: 'pg_index', nodeId, index, ...extra })
const toast = (title: string) => [{ kind: 'toast', title }]
const setDark = (value: boolean) => [{ kind: 'setState', state: 'st_reading', field: 'dark', value }]
const stateUses = (p: Project) => (p.json(INDEX).uses.state as Array<{ as: string, state: string }>).filter(use => use.state === 'st_reading')
const actionUses = (p: Project) => (p.json(INDEX).uses.actions ?? []) as Array<{ as: string, action: string }>

describe('a page use nothing else reads goes with the last step that needed it', () => {
  it('drops a state use made by page_use_add when the last step that sets it goes, and says so', () => {
    const p = base()
    p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    expect(add(p, { on: 'click', do: setDark(true) }).addedUses).toEqual([])
    const result = remove(p, 0)
    expect(result.droppedUses).toEqual([{ as: 'reading', state: 'st_reading' }])
    expect(stateUses(p)).toEqual([])
    p.edit('state_delete', { state: 'st_reading' })
  })

  it('keeps it while a node binds it', () => {
    const p = base()
    p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Checkbox', props: { label: 'Dark', value: { $bind: 'reading.dark' } } })
    add(p, { on: 'click', do: setDark(true) })
    expect(remove(p, 0).droppedUses).toEqual([])
    expect(stateUses(p)).toEqual([{ as: 'reading', state: 'st_reading' }])
  })

  it('keeps it while another node sets it, and drops it with the last one', () => {
    const p = base()
    p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    add(p, { on: 'click', do: setDark(true) })
    add(p, { on: 'click', do: setDark(false) }, OTHER)
    expect(remove(p, 0).droppedUses).toEqual([])
    expect(stateUses(p)).toHaveLength(1)
    expect(remove(p, 0, OTHER).droppedUses).toEqual([{ as: 'reading', state: 'st_reading' }])
    expect(stateUses(p)).toEqual([])
  })

  it('drops it when an update replaces the step that set it', () => {
    const p = base()
    p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    add(p, { on: 'click', do: setDark(true) })
    const result = p.edit('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0, do: toast('hi') })
    expect(result.droppedUses).toEqual([{ as: 'reading', state: 'st_reading' }])
    expect(stateUses(p)).toEqual([])
  })

  it('does the same for an action use made by page_use_add', () => {
    const p = base()
    p.edit('page_use_add', { page: 'pg_index', as: 'publish', action: 'act_publish_post' })
    add(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }] })
    add(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }] }, OTHER)
    expect(remove(p, 0).droppedUses).toEqual([])
    expect(actionUses(p)).toEqual([{ as: 'publish', action: 'act_publish_post' }])
    expect(remove(p, 0, OTHER).droppedUses).toEqual([{ as: 'publish', action: 'act_publish_post' }])
    expect(actionUses(p)).toEqual([])
    expectGenerates(p)
  })
})

describe('an index beyond the list', () => {
  it('is not_found for an update and a remove, and writes nothing', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    const before = { ...p.files }
    expect(p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 1, do: toast('b') }, 'not_found').message).toContain('index 1')
    expect(p.refuse('node_interaction_remove', { file: 'pg_index', nodeId: BUTTON, index: 5 }, 'not_found').message).toContain('index 5')
    expect(p.refuse('node_interaction_update', { file: 'pg_index', nodeId: OTHER, index: 0, do: toast('b') }, 'not_found').message).toContain('index 0')
    expect(p.files).toEqual(before)
  })
})

describe('an update that changes only the event', () => {
  it('is refused when the node already has an interaction for that event, naming its index', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    add(p, { on: 'mouseenter', do: toast('b') })
    const before = { ...p.files }
    const refused = p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 1, on: 'click' }, 'invalid')
    expect(refused.message).toContain('index 0')
    expect(refused.message).toContain('click')
    expect(p.files).toEqual(before)
  })
})

describe('removing a middle interaction', () => {
  it('shifts the later ones down, and the result says the new order', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    add(p, { on: 'mouseenter', do: toast('b') })
    add(p, { on: 'mouseleave', do: toast('c') })
    const result = remove(p, 1)
    expect(result.interactions).toEqual([{ index: 0, on: 'click' }, { index: 1, on: 'mouseleave' }])
    expect(nodeOf(p, INDEX, BUTTON).interactions).toEqual([
      { on: 'click', do: toast('a') },
      { on: 'mouseleave', do: toast('c') }
    ])
    // What was index 2 is index 1 now: the old index no longer exists.
    p.refuse('node_interaction_remove', { file: 'pg_index', nodeId: BUTTON, index: 2 }, 'not_found')
  })

  it('says an empty order when it was the last', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    expect(remove(p, 0).interactions).toEqual([])
  })
})

describe('a refused update', () => {
  it('leaves every file byte-identical, even when a step had already made the page use something', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    const before = { ...p.files }
    // The page would start using "reading" for this step; the second one is refused, so nothing may be written.
    p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0, do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: 'nope' }] }, 'invalid')
    expect(p.files).toEqual(before)
    for (const path of Object.keys(before)) expect(p.files[path]).toBe(before[path])
    expect(JSON.stringify(p.json(INDEX).uses)).not.toContain('st_reading')
  })
})

describe('the event a caller says it saw', () => {
  it('lets a remove through when on is the interaction at that index', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    add(p, { on: 'mouseenter', do: toast('b') })
    expect(remove(p, 1, BUTTON, { on: 'mouseenter' }).interactions).toEqual([{ index: 0, on: 'click' }])
  })

  it('refuses a remove whose on is not the interaction there: it changed since it was opened, and nothing is written', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    add(p, { on: 'mouseenter', do: toast('b') })
    const before = { ...p.files }
    const refused = p.refuse('node_interaction_remove', { file: 'pg_index', nodeId: BUTTON, index: 1, on: 'click' }, 'invalid')
    expect(refused.message).toContain('changed since you opened it')
    expect(refused.message).toContain('mouseenter')
    expect(p.files).toEqual(before)
  })

  it('still reports an index that is not there as not_found, whatever on says', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    p.refuse('node_interaction_remove', { file: 'pg_index', nodeId: BUTTON, index: 3, on: 'click' }, 'not_found')
  })

  it('lets an update through when expectedOn is the interaction at that index, whatever it changes it to', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    p.edit('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0, expectedOn: 'click', on: 'mouseenter' })
    expect(nodeOf(p, INDEX, BUTTON).interactions).toEqual([{ on: 'mouseenter', do: toast('a') }])
    p.edit('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0, expectedOn: 'mouseenter', do: toast('b') })
    expect(nodeOf(p, INDEX, BUTTON).interactions).toEqual([{ on: 'mouseenter', do: toast('b') }])
  })

  it('refuses an update whose expectedOn is not the interaction there, and writes nothing', () => {
    const p = base()
    add(p, { on: 'click', do: toast('a') })
    add(p, { on: 'mouseenter', do: toast('b') })
    const before = { ...p.files }
    const refused = p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 1, expectedOn: 'click', do: toast('c') }, 'invalid')
    expect(refused.message).toContain('changed since you opened it')
    expect(p.files).toEqual(before)
  })
})

/** Words the user never sees in a refusal: the editor says State, Collection and Sample data. */
const CODE_WORDS = /entity|entities|composable|setter|shape|Object\.prototype|steps\.\d|setState \(|runAction \(|toast \(|navigate \(/i

describe('the words a refusal uses', () => {
  const said = (p: Project, name: Parameters<Project['refuse']>[0], input: Record<string, unknown>) => {
    const { message } = p.refuse(name, input, 'invalid')
    expect(message).not.toMatch(CODE_WORDS)
    return message
  }

  it('says a state with several rows is not generated yet', () => {
    expect(said(project(), 'state_create', { name: 'reading', shape: 'many' })).toBe('A state with several rows is not generated yet: a state holds one row of values')
  })

  it('says what clashes by the names the user sees', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'blogReading' })
    expect(said(p, 'state_create', { name: 'reading' })).toBe('The name "reading" clashes with the query blogReading (q_blog_reading), which the app also names useBlogReading: pick another')
    expect(said(project(), 'state_create', { name: 'posts' })).toBe('The name "posts" is already taken by the collection Post: pick another')
    expect(said(project(), 'state_create', { name: 'data' })).toBe('"data" is a name the generated code of every state already uses: pick another name')
  })

  it('names the state the user typed when its generated name is one Nuxt provides, never a hyphenated one', () => {
    // A state "mode" of a module "color" would generate useColorMode.
    const message = composableProblem('useColorMode', 'mode')
    expect(message).toBe('`mode` would generate useColorMode, which @nuxtjs/color-mode already provides: pick another name')
    expect(message).not.toContain('color-mode`')
    expect(composableNameProblem('colorMode')).toBe('`colorMode` would generate useColorMode, which @nuxtjs/color-mode already provides: pick another name')
  })

  it('says what the page derives from a use in the words of the editor', () => {
    const p = base()
    p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    expect(said(p, 'page_use_add', { page: 'pg_index', as: 'setReading', query: 'q_all_posts' })).toBe('The page\'s script would declare "setReading" twice: as the "set…" name of the state "reading" and as "setReading"')
  })

  it('numbers steps from 1 and names them as the editor does', () => {
    const p = base()
    expect(said(p, 'node_interaction_add', { file: 'pg_index', nodeId: BUTTON, on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: 'nope' }] })).toContain('step 1 (Set state):')
    expect(said(p, 'node_interaction_add', { file: 'pg_index', nodeId: BUTTON, on: 'click', do: [{ kind: 'toast', title: 'a' }, ...setDark(true)] })).toContain('step 2: a Set state step can\'t be one of several steps')
    expect(said(p, 'node_interaction_add', { file: 'pg_index', nodeId: BUTTON, on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail' } }] })).toContain('step 1 (Go to page):')
  })

  it('describes a list, a row and a plain value one way', () => {
    const p = project()
    expect(said(p, 'page_computed_set', { page: 'pg_index', as: 'mixed', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: 'x' })).toBe('then is a list of Post but else is a plain value: both have to be the same kind of value, so a List can take either')
  })
})
