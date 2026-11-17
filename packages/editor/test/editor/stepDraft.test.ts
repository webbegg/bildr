import { describe, expect, it } from 'vitest'
import { applyEdit } from '@bildr/codegen/edit'
import { loadModel, serializeModel } from '@bildr/codegen/model'
import type { ActionFile, Model } from '@bildr/codegen/model'
import { ADDABLE_KINDS, addError, addStep, changedOutside, changesOf, contextOf, draftOf, duplicateStep, errorProblems, moveStep, problemsOf, rebaseDraft, removeStep, renameError, renameLoad, stepsNamed } from '../../src/editor/stepDraft.ts'
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
const plainSteps = (draft: StepsDraft) => draft.steps.map(entry => entry.step)
type StepFile = ActionFile['steps'][number]

describe('draftOf', () => {
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

  describe('a write added to an action whose last step is a return that always runs', () => {
    const blankWith = (...steps: ActionFile['steps']) => withSteps(blank(), [...steps, { kind: 'return', if: true, value: { $var: 'undefined' } }])
    const load: StepFile = { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } }

    it('replaces the bare return when it is the only step: it only ended the action, and the write does', () => {
      const { draft, index } = addStep(draftOf(blank()), 'repository', contextOf(model, blank()))
      expect(plainSteps(draft).map(step => step.kind)).toEqual(['repository'])
      expect(index).toBe(0)
      expect(draft.steps).toHaveLength(1)
    })

    it('drops a bare return after other steps, too, so the write is the last step', () => {
      const { draft, index } = addStep(blankWith(load), 'repository', contextOf(model, blank()))
      expect(plainSteps(draft).map(step => step.kind)).toEqual(['load', 'repository'])
      expect(index).toBe(1)
      expect(problemsOf(draft, contextOf(model, blank())).map(problem => problem.message)).not.toContain('A return that always runs must be the last step: the steps after it would never run')
    })

    it('keeps a return that gives a row, as an early return that asks when it should run', () => {
      const action = publish()
      const draft = withSteps(action, [action.steps[0]!, { kind: 'return', if: true, value: { $var: 'post' } }])
      const added = addStep(draft, 'repository', contextOf(model, action))
      expect(plainSteps(added.draft).map(step => step.kind)).toEqual(['load', 'return', 'repository'])
      expect(added.index).toBe(2)
      expect(plainSteps(added.draft)[1]).toEqual({ kind: 'return', value: { $var: 'post' } })
      expect(problemsOf(added.draft, contextOf(model, action)).filter(problem => problem.step === 1).map(problem => problem.message)).toEqual(['Pick when it returns: always, or when a condition holds'])
    })

    it('leaves an early return, and a list that does not end in a return that always runs, as they are', () => {
      const action = blank()
      const early = withSteps(action, [{ kind: 'return', if: { $input: 'published' }, value: { $var: 'undefined' } }])
      expect(plainSteps(addStep(early, 'repository', contextOf(model, action)).draft).map(step => step.kind)).toEqual(['return', 'repository'])
    })
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

describe('renaming a load', () => {
  it('renames the row and what the later steps read of it: the row, and its fields', () => {
    const draft = renameLoad(draftOf(publish()), 0, 'article')
    const [load, back, write] = plainSteps(draft)
    expect(load!.as).toBe('article')
    expect(back).toMatchObject({ if: { $var: 'article.published' }, value: { $var: 'article' } })
    expect(write).toMatchObject({ from: { $var: 'article' } })
    expect(problemsOf(draft, contextOf(model, publish()))).toEqual([])
  })

  it('leaves the steps before the load, other rows, plain text and the rest of the step as they are', () => {
    const action = publish()
    const steps: ActionFile['steps'] = [
      { kind: 'assert', unless: { repository: 'repo_post', op: 'get', args: { id: { $var: 'post' } } }, error: 'post_not_found', note: 'post' },
      { kind: 'load', as: 'other', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
      { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } }, orError: 'post_not_found' },
      { kind: 'repository', repository: 'repo_post', op: 'update', id: { $input: 'id' }, from: { $var: 'post' }, set: { title: 'post', slug: { $var: 'other.slug' }, body: { if: { $var: 'post.published' }, then: 'x', else: { $var: 'post.body' } } } }
    ]
    const [first, second, load, write] = plainSteps(renameLoad(withSteps(action, steps), 2, 'article'))
    expect(first).toEqual(steps[0])
    expect(second).toEqual(steps[1])
    expect(load).toEqual({ ...steps[2], as: 'article' })
    expect(write).toEqual({ kind: 'repository', repository: 'repo_post', op: 'update', id: { $input: 'id' }, from: { $var: 'article' }, set: { title: 'post', slug: { $var: 'other.slug' }, body: { if: { $var: 'article.published' }, then: 'x', else: { $var: 'article.body' } } } })
  })

  describe('with two loads, `post` and `posts`', () => {
    const twoLoads = (): StepsDraft => withSteps(publish(), [
      { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
      { kind: 'load', as: 'posts', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } },
      { kind: 'return', if: { $var: 'post.published' }, value: { $var: 'post' } },
      { kind: 'repository', repository: 'repo_post', op: 'update', id: { $input: 'id' }, from: { $var: 'posts' }, set: { title: { $var: 'posts.title' } } }
    ])

    it('renames the later load to a free name: its readers follow, the first load\'s are unchanged', () => {
      const [first, second, firstRead, secondRead] = plainSteps(renameLoad(twoLoads(), 1, 'items'))
      expect(first).toMatchObject({ as: 'post' })
      expect(second).toMatchObject({ as: 'items' })
      expect(firstRead).toMatchObject({ if: { $var: 'post.published' }, value: { $var: 'post' } })
      expect(secondRead).toMatchObject({ from: { $var: 'items' }, set: { title: { $var: 'items.title' } } })
    })

    it('does not rename the readers when the new name is the name of another load: the duplicate shows, and nothing binds to the wrong row', () => {
      const draft = renameLoad(twoLoads(), 1, 'post')
      const [, second, firstRead, secondRead] = plainSteps(draft)
      expect(second).toMatchObject({ as: 'post' })
      expect(firstRead).toMatchObject({ if: { $var: 'post.published' }, value: { $var: 'post' } })
      expect(secondRead).toMatchObject({ from: { $var: 'posts' }, set: { title: { $var: 'posts.title' } } })
      expect(messages(publish(), draft)).toContain('“post” is the name of an earlier row: pick another')
    })

    it('does not rename the readers to or from an empty name, and leaves them to say they are not loaded', () => {
      const cleared = renameLoad(twoLoads(), 0, '')
      expect(plainSteps(cleared)[0]).toMatchObject({ as: '' })
      expect(plainSteps(cleared)[2]).toMatchObject({ if: { $var: 'post.published' }, value: { $var: 'post' } })
      const named = renameLoad(cleared, 0, 'article')
      expect(plainSteps(named)[0]).toMatchObject({ as: 'article' })
      expect(plainSteps(named)[2]).toMatchObject({ if: { $var: 'post.published' }, value: { $var: 'post' } })
      expect(messages(publish(), named)).toContain('“post” is not loaded by any step')
    })
  })

  it('does not change the draft it is given, nor a step that is not a load', () => {
    const draft = draftOf(publish())
    renameLoad(draft, 0, 'article')
    expect(plainSteps(draft)[0]!.as).toBe('post')
    expect(renameLoad(draft, 2, 'article')).toBe(draft)
    expect(renameLoad(draft, 9, 'article')).toBe(draft)
  })
})

describe('errorProblems', () => {
  const error = (patch: Partial<ReturnType<typeof draftOf>['errors'][number]> = {}) => ({ type: 'slug_taken', status: '409', message: 'Taken.', data: [], ...patch })

  it('finds nothing wrong with an error that has a name, a status and a message', () => {
    expect(errorProblems(error(), new Set())).toEqual([])
  })

  it('says what is wrong with each part, and a name that is taken', () => {
    expect(errorProblems(error({ type: 'Slug Taken' }), new Set())).toEqual(['Use a name like “slug_taken”: lowercase letters, digits and _'])
    expect(errorProblems(error(), new Set(['slug_taken']))).toEqual(['“slug_taken” is already declared'])
    expect(errorProblems(error({ status: '200' }), new Set())).toEqual(['The status is an HTTP error code, from 400 to 599'])
    expect(errorProblems(error({ status: 'abc', message: ' ' }), new Set())).toEqual(['The status is an HTTP error code, from 400 to 599', 'Add the message the client gets'])
    expect(errorProblems(error({ data: [{ name: 'Bad', type: 'text' }, { name: 'id', type: 'text' }, { name: 'id', type: 'text' }] }), new Set())).toEqual(['Name the data like “id”: camelCase', '“id” is given twice'])
  })

  it('is what problemsOf says at each declared error, with the names declared before it as the taken ones', () => {
    const action = create()
    const draft = draftOf(action)
    draft.errors = [error({ message: '' }), error({ type: 'other', status: '1' }), error()]
    const at = (index: number) => problemsOf(draft, contextOf(model, action)).filter(problem => problem.error === index).map(problem => problem.message)
    expect(at(0)).toEqual(errorProblems(draft.errors[0]!, new Set()))
    expect(at(1)).toEqual(errorProblems(draft.errors[1]!, new Set(['slug_taken'])))
    expect(at(2)).toEqual(errorProblems(draft.errors[2]!, new Set(['slug_taken', 'other'])))
  })
})

describe('what the Add step menu says of each kind', () => {
  it('has a hint for each, in words a person reads: no repository, no use-case, no generated code', () => {
    expect(ADDABLE_KINDS.map(entry => entry.label)).toEqual(['Check the input', 'Refuse if found', 'Load a row', 'Write', 'Return'])
    for (const entry of ADDABLE_KINDS) {
      expect(entry.hint.length).toBeGreaterThan(10)
      expect(`${entry.label} ${entry.hint}`).not.toMatch(/repositor|use-case|generated/i)
    }
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
      { step: 2, message: '“input” is a name bildr uses: pick another' },
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
    expect(messages(action, withSteps(action, [{ kind: 'repository', repository: 'repo_post', op: 'create' }]))).toEqual(['Create writes the checked input: add a “Check the input” step before it'])
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
    expect(problems(action, early)).toEqual([{ message: 'An action needs a Write step (create, update or delete), or a last Return step that always runs, to do its work' }])
    expect(problems(action, withSteps(action, []))).toEqual([{ message: 'An action needs at least one step' }])
  })

  it('wants a write step to be last', () => {
    const action = create()
    const steps = [action.steps[2]!, action.steps[0]!]
    expect(problems(action, withSteps(action, steps))).toContainEqual({ step: 0, message: 'A write step must be the last step: the action returns its result' })
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
      [2, '“slug_taken” is already declared'],
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

  it('names no step for the loader\'s message about the list, which quotes only the words of the model (repository, return, if), never a step\'s keys', () => {
    const message = 'The edit would leave the model with problems: steps: An action needs a "repository" step (create, update or delete), or a last "return" step that always runs ("if": true), to do its work (.bildr/modules/blog/actions/create-post.json)'
    const action = create()
    const every = [...draftOf(action).steps, { key: 9, step: { kind: 'return', if: true, value: { $var: 'post' } } }, { key: 10, step: { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } }, orError: 'gone' } }]
    expect(stepsNamed(message, every)).toEqual([])
  })

  it('finds the steps by what they hold, a name or an id, and not by a key or a kind', () => {
    const action = publish()
    const held = draftOf(action).steps
    expect(stepsNamed('Row "post" is not loaded', held)).toEqual([0])
    expect(stepsNamed('Unknown "repo_post"', held)).toEqual([0, 2])
    expect(stepsNamed('Field "published" is not a field of Post', held)).toEqual([])
    expect(stepsNamed('a "return" and an "if" and a "load" and a "kind" and a "set"', held)).toEqual([])
  })

  describe('a name that many steps hold', () => {
    const many = (): StepsDraft['steps'] => withSteps(publish(), [
      { kind: 'validate' },
      { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } }, orError: 'post_not_found' },
      { kind: 'assert', unless: { repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } }, error: 'slug_taken' },
      { kind: 'repository', repository: 'repo_post', op: 'update', id: { $input: 'id' }, from: { $var: 'post' }, set: { id: { $input: 'id' }, title: 'x' } }
    ]).steps

    it('prefers the step that is called by it: its row, an error it raises, or its collection', () => {
      expect(stepsNamed('Row "post" is not loaded', many())).toEqual([1])
      expect(stepsNamed('The error "slug_taken" is not declared', many())).toEqual([2])
      expect(stepsNamed('The error "post_not_found" is not declared', many())).toEqual([1])
      expect(stepsNamed('Unknown repository "repo_post"', many())).toEqual([1, 2, 3])
    })

    it('names no step for a common field name that many steps read or set, so the message is shown at the top', () => {
      expect(stepsNamed('input: "id" must be text', many())).toEqual([])
    })

    it('names the step that is called by the name, among the ones that read it', () => {
      const steps = [...many(), { key: 9, step: { kind: 'load', as: 'id', repository: 'repo_post', op: 'get', args: {} } }]
      expect(stepsNamed('input: "id" must be text', steps)).toEqual([4])
    })

    it('still finds the one step that holds a name', () => {
      expect(stepsNamed('Field "title" is not a field of Post', many())).toEqual([3])
    })
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

// ── The editor's rules and the module's ──────────────────────────────────

/**
 * The editor says what is wrong before it asks (`problemsOf`), and the module is the authority (`action_update` through
 * `applyEdit`). These tables keep the two from drifting apart without a word: a draft the editor accepts is one the module
 * accepts (or the user is refused at Save for something the card never said), and a draft the module accepts is one the editor
 * lets through (or the editor is stricter than the module, and a user cannot save what is fine). The other way, a draft the
 * editor refuses and the module takes, is not a drift: the editor says more than the module does (a row read before it is loaded,
 * a field of the wrong type), and its table says which.
 */
describe('the editor\'s rules and the module\'s', () => {
  const files = serializeModel(model)
  const blankFiles = (() => {
    const outcome = applyEdit(files, 'action_create', { entity: 'ent_post', template: 'blank', name: 'archive post' })
    if (!outcome.ok) throw new Error(outcome.message)
    const next = { ...files }
    for (const change of outcome.changes) if (change.content !== null) next[change.path] = change.content
    return next
  })()
  const loadedBlank = loadModel(blankFiles)
  if (!loadedBlank.ok) throw new Error(JSON.stringify(loadedBlank.problems))
  /** The project's model, and the same with a blank action the module made (no output, one return that always runs). */
  const worlds = {
    project: { files, model, action: (id: string) => stored(id) },
    blank: { files: blankFiles, model: loadedBlank.model, action: (id: string) => structuredClone(loadedBlank.model.modules.blog!.actions.find(entry => entry.id === id)!) }
  }
  type World = keyof typeof worlds

  /** What the module does with a draft's steps and errors as `action_update` takes them. */
  const moduleSays = (world: World, action: ActionFile, draft: StepsDraft) => {
    const { input } = changesOf(draft, action)
    const outcome = applyEdit(worlds[world].files, 'action_update', { action: action.id, steps: draft.steps.map(entry => entry.step), errors: input.errors ?? action.errors })
    return outcome.ok ? 'accepted' : outcome.message
  }
  const editorSays = (world: World, action: ActionFile, draft: StepsDraft) => problemsOf(draft, contextOf(worlds[world].model, action)).map(problem => problem.message)
  const ret: StepFile = { kind: 'return', if: true, value: { $var: 'undefined' } }
  const load: StepFile = { kind: 'load', as: 'post', repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } }
  const ARCHIVE = 'act_archive_post'
  const write = (op: string, rest: Record<string, unknown> = {}): StepFile => ({ kind: 'repository', repository: 'repo_post', op, ...rest })

  type Row = [name: string, world: World, id: string, draft: (action: ActionFile) => StepsDraft]
  /** Representative drafts of what a person builds in the tab, each valid. */
  const valid: Row[] = [
    ['an action as the project has it: create', 'project', 'act_create_post', action => draftOf(action)],
    ['an action as the project has it: publish, with a value the editor does not edit', 'project', 'act_publish_post', action => draftOf(action)],
    ['a blank action as it starts', 'blank', ARCHIVE, action => draftOf(action)],
    ['a load and an update on a blank action', 'blank', ARCHIVE, action => withSteps(action, [load, write('update', { id: { $input: 'id' }, from: { $var: 'post' } })])],
    ['a check, then a create that sets a field', 'blank', ARCHIVE, action => withSteps(action, [{ kind: 'validate' }, write('create', { set: { title: 'Untitled', published: false } })])],
    ['a delete by the key', 'blank', ARCHIVE, action => withSteps(action, [write('delete', { id: { $input: 'id' } })])],
    ['a refuse by the key, with an error declared with the steps', 'blank', ARCHIVE, action => ({
      ...addError({ ...draftOf(action), steps: [] }, { type: 'not_allowed', status: '403', message: 'Not allowed.' }),
      steps: [{ key: 0, step: { kind: 'assert', unless: { repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } }, error: 'not_allowed' } }, { key: 1, step: ret }]
    })],
    ['a load that carries on without the row, then an early return and a write', 'project', 'act_publish_post', action => withSteps(action, [{ ...load, orError: undefined }, { kind: 'return', if: { $var: 'post.published' }, value: { $var: 'post' } }, action.steps[2]!])],
    ['an early return before the one that always runs', 'blank', ARCHIVE, action => withSteps(action, [{ kind: 'return', if: { $input: 'published' }, value: { $var: 'undefined' } }, ret])],
    ['an error with a status and a message edited', 'project', 'act_create_post', (action) => {
      const draft = draftOf(action)
      draft.errors[0]!.status = '422'
      draft.errors[0]!.message = 'Taken.'
      return draft
    }]
  ]
  it.each(valid)('is accepted by both: %s', (_name, world, id, make) => {
    const action = worlds[world].action(id)
    const draft = make(action)
    expect(editorSays(world, action, draft)).toEqual([])
    expect(moduleSays(world, action, draft)).toBe('accepted')
  })

  /** Drafts that are wrong, each refused by the editor and by the module (the words are each side\'s own). */
  const wrong: Row[] = [
    ['no step at all', 'blank', ARCHIVE, action => withSteps(action, [])],
    ['a write that is not last', 'project', 'act_create_post', action => withSteps(action, [action.steps[2]!, action.steps[0]!])],
    ['a return that always runs and is not last', 'blank', ARCHIVE, action => withSteps(action, [ret, write('delete', { id: { $input: 'id' } })])],
    ['a collection no repository of the module has', 'blank', ARCHIVE, action => withSteps(action, [write('delete', { repository: 'repo_gone', id: { $input: 'id' } })])],
    ['an error no declared error names', 'project', 'act_create_post', action => ({ ...draftOf(action), errors: [] })],
    ['a return that gives nothing in an action that returns a row', 'project', 'act_publish_post', action => withSteps(action, [action.steps[0]!, ret])],
    ['a status that is not an HTTP error', 'project', 'act_create_post', (action) => {
      const draft = draftOf(action)
      draft.errors[0]!.status = '200'
      return draft
    }]
  ]
  it.each(wrong)('is refused by both: %s', (_name, world, id, make) => {
    const action = worlds[world].action(id)
    const draft = make(action)
    expect(editorSays(world, action, draft).length).toBeGreaterThan(0)
    expect(moduleSays(world, action, draft)).not.toBe('accepted')
  })
})
