import { describe, expect, it } from 'vitest'
import { applyEdit } from '@bildr/codegen/edit'
import type { EditName } from '@bildr/codegen/edit'
import { loadModel } from '@bildr/codegen/model'
import type { ActionFile, Model, Value } from '@bildr/codegen/model'
import { draftOfStep, stepsOfDrafts } from '../../src/shared/interactionConversion.ts'
import { draftProblems } from '../../src/shared/interactionProblems.ts'
import { refusalAt, summarize } from '../../src/shared/interactionSummary.ts'
import {
  actionUse, actionsFor, addableKinds, eventChoices, eventsOf, newStep, pagesFor, statesFor, takesEvents, valueModes
} from '../../src/shared/nodeInteractions.ts'
import type { Env, StepDraft } from '../../src/shared/nodeInteractions.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * The inspector's Interactions, as pure functions (B3, S2): which nodes take which events, which steps can follow which, how a
 * stored step reads as a draft and back, what a row says, and which step a refusal is about. The last block asks the module
 * itself (`applyEdit`) about what the editor offers: an offered step is never refused.
 */

const files = blogModelFiles()
const loaded = loadModel(files)
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model

const env = (file: string, nodeId: string, nodeType: string, on: Env['on'], kind: Env['place']['kind'] = 'page'): Env => ({ model, place: { file, kind, nodeId }, nodeType, on })
const TOGGLE = env('pg_index', 'n_toggle', 'Checkbox', 'change')
const HEAD = env('pg_index', 'n_head', 'Row', 'click')

describe('which nodes take which events', () => {
  it('gives a Button click, mouse enter and mouse leave, a Checkbox change too, and a Form submit too', () => {
    expect(eventsOf('Button')).toEqual(['click', 'mouseenter', 'mouseleave'])
    expect(eventsOf('Checkbox')).toEqual(['click', 'change', 'mouseenter', 'mouseleave'])
    expect(eventsOf('Form')).toEqual(['click', 'submit', 'mouseenter', 'mouseleave'])
  })

  it('gives no other node any', () => {
    for (const type of ['Text', 'Container', 'Row', 'Page', 'Instance', 'List', 'Image', 'Link', 'Input', 'SlotFill']) expect(eventsOf(type)).toEqual([])
    expect(takesEvents('Button')).toBe(true)
    expect(takesEvents('Text')).toBe(false)
  })

  it('lists Appear as not generated yet, and an event the node already has as taken', () => {
    expect(eventChoices('Button', ['click'])).toEqual([
      { on: 'click', label: 'Click', disabled: true, hint: 'Already has one' },
      { on: 'mouseenter', label: 'Mouse enter' },
      { on: 'mouseleave', label: 'Mouse leave' },
      { on: 'appear', label: 'Appear', disabled: true, hint: 'Not generated yet' }
    ])
    expect(eventChoices('Text', [])).toEqual([])
  })
})

describe('which steps can be added', () => {
  const kinds = (steps: StepDraft['kind'][], on: Env['on'], kind: Env['place']['kind'] = 'page') => addableKinds(steps, on, kind)

  it('offers every kind first, and in a layout or component only the ones that generate there', () => {
    expect(kinds([], 'click')).toEqual(['setState', 'runAction', 'navigate', 'toast'])
    expect(kinds([], 'click', 'layout')).toEqual(['navigate', 'toast'])
    expect(kinds([], 'click', 'component')).toEqual(['navigate', 'toast'])
  })

  it('offers no Set state on a submit: it runs an action, goes to a page or shows a message', () => {
    expect(kinds([], 'submit')).toEqual(['runAction', 'navigate', 'toast'])
  })

  it('offers nothing after Set state, which is a single step', () => {
    expect(kinds(['setState'], 'click')).toEqual([])
  })

  it('offers Go to page and Show message after an action, and after either of them, but never an action or Set state', () => {
    expect(kinds(['runAction'], 'click')).toEqual(['navigate', 'toast'])
    expect(kinds(['runAction', 'toast'], 'click')).toEqual(['navigate', 'toast'])
    expect(kinds(['navigate'], 'click')).toEqual(['navigate', 'toast'])
    expect(kinds(['toast', 'navigate'], 'mouseenter')).toEqual(['navigate', 'toast'])
  })

  it('stops at ten steps', () => {
    expect(kinds(Array.from({ length: 10 }, () => 'toast' as const), 'click')).toEqual([])
  })
})

describe('a step as a draft and back', () => {
  const roundTrip = (e: Env, step: Record<string, Value>, steps: Array<Record<string, Value>> = [step]) => {
    const drafts = steps.map(entry => draftOfStep(e, entry))
    return stepsOfDrafts(e, drafts)
  }

  it('reads the checkbox\'s own step as the control\'s value, and writes it back as it was', () => {
    const step = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { $event: 'checked' } }
    expect(draftOfStep(TOGGLE, step)).toEqual({ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'event' } })
    expect(roundTrip(TOGGLE, step)).toEqual([step])
  })

  it('reads the opposite of the field as "opposite", and a fixed true or false as fixed', () => {
    const flip = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { not: { $bind: 'preferences.showDrafts' } } }
    expect(draftOfStep(TOGGLE, flip)).toMatchObject({ value: { kind: 'flip' } })
    expect(roundTrip(TOGGLE, flip)).toEqual([flip])
    const fixed = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: true }
    expect(draftOfStep(TOGGLE, fixed)).toMatchObject({ value: { kind: 'fixed', text: 'true' } })
    expect(roundTrip(TOGGLE, fixed)).toEqual([fixed])
  })

  it('keeps an expression the picker does not edit whole', () => {
    const odd = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { $bind: 'post.published', fallback: false } }
    expect(draftOfStep(TOGGLE, odd)).toMatchObject({ value: { kind: 'other', value: { $bind: 'post.published', fallback: false } } })
    expect(roundTrip(TOGGLE, odd)).toEqual([odd])
  })

  it('reads a Run action with a parameter, and writes each step after it with when: success', () => {
    const e = env('pg_post_detail', 'n_publish', 'Button', 'click')
    const steps = [
      { kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } },
      { kind: 'toast', when: 'success', title: 'Post published', color: 'success' }
    ]
    const drafts = steps.map(step => draftOfStep(e, step))
    expect(drafts[0]).toEqual({ kind: 'runAction', action: 'act_publish_post', args: { mode: 'param', name: 'id', value: { kind: 'bind', path: 'post.id' } } })
    expect(drafts[1]).toMatchObject({ kind: 'toast', title: 'Post published', color: 'success' })
    // `when` is not part of a draft: the order says it.
    expect(JSON.stringify(drafts)).not.toContain('when')
    expect(stepsOfDrafts(e, drafts)).toEqual(steps)
  })

  it('writes the steps of a list of Go to page and Show message in order, with no when', () => {
    const e = env('pg_index', 'n_head', 'Button', 'click')
    const drafts: StepDraft[] = [
      { kind: 'toast', title: 'Hi', description: '', color: '', icon: '' },
      { kind: 'navigate', page: 'pg_post_detail', params: { slug: { kind: 'fixed', text: 'hello' } } }
    ]
    expect(stepsOfDrafts(e, drafts)).toEqual([
      { kind: 'toast', title: 'Hi' },
      { kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 'hello' } } }
    ])
  })

  it('writes a bound page parameter, and a route parameter', () => {
    const e = env('pg_post_detail', 'n_publish', 'Button', 'click')
    const draft: StepDraft = { kind: 'navigate', page: 'pg_post_detail', params: { slug: { kind: 'route', name: 'slug' } } }
    expect(stepsOfDrafts(e, [draft])).toEqual([{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $route: 'slug' } } } }])
    const bound: StepDraft = { kind: 'navigate', page: 'pg_post_detail', params: { slug: { kind: 'bind', path: 'post.slug' } } }
    expect(stepsOfDrafts(env('pg_index', 'n_read_more', 'Button', 'click'), [bound])).toEqual([{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'post.slug' } } } }])
  })

  it('writes a typed fixed value: a number for a number field, true or false for a toggle', () => {
    const e = env('pg_index', 'n_head', 'Button', 'click')
    const draft: StepDraft = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'fixed', text: 'false' } }
    expect(stepsOfDrafts(e, [draft])).toEqual([{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: false }])
  })

  it('writes text with a name in it as a template, even when it is only the name', () => {
    const e = env('pg_index', 'n_read_more', 'Button', 'click')
    const draft: StepDraft = { kind: 'toast', title: '{post.title}', description: 'By {post.slug}', color: '', icon: '' }
    expect(stepsOfDrafts(e, [draft])).toEqual([{ kind: 'toast', title: { $template: '{post.title}' }, description: { $template: 'By {post.slug}' } }])
  })
})

describe('what a draft still needs', () => {
  const problems = (drafts: StepDraft[], e: Env = HEAD) => draftProblems(e, drafts)

  it('says what a new step lacks, step by step, and nothing once it is complete', () => {
    expect(problems([newStep('setState')])).toEqual([['Choose a state']])
    expect(problems([newStep('runAction')])).toEqual([['Choose an action']])
    expect(problems([newStep('navigate')])).toEqual([['Choose a page']])
    expect(problems([newStep('toast')])).toEqual([['Write a title']])
    expect(problems([{ kind: 'toast', title: 'Hi', description: '', color: '', icon: '' }])).toEqual([[]])
  })

  it('asks for the field and the value of a Set state step, and a fixed value that fits the field', () => {
    const base = { kind: 'setState' as const, state: 'st_preferences', field: '', value: { kind: 'none' as const } }
    expect(problems([base])).toEqual([['Choose a field']])
    expect(problems([{ ...base, field: 'showDrafts' }])).toEqual([['Choose a value']])
    expect(problems([{ ...base, field: 'showDrafts', value: { kind: 'fixed', text: 'maybe' } }])).toEqual([['Choose On or Off']])
    expect(problems([{ ...base, field: 'showDrafts', value: { kind: 'fixed', text: 'true' } }])).toEqual([[]])
  })

  it('asks for a value for each :segment of the page the step goes to, and for the page\'s own use of a state to flip', () => {
    const draft: StepDraft = { kind: 'navigate', page: 'pg_post_detail', params: {} }
    expect(problems([draft])).toEqual([['Give a value for slug']])
    expect(problems([{ ...draft, params: { slug: { kind: 'fixed', text: '' } } }])).toEqual([['Give a value for slug']])
    const bare = env('pg_new_post', 'n_x', 'Button', 'click')
    const flip: StepDraft = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'flip' } }
    expect(draftProblems(bare, [flip])).toEqual([['This page does not use Blog preferences yet: set it to a fixed value first']])
    expect(problems([flip], TOGGLE)).toEqual([[]])
  })

  it('checks the icon\'s name', () => {
    expect(problems([{ kind: 'toast', title: 'Hi', description: '', color: '', icon: 'send' }])).toEqual([['Use an icon name like i-lucide-send']])
  })
})

describe('the value choices of a step', () => {
  it('offers the control\'s value only to a toggle set by a Checkbox\'s change that is the only step', () => {
    const draft: StepDraft = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'none' } }
    expect(valueModes(TOGGLE, [draft], 0)).toMatchObject({ event: true, flip: true })
    expect(valueModes({ ...TOGGLE, on: 'click' }, [draft], 0)).toMatchObject({ event: false, flip: true })
    expect(valueModes({ ...TOGGLE, nodeType: 'Button' }, [draft], 0)).toMatchObject({ event: false })
  })

  it('offers the bound values that fit the field, as the picker', () => {
    const draft: StepDraft = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'none' } }
    expect(valueModes(TOGGLE, [draft], 0).choices.map(choice => choice.path)).toEqual(['preferences.showDrafts'])
  })

  it('offers "opposite" only for a toggle', () => {
    const text = env('pg_index', 'n_head', 'Button', 'click')
    const draft: StepDraft = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'none' } }
    expect(valueModes(text, [{ ...draft, field: 'nothing' }], 0)).toMatchObject({ event: false, flip: false })
  })
})

describe('what a step can name', () => {
  it('offers the states and actions of the page\'s module, used by the page or not, and every page', () => {
    expect(statesFor(TOGGLE).map(state => state.id)).toEqual(['st_preferences'])
    expect(actionsFor(TOGGLE).map(action => action.id)).toEqual(['act_create_post', 'act_publish_post'])
    expect(pagesFor(TOGGLE).map(page => page.id).sort()).toEqual(['pg_index', 'pg_new_post', 'pg_post_detail'])
  })

  it('offers no state to a layout or a component: they have none to use', () => {
    expect(statesFor(env('lay_main', 'n_header', 'Button', 'click', 'layout'))).toEqual([])
    expect(actionsFor(env('lay_main', 'n_header', 'Button', 'click', 'layout'))).toEqual([])
  })

  it('gives an action its parameter, or the form around the node, and says why it can\'t run from here', () => {
    const publish = actionsFor(TOGGLE).find(action => action.id === 'act_publish_post')!
    const create = actionsFor(TOGGLE).find(action => action.id === 'act_create_post')!
    expect(actionUse(TOGGLE, publish)).toEqual({ how: 'param', name: 'id' })
    expect(actionUse(TOGGLE, create)).toEqual({ how: 'no', why: 'Needs a form around this element' })
    // The new-post page's Form edits a Post: the create action takes its values.
    const form = env('pg_new_post', 'n_form', 'Form', 'submit')
    expect(actionUse(form, create)).toEqual({ how: 'form' })
  })
})

describe('what a row says', () => {
  const say = (e: Env, steps: Array<Record<string, Value>>) => summarize(e, steps)

  it('words the checkbox\'s step as "Set showDrafts (Blog preferences) to the checkbox\'s value"', () => {
    expect(say(TOGGLE, [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { $event: 'checked' } }])).toBe('Set showDrafts (Blog preferences) to the checkbox\'s value')
  })

  it('words the other values', () => {
    const set = (value: Value) => say(TOGGLE, [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value }])
    expect(set(true)).toBe('Set showDrafts (Blog preferences) to on')
    expect(set(false)).toBe('Set showDrafts (Blog preferences) to off')
    expect(set({ not: { $bind: 'preferences.showDrafts' } })).toBe('Set showDrafts (Blog preferences) to the opposite of the current value')
    expect(set({ $bind: 'post.published' })).toBe('Set showDrafts (Blog preferences) to post.published')
  })

  it('says a step written by hand is one, rather than guessing what it does', () => {
    expect(say(TOGGLE, [{ kind: 'toast', title: 'Hi' }, { kind: 'setVariant', variant: 'v_hover' }])).toBe('Show “Hi”, then a step written by hand')
  })

  it('uses neither the › sign nor a dangling "its"', () => {
    const all = say(TOGGLE, [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { $event: 'checked' } }])
    expect(all).not.toMatch(/›|\bits\b/)
  })

  it('words an action, a page and a message, and joins several with "then"', () => {
    const e = env('pg_post_detail', 'n_publish', 'Button', 'click')
    expect(say(e, [
      { kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } },
      { kind: 'toast', when: 'success', title: 'Post published' },
      { kind: 'navigate', when: 'success', to: { page: 'pg_index' } }
    ])).toBe('Run Publish post, then show “Post published”, then go to index')
  })
})

describe('a stored step is written back as it was, unless it is edited', () => {
  const e = env('pg_index', 'n_head', 'Button', 'click')
  const back = (steps: Array<Record<string, Value>>, drafts: StepDraft[] = steps.map(step => draftOfStep(e, step))) => stepsOfDrafts(e, drafts, steps)

  it('keeps a stored number a number: a Go to page parameter, whose box holds text', () => {
    const step = { kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 5 } } }
    expect(back([step])).toEqual([step])
    expect(JSON.stringify(back([step]))).toBe(JSON.stringify([step]))
  })

  it('keeps the type of a fixed value whose state or field is gone', () => {
    const gone = { kind: 'setState', state: 'st_gone', field: 'count', value: 5 }
    expect(back([gone])).toEqual([gone])
    const flag = { kind: 'setState', state: 'st_gone', field: 'on', value: true }
    expect(back([flag])).toEqual([flag])
  })

  it('writes what a person typed once they edit that value', () => {
    const step = { kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 5 } } }
    const edited: StepDraft = { kind: 'navigate', page: 'pg_post_detail', params: { slug: { kind: 'fixed', text: '6' } } }
    expect(back([step], [edited])).toEqual([{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: '6' } } }])
  })

  it('keeps a stored when, and its place in the step, when the step is not edited', () => {
    const publish = env('pg_post_detail', 'n_publish', 'Button', 'click')
    const steps: Array<Record<string, Value>> = [
      { kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } },
      { kind: 'toast', when: 'success', title: 'Post published', color: 'success' }
    ]
    const drafts = steps.map(step => draftOfStep(publish, step))
    expect(JSON.stringify(stepsOfDrafts(publish, drafts, steps))).toBe(JSON.stringify(steps))
  })

  it('adds when: success only where an action comes first, and drops it where one no longer does', () => {
    const publish = env('pg_post_detail', 'n_publish', 'Button', 'click')
    const steps: Array<Record<string, Value>> = [
      { kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } },
      { kind: 'toast', when: 'success', title: 'Post published', color: 'success' }
    ]
    const drafts = steps.map(step => draftOfStep(publish, step))
    // The action removed: the message runs first, with no when.
    expect(stepsOfDrafts(publish, [drafts[1]!], steps)).toEqual([{ kind: 'toast', title: 'Post published', color: 'success' }])
    // A new step after the action gets one.
    const added: StepDraft = { kind: 'navigate', page: 'pg_index', params: {} }
    expect(stepsOfDrafts(publish, [...drafts, added], steps)[2]).toEqual({ kind: 'navigate', when: 'success', to: { page: 'pg_index' } })
  })
})

describe('a step written by hand', () => {
  const e = env('pg_index', 'n_head', 'Button', 'click')
  const hand = { kind: 'setVariant', variant: 'v_hover' }

  it('is kept whole as a draft of its own kind, and written back unchanged next to the steps that are edited', () => {
    expect(draftOfStep(e, hand)).toEqual({ kind: 'unknown', step: hand })
    const toast: StepDraft = { kind: 'toast', title: 'Edited', description: '', color: '', icon: '' }
    expect(stepsOfDrafts(e, [toast, draftOfStep(e, hand)], [{ kind: 'toast', title: 'Old' }, hand])).toEqual([{ kind: 'toast', title: 'Edited' }, hand])
  })

  it('needs nothing from the person, and no step is offered after it', () => {
    expect(draftProblems(e, [draftOfStep(e, hand)])).toEqual([[]])
    expect(addableKinds(['unknown'], 'click', 'page')).toEqual([])
    expect(addableKinds(['toast', 'unknown'], 'click', 'page')).toEqual([])
  })
})

describe('an action that takes no input', () => {
  it('can\'t be run from a node: it is listed with why, and the module refuses a step that gives it none', () => {
    const ping = { id: 'act_ping', name: 'ping', input: {} } as ActionFile
    expect(actionUse(TOGGLE, ping)).toEqual({ how: 'no', why: 'Takes no input yet' })
    // B1 and the generator both want `$form: true` or exactly one argument: an action without input has none to give.
    const path = Object.keys(files).find(file => file.endsWith('actions/publish-post.json'))!
    const publish = JSON.parse(files[path]!) as Record<string, unknown>
    const noInput = { ...files, [path]: JSON.stringify({ ...publish, input: { params: [] } }) }
    const outcome = applyEdit(noInput, 'node_interaction_update', { file: 'pg_post_detail', nodeId: 'n_publish', index: 0, expectedOn: 'click', do: [{ kind: 'runAction', action: 'act_publish_post' }] })
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining('args is { "$form": true } or the one argument') })
  })
})

describe('which step a refusal is about', () => {
  it('maps "step N (…)" to that step and drops the prefix from its text', () => {
    expect(refusalAt('step 2 (Go to page): / needs "slug" in params', 3)).toEqual({ step: 1, text: '/ needs "slug" in params' })
    expect(refusalAt('step 1: "when" is "success"', 2)).toEqual({ step: 0, text: '"when" is "success"' })
  })

  it('keeps what comes before the step, as the module wrote it', () => {
    expect(refusalAt('n_x (click) would stop working: step 1 (Set state): "a" is not something n_x can read', 1)).toEqual({ step: 0, text: 'n_x (click) would stop working: "a" is not something n_x can read' })
  })

  it('maps a refusal that is about no step, or about a step the list does not have, to the section', () => {
    expect(refusalAt('n_x already has a click interaction (index 0)', 1)).toEqual({ step: null, text: 'n_x already has a click interaction (index 0)' })
    expect(refusalAt('step 5 (Set state): no', 2)).toEqual({ step: null, text: 'step 5 (Set state): no' })
  })
})

describe('what the editor offers, the module accepts', () => {
  /** The module's own edit over the blog fixture: ok, or why not. */
  const edit = (name: EditName, input: Record<string, unknown>) => applyEdit(files, name, input)
  const accepted = (outcome: ReturnType<typeof edit>) => (outcome.ok ? 'ok' : outcome.message)

  it('takes each kind of step the editor writes for a Button of the index page, alone', () => {
    const e = env('pg_index', 'n_head', 'Button', 'click')
    const drafts: StepDraft[] = [
      { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'fixed', text: 'true' } },
      { kind: 'navigate', page: 'pg_post_detail', params: { slug: { kind: 'fixed', text: 'hello' } } },
      { kind: 'toast', title: 'Hi', description: 'There', color: 'success', icon: 'i-lucide-send' }
    ]
    for (const draft of drafts) {
      const outcome = edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'click', do: stepsOfDrafts(e, [draft]) })
      expect(accepted(outcome), draft.kind).toBe('ok')
    }
  })

  it('takes the steps of the order the editor offers: an action, then a page and a message on success', () => {
    const e = env('pg_post_detail', 'n_publish', 'Button', 'mouseenter')
    const drafts: StepDraft[] = [
      { kind: 'runAction', action: 'act_publish_post', args: { mode: 'param', name: 'id', value: { kind: 'bind', path: 'post.id' } } },
      { kind: 'navigate', page: 'pg_index', params: {} },
      { kind: 'toast', title: 'Done', description: '', color: '', icon: '' }
    ]
    expect(addableKinds(['runAction', 'navigate'], 'mouseenter', 'page')).toContain('toast')
    expect(accepted(edit('node_interaction_add', { file: 'pg_post_detail', nodeId: 'n_publish', on: 'mouseenter', do: stepsOfDrafts(e, drafts) }))).toBe('ok')
  })

  it('takes every value the picker offers for a toggle, a page parameter and a message\'s title, in the right place', () => {
    const toggle = valueModes(TOGGLE, [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'none' } }], 0)
    for (const choice of toggle.choices) {
      const draft: StepDraft = { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'bind', path: choice.path } }
      expect(accepted(edit('node_interaction_update', { file: 'pg_index', nodeId: 'n_toggle', index: 0, expectedOn: 'change', do: stepsOfDrafts(TOGGLE, [draft]) })), choice.path).toBe('ok')
    }
    // A Button inside the List sees the item: the module is asked about the page with that Button in it.
    const inserted = applyEdit(files, 'node_insert', { file: 'pg_index', parentId: 'n_card_actions', index: 1, type: 'Button', exact: true, props: { text: 'Open' } })
    if (!inserted.ok) throw new Error(inserted.message)
    const next = { ...files, ...Object.fromEntries(inserted.changes.map(change => [change.path, change.content!])) }
    const grown = loadModel(next)
    if (!grown.ok) throw new Error(JSON.stringify(grown.problems))
    const button = (inserted.result as { nodeId: string }).nodeId
    const link: Env = { ...env('pg_index', button, 'Button', 'click'), model: grown.model }
    const param = valueModes(link, [{ kind: 'navigate', page: 'pg_post_detail', params: {} }], 0, 'slug')
    expect(param.choices.map(choice => choice.path)).toEqual(expect.arrayContaining(['post.slug', 'post.title']))
    for (const choice of param.choices) {
      const draft: StepDraft = { kind: 'navigate', page: 'pg_post_detail', params: { slug: { kind: 'bind', path: choice.path } } }
      expect(accepted(applyEdit(next, 'node_interaction_add', { file: 'pg_index', nodeId: button, on: 'click', do: stepsOfDrafts(link, [draft]) })), choice.path).toBe('ok')
    }
  })

  it('refuses what the editor does not offer: a Set state on a submit, a second step after Set state', () => {
    const e = env('pg_index', 'n_head', 'Button', 'click')
    const set = stepsOfDrafts(e, [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { kind: 'fixed', text: 'true' } }, { kind: 'toast', title: 'x', description: '', color: '', icon: '' }])
    expect(accepted(edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_toggle', on: 'mouseenter', do: set }))).toContain('step 1')
    expect(addableKinds(['setState'], 'click', 'page')).toEqual([])
  })
})
