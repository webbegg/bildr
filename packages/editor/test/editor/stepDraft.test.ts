import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { ActionFile, Model } from '@bildr/codegen/model'
import { addError, addStep, changedOutside, changesOf, contextOf, draftOf, duplicateStep, moveStep, plainSteps, problemsOf, rebaseDraft, removeStep, renameError, stepsNamed } from '../../src/editor/stepDraft.ts'
import type { StepsDraft } from '../../src/editor/stepDraft.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** The step editor's draft (S10, D10c): what the Steps tab holds of an action, what saving it sends, and what it can tell before the module does. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model
const stored = (id: string): ActionFile => structuredClone(model.modules.blog!.actions.find(entry => entry.id === id)!)
const create = () => stored('act_create_post')
const publish = () => stored('act_publish_post')
/** The blank template: no output, one return that always runs. */
const blank = (): ActionFile => {
  const action = create()
  Reflect.deleteProperty(action, 'output')
  return { ...action, errors: [], steps: [{ kind: 'return', if: true, value: { $var: 'undefined' } }] }
}
const problems = (action: ActionFile, draft: StepsDraft = draftOf(action)) => problemsOf(draft, contextOf(model, action))
const messages = (action: ActionFile, draft?: StepsDraft) => problems(action, draft).map(problem => problem.message)
const withSteps = (action: ActionFile, steps: ActionFile['steps']): StepsDraft => ({ ...draftOf(action), steps: steps.map((step, key) => ({ key, step })) })

describe('draftOf and plainSteps', () => {
  it('holds the steps as they are stored, and writes them back as they were', () => {
    const action = create()
    const draft = draftOf(action)
    expect(draft.steps.map(entry => entry.step.kind)).toEqual(['validate', 'assert', 'repository'])
    expect(new Set(draft.steps.map(entry => entry.key)).size).toBe(3)
    expect(plainSteps(draft)).toEqual(action.steps)
  })

  it('holds an error\'s status as text, and its data as a list', () => {
    expect(draftOf(create()).errors).toEqual([{ type: 'slug_taken', status: '409', message: 'The slug "{slug}" is already used by another post.', data: [{ name: 'slug', type: 'text' }] }])
  })

  it('does not share the stored steps: editing the draft leaves the action alone', () => {
    const action = create()
    const draft = draftOf(action)
    ;(draft.steps[1]!.step.unless as { op: string }).op = 'other'
    expect((action.steps[1]!.unless as { op: string }).op).toBe('findBySlug')
  })
})

describe('changesOf', () => {
  it('sends nothing for a draft nobody touched', () => {
    expect(changesOf(draftOf(create()), create()).input).toEqual({})
  })

  it('sends the steps when they changed, and not the errors', () => {
    const action = publish()
    const draft = removeStep(draftOf(action), 1)
    expect(changesOf(draft, action).input).toEqual({ steps: [action.steps[0], action.steps[2]] })
  })

  it('sends the errors when they changed, with the status as a number and the untouched ones as they are stored', () => {
    const action = create()
    action.errors.push({ type: 'other', status: 404, message: 'Nope' })
    const draft = draftOf(action)
    draft.errors[1]!.status = '410'
    const { input } = changesOf(draft, action)
    expect(Object.keys(input)).toEqual(['errors'])
    expect(input.errors).toEqual([action.errors[0], { type: 'other', status: 410, message: 'Nope' }])
  })

  it('sends both parts, for an error added with the step that names it', () => {
    const action = blank()
    const added = addError(draftOf(action), { type: 'not_allowed', status: '403', message: 'Not allowed.' })
    const draft = { ...added, steps: [{ key: 9, step: { kind: 'assert', unless: { repository: 'repo_post', op: 'get', args: {} }, error: 'not_allowed' } }, ...added.steps] }
    expect(Object.keys(changesOf(draft, action).input)).toEqual(['steps', 'errors'])
    expect(changesOf(draft, action).input.errors).toEqual([{ type: 'not_allowed', status: 403, message: 'Not allowed.' }])
  })

  it('writes an error\'s data as the module takes it, and leaves it out when there is none', () => {
    const action = create()
    const draft = draftOf(action)
    draft.errors[0]!.data = [{ name: 'slug', type: 'text' }, { name: 'count', type: 'integer' }]
    expect(changesOf(draft, action).input.errors).toEqual([{ ...action.errors[0], data: { slug: 'text', count: 'integer' } }])
    draft.errors[0]!.data = []
    const [first] = changesOf(draft, action).input.errors as Array<Record<string, unknown>>
    expect('data' in first!).toBe(false)
  })
})

describe('adding a step', () => {
  it('puts a step before the return that always runs, which must stay last', () => {
    const { draft, index } = addStep(draftOf(blank()), 'load', contextOf(model, blank()))
    expect(index).toBe(0)
    expect(plainSteps(draft).map(step => step.kind)).toEqual(['load', 'return'])
  })

  it('puts a step before the repository step, which must stay last, and a repository step last', () => {
    const action = create()
    const ctx = contextOf(model, action)
    const added = addStep(draftOf(action), 'assert', ctx)
    expect(plainSteps(added.draft).map(step => step.kind)).toEqual(['validate', 'assert', 'assert', 'repository'])
    expect(added.index).toBe(2)
    const writing = addStep(draftOf(publish()), 'repository', contextOf(model, publish()))
    expect(plainSteps(writing.draft).map(step => step.kind)).toEqual(['load', 'return', 'repository', 'repository'])
  })

  it('starts a load on the first collection, named after it, with the lookup argument the action takes already given', () => {
    const action = blank()
    const { draft } = addStep(draftOf(action), 'load', contextOf(model, action))
    expect(plainSteps(draft)[0]).toEqual({ kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } })
  })

  it('names a new load apart from the ones before it', () => {
    const action = publish()
    const { draft } = addStep(draftOf(action), 'load', contextOf(model, action))
    expect(plainSteps(draft).filter(step => step.kind === 'load').map(step => step.as)).toEqual(['post', 'post2'])
  })

  it('starts a repository step on its first write, with the key it takes already given', () => {
    const action = blank()
    const { draft } = addStep(draftOf(action), 'repository', contextOf(model, action))
    expect(plainSteps(draft).at(-1)).toEqual({ kind: 'repository', repository: 'repo_post', op: 'create' })
  })

  it('starts an assert on a lookup that is not by key when there is one, and a return that always runs with nothing to return', () => {
    const action = blank()
    const ctx = contextOf(model, action)
    expect(plainSteps(addStep(draftOf(action), 'assert', ctx).draft)[0]).toEqual({ kind: 'assert', unless: { repository: 'repo_post', op: 'findBySlug', args: { slug: { $input: 'slug' } } } })
    // Before the repository step it is an early return, which waits for its condition; last, it always runs.
    expect(plainSteps(addStep(draftOf(publish()), 'return', contextOf(model, publish())).draft)[2]).toEqual({ kind: 'return', value: { $var: 'post' } })
    expect(plainSteps(addStep({ ...draftOf(action), steps: [] }, 'return', ctx).draft)).toEqual([{ kind: 'return', if: true, value: { $var: 'undefined' } }])
  })

  it('gives each step a key of its own', () => {
    const action = create()
    const { draft } = addStep(draftOf(action), 'validate', contextOf(model, action))
    expect(new Set(draft.steps.map(entry => entry.key)).size).toBe(4)
  })
})

describe('moving, duplicating and removing a step', () => {
  it('moves a step to a place, and keeps what it is', () => {
    const draft = draftOf(create())
    const moved = moveStep(draft, 0, 2)
    expect(plainSteps(moved).map(step => step.kind)).toEqual(['assert', 'repository', 'validate'])
    expect(moved.steps.map(entry => entry.key)).toEqual([draft.steps[1]!.key, draft.steps[2]!.key, draft.steps[0]!.key])
  })

  it('does not move a step out of the list', () => {
    const draft = draftOf(create())
    expect(moveStep(draft, 0, -1)).toEqual(draft)
    expect(moveStep(draft, 2, 3)).toEqual(draft)
    expect(moveStep(draft, 1, 1)).toEqual(draft)
  })

  it('duplicates a step right after it, with a key of its own, and a load under a name of its own', () => {
    const draft = duplicateStep(draftOf(publish()), 0)
    expect(plainSteps(draft).map(step => step.kind)).toEqual(['load', 'load', 'return', 'repository'])
    expect(plainSteps(draft)[1]!.as).toBe('post2')
    expect(new Set(draft.steps.map(entry => entry.key)).size).toBe(4)
    const copy = duplicateStep(draftOf(create()), 1)
    expect(plainSteps(copy)[2]).toEqual(plainSteps(copy)[1])
  })

  it('removes a step', () => {
    expect(plainSteps(removeStep(draftOf(create()), 1)).map(step => step.kind)).toEqual(['validate', 'repository'])
  })
})

describe('errors', () => {
  it('adds one under a name no error has, and the steps may name it', () => {
    const draft = addError(draftOf(create()), {})
    expect(draft.errors.map(error => error.type)).toEqual(['slug_taken', 'new_error'])
    expect(addError(draft, {}).errors.map(error => error.type)).toEqual(['slug_taken', 'new_error', 'new_error_2'])
  })

  it('renames an error and the steps that name it follow', () => {
    const draft = renameError(draftOf(create()), 0, 'slug_in_use')
    expect(draft.errors[0]!.type).toBe('slug_in_use')
    expect(plainSteps(draft)[1]!.error).toBe('slug_in_use')
    const load = renameError(draftOf(publish()), 0, 'gone')
    expect(plainSteps(load)[0]!.orError).toBe('gone')
  })
})

describe('what is wrong with a draft', () => {
  it('finds nothing wrong with the actions the project has', () => {
    expect(problems(create())).toEqual([])
    expect(problems(publish())).toEqual([])
    expect(problems(blank())).toEqual([])
  })

  it('finds a variable used before a step defines it, and one no step defines', () => {
    const action = publish()
    const early = withSteps(action, [action.steps[1]!, action.steps[0]!, action.steps[2]!])
    expect(problems(action, early)).toEqual([{ step: 0, message: 'Reads “post” before it is loaded: the step that loads it comes after (step 2)' }])
    const unknown = withSteps(action, [action.steps[0]!, { kind: 'return', if: true, value: { $var: 'ghost' } }])
    expect(problems(action, unknown)).toEqual([{ step: 1, message: '“ghost” is not loaded by any step' }])
  })

  it('finds an input the action does not take', () => {
    const action = create()
    const steps = structuredClone(action.steps)
    ;(steps[1]!.unless as { args: Record<string, unknown> }).args = { slug: { $input: 'nope' } }
    expect(problems(action, withSteps(action, steps))).toEqual([{ step: 1, message: 'The action does not take “nope”: add it on the Overview tab' }])
  })

  it('finds an error a step names that is not declared', () => {
    const action = create()
    const draft = draftOf(action)
    draft.errors = []
    expect(problems(action, draft)).toEqual([{ step: 1, message: 'The error “slug_taken” is not declared: add it below, or pick another' }])
    const loadAction = publish()
    const loading = draftOf(loadAction)
    loading.errors = []
    expect(problems(loadAction, loading)).toEqual([{ step: 0, message: 'The error “post_not_found” is not declared: add it below, or pick another' }])
  })

  it('finds a required field that is empty, on the step that has it', () => {
    const action = blank()
    const steps: ActionFile['steps'] = [
      { kind: 'assert', unless: { repository: '', op: '', args: {} } },
      { kind: 'load', as: '', repository: 'repo_post', op: 'get', args: {} },
      { kind: 'repository', repository: 'repo_post', op: 'update' }
    ]
    expect(problems(action, withSteps(action, steps))).toEqual([
      { step: 0, message: 'Pick the collection to look in' },
      { step: 0, message: 'Pick the error to refuse with' },
      { step: 1, message: 'Name the loaded row' },
      { step: 1, message: 'Give the id to look up' },
      { step: 2, message: 'Give the key of the row to update' },
      { step: 2, message: 'Pick the row to write back' }
    ])
  })

  it('finds a lookup that the collection does not have, and a write it does not allow', () => {
    const action = blank()
    const steps: ActionFile['steps'] = [
      { kind: 'load', as: 'post', repository: 'repo_post', op: 'findByNothing', args: {} },
      { kind: 'repository', repository: 'repo_post', op: 'list' }
    ]
    expect(messages(action, withSteps(action, steps))).toEqual(expect.arrayContaining(['Post has no lookup “findByNothing”', 'Post has no “list” write: use create, update or delete']))
  })

  it('finds a name given to two rows, and one the use-case already uses', () => {
    const action = publish()
    const steps: ActionFile['steps'] = [
      { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
      { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
      { kind: 'load', as: 'input', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
      { kind: 'load', as: 'a b', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
      { kind: 'return', if: true, value: { $var: 'post' } }
    ]
    const found = problems(action, withSteps(action, steps)).filter(problem => problem.step !== undefined && problem.step < 4)
    expect(found).toEqual([
      { step: 1, message: '“post” is the name of an earlier row: pick another' },
      { step: 2, message: '“input” is used by the generated code: pick another name' },
      { step: 3, message: 'Use a name like “post”: letters and digits, starting with a lowercase letter' }
    ])
  })

  it('finds a literal that is not of the type of the field it is for', () => {
    const action = create()
    const steps = structuredClone(action.steps)
    ;(steps[2] as Record<string, unknown>).set = { published: 'yes', title: 4 }
    expect(problems(action, withSteps(action, steps)).map(problem => problem.message)).toEqual(['published must be true or false', 'title must be text'])
  })

  it('wants a create to be after a step that checks the input, and a check to have a body to check', () => {
    const action = blank()
    expect(messages(action, withSteps(action, [{ kind: 'repository', repository: 'repo_post', op: 'create' }]))).toEqual(['Create writes the checked input: add a “Checks the input” step before it'])
    const noBody = publish()
    expect(messages(noBody, withSteps(noBody, [{ kind: 'validate' }, ...noBody.steps]))).toEqual(['This action takes no body to check: pick its input fields on the Overview tab'])
  })

  it('wants a return that always runs to be last, one that never runs to go, and a return with a condition to have one', () => {
    const action = blank()
    const steps: ActionFile['steps'] = [
      { kind: 'return', if: true, value: { $var: 'undefined' } },
      { kind: 'return', if: false, value: { $var: 'undefined' } },
      { kind: 'return', value: { $var: 'undefined' } },
      { kind: 'repository', repository: 'repo_post', op: 'delete', id: { $input: 'id' } }
    ]
    expect(problems(action, withSteps(action, steps)).filter(problem => problem.step !== undefined && problem.step < 3).map(problem => [problem.step, problem.message])).toEqual([
      [0, 'A return that always runs must be the last step: the steps after it would never run'],
      [1, 'A return with the condition false never runs: remove it'],
      [2, 'Pick when it returns: always, or when a condition holds']
    ])
  })

  it('wants the one return of a return-only action to be last and always run', () => {
    const action = blank()
    const early = withSteps(action, [{ kind: 'return', if: { $input: 'published' }, value: { $var: 'undefined' } }])
    expect(problems(action, early)).toEqual([{ message: 'An action needs a “repository” step (create, update or delete), or a last “return” step that always runs, to do its work' }])
    expect(problems(action, withSteps(action, []))).toEqual([{ message: 'An action needs at least one step' }])
  })

  it('wants a repository step to be last', () => {
    const action = create()
    const steps = [action.steps[2]!, action.steps[0]!]
    expect(problems(action, withSteps(action, steps))).toContainEqual({ step: 0, message: 'A repository step must be the last step: the use-case returns its result' })
  })

  it('wants a return to give a row when the action returns one, and nothing when it does not', () => {
    const withOutput = publish()
    const steps: ActionFile['steps'] = [withOutput.steps[0]!, { kind: 'return', if: { $var: 'post.published' }, value: { $var: 'undefined' } }, withOutput.steps[2]!]
    expect(messages(withOutput, withSteps(withOutput, steps))).toEqual(['This action returns a row: pick the row to return'])
    const without = blank()
    expect(messages(without, withSteps(without, [{ kind: 'return', if: true, value: { $var: 'post' } }]))).toContain('This action has no output, so its return gives nothing')
  })

  it('says nothing of the steps that are not generated yet', () => {
    const action = blank()
    expect(problems(action, withSteps(action, [{ kind: 'call', service: 'mail' }, ...action.steps]))).toEqual([])
  })

  it('finds an error with a name, a status or a message the module will not take, and one declared twice', () => {
    const action = create()
    const draft = draftOf(action)
    draft.errors = [
      { type: 'Bad Name', status: '409', message: 'x', data: [] },
      { type: 'slug_taken', status: '200', message: 'x', data: [] },
      { type: 'slug_taken', status: 'abc', message: '', data: [] },
      { type: 'ok_one', status: '404', message: 'x', data: [{ name: 'Bad', type: 'text' }, { name: 'id', type: 'text' }, { name: 'id', type: 'text' }] }
    ]
    expect(problems(action, draft).filter(problem => problem.error !== undefined).map(problem => [problem.error, problem.message])).toEqual([
      [0, 'Use a name like “slug_taken”: lowercase letters, digits and _'],
      [1, 'The status is an HTTP error code, from 400 to 599'],
      [2, '“slug_taken” is declared twice'],
      [2, 'The status is an HTTP error code, from 400 to 599'],
      [2, 'Add the message the client gets'],
      [3, 'Name the data like “id”: camelCase'],
      [3, '“id” is given twice']
    ])
  })
})

describe('stepsNamed', () => {
  const steps = [{ key: 0, step: { kind: 'validate' } }, { key: 1, step: { kind: 'assert', error: 'slug_taken', unless: { repository: 'repo_post', op: 'get', args: {} } } }, { key: 2, step: { kind: 'repository', repository: 'repo_post', op: 'create' } }]

  it('finds the step the module names by number (steps.N counts from 1 in its own refusals, from 0 in the model\'s problems)', () => {
    expect(stepsNamed('steps.2: this action returns nothing', steps)).toEqual([1])
    expect(stepsNamed('The edit would leave the model with problems: steps.1: A "repository" step must be the last step (.bildr/x.json)', steps)).toEqual([1])
    expect(stepsNamed('act_create_post: step 3 ("call") is not generated yet', steps)).toEqual([2])
  })

  it('finds the steps that use a name the message quotes, when it names no step', () => {
    expect(stepsNamed('act_x: the error "slug_taken" is not declared in the action\'s errors', steps)).toEqual([1])
    expect(stepsNamed('Unknown repository "repo_post"', steps)).toEqual([1, 2])
  })

  it('finds none for a message about something else', () => {
    expect(stepsNamed('input: Post has no field "nope"', steps)).toEqual([])
  })
})

describe('the action changing under a draft', () => {
  it('is a change when the steps or the errors differ, and not for what the draft does not hold', () => {
    const action = create()
    const base = create()
    expect(changedOutside(base, action)).toBe(false)
    expect(changedOutside(base, { ...action, label: 'Other', description: 'x', input: { entity: 'ent_post', pick: ['id'] } })).toBe(false)
    expect(changedOutside(base, { ...action, steps: [action.steps[0]!, action.steps[2]!] })).toBe(true)
    expect(changedOutside(base, { ...action, errors: [] })).toBe(true)
  })

  it('shows the stored part the user did not touch, and keeps the part they did', () => {
    const base = create()
    const draft = removeStep(draftOf(base), 0)
    const now = create()
    now.errors = [{ type: 'slug_taken', status: 409, message: 'Taken elsewhere.', data: { slug: 'text' } }]
    now.steps = [...now.steps, { kind: 'call' }]
    const rebased = rebaseDraft(draft, base, now)
    expect(plainSteps(rebased).map(step => step.kind)).toEqual(['assert', 'repository'])
    expect(rebased.errors[0]!.message).toBe('Taken elsewhere.')
    const untouched = rebaseDraft(draftOf(base), base, now)
    expect(plainSteps(untouched).map(step => step.kind)).toEqual(['validate', 'assert', 'repository', 'call'])
  })
})
