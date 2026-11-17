import type { ActionFile, Model } from '@bildr/codegen/model'
import { isObject } from '../model.ts'
import { entityById } from '../shared/dataModel.ts'
import type { FieldType } from '../shared/dataModel.ts'
import { plainCopy, sameJson } from './draftJson.ts'
import { exprOf, inputRoots, literalProblem, record, renameVar, varRoots } from './stepExpr.ts'
import type { Step } from './stepExpr.ts'
import { repositoriesOf } from './stepRepos.ts'
import type { RepoInfo } from './stepRepos.ts'
import { scopeAt } from './stepScope.ts'
import type { StepScope } from './stepScope.ts'

/**
 * The step editor's draft (S10, D10c): the Steps tab holds an action's steps and errors as a draft until Save, as the query
 * Definition holds its form (`queryDraft.ts`). The steps are the model's own values, edited in place by the forms (a form reads
 * a step the way the module stores it and builds the next one); the errors are text, as typed. `changesOf` is the
 * `action_update` input of what changed, and `problemsOf` is what the editor can tell before asking the module: it mirrors the
 * rules of the model's loader and the generator so the user is told at the card, but the module stays the authority.
 *
 * The functions here take a draft and give the next one; none changes its argument.
 */

export interface DraftStep {
  /** What the list is keyed by: it stays with the step as the list is reordered. */
  key: number
  step: Step
}

/** An error as typed: the status is text, the data is a list. */
export interface DraftError {
  type: string
  status: string
  message: string
  /** The values the error carries: a step that raises it gives each (`errorData`), and `{name}` in the message reads them. */
  data: Array<{ name: string, type: FieldType }>
}

export interface StepsDraft {
  steps: DraftStep[]
  errors: DraftError[]
}

/** What a draft is judged against: the model, the action as stored (its input and output are Overview's) and the repositories of its module. */
export interface StepsContext {
  model: Model
  action: ActionFile
  repos: RepoInfo[]
  /** The names a loaded row cannot take: bildr's own code uses them (the action's input and its collections). */
  reserved: Set<string>
}

const RESERVED = ['input', 'data', 'at', 'ok', 'err', 'now', 'undefined', 'result', 'describe', 'expect', 'it', 'Promise', 'Result']

export function contextOf(model: Model, action: ActionFile): StepsContext {
  const repos = repositoriesOf(model, action.id)
  const plurals = repos.map(repo => entityById(model, repo.entity)?.plural).filter((plural): plural is string => plural !== undefined)
  return { model, action, repos, reserved: new Set([...RESERVED, ...plurals]) }
}

const errorOf = (error: ActionFile['errors'][number]): DraftError => ({
  type: error.type,
  status: String(error.status),
  message: error.message,
  data: Object.entries(error.data ?? {}).map(([name, type]) => ({ name, type }))
})

/** The draft of an action as it is stored now. */
export const draftOf = (action: ActionFile): StepsDraft => ({
  steps: action.steps.map((step, key) => ({ key, step: plainCopy(step) as Step })),
  errors: action.errors.map(errorOf)
})

// ── What saving sends ────────────────────────────────────────────────────

/**
 * The `action_update` input of what the draft changed from `base` (the action as it was when the draft was opened or last saved):
 * `steps` when the steps differ, `errors` when the errors do. A part that did not change is not sent, so the module's refusal of
 * one never blocks the other, and an error the user did not touch is sent as it is stored.
 */
export function changesOf(draft: StepsDraft, base: ActionFile): { input: { steps?: ActionFile['steps'], errors?: ActionFile['errors'] } } {
  const input: { steps?: ActionFile['steps'], errors?: ActionFile['errors'] } = {}
  const steps = plainCopy(draft.steps.map(entry => entry.step)) as ActionFile['steps']
  if (!sameJson(steps, base.steps)) input.steps = steps
  const opened = draftOf(base).errors
  if (!sameJson(draft.errors, opened)) {
    input.errors = draft.errors.map((error) => {
      const at = opened.findIndex(original => sameJson(original, error))
      if (at >= 0) return base.errors[at]!
      return {
        type: error.type,
        status: Number(error.status),
        message: error.message,
        ...error.data.length ? { data: Object.fromEntries(error.data.map(entry => [entry.name, entry.type])) } : {}
      }
    })
  }
  return { input }
}

// ── Editing the list ─────────────────────────────────────────────────────

export type AddableKind = 'validate' | 'assert' | 'load' | 'repository' | 'return'

/**
 * The kinds a step can be added as, in the order the menu lists them (each with the hint the menu shows under it), and the ones
 * that are not generated yet (shown, and not offered). The write kind is "Write" everywhere: its card, its summary and the menu.
 */
export const ADDABLE_KINDS: Array<{ kind: AddableKind, label: string, hint: string }> = [
  { kind: 'validate', label: 'Check the input', hint: 'Checks the body against the collection\'s fields' },
  { kind: 'assert', label: 'Refuse if found', hint: 'Stops with an error if a row is found' },
  { kind: 'load', label: 'Load a row', hint: 'Reads a row, and may refuse if there is none' },
  { kind: 'repository', label: 'Write', hint: 'Creates, updates or deletes a row: the last step' },
  { kind: 'return', label: 'Return', hint: 'Ends the action, always or when a condition holds' }
]
export const NOT_GENERATED_KINDS = [{ kind: 'call', label: 'Call a service' }, { kind: 'custom', label: 'Run custom code' }] as const
export const KIND_LABELS: Record<string, string> = {
  validate: 'Check',
  assert: 'Refuse',
  load: 'Load',
  repository: 'Write',
  return: 'Return',
  call: 'Call',
  custom: 'Custom'
}
/** The kinds the editor edits: `call` and `custom` are shown and kept, and the generator does not generate them. */
export const isEditable = (step: Step): boolean => ADDABLE_KINDS.some(entry => entry.kind === step.kind)

const nextKey = (draft: StepsDraft) => draft.steps.reduce((most, entry) => Math.max(most, entry.key), -1) + 1
const mustBeLast = (step: Step | undefined) => step !== undefined && (step.kind === 'repository' || (step.kind === 'return' && step.if === true))
/** `post`, else `post2`, `post3`… the first no load of `steps` has. */
const unusedName = (name: string, steps: readonly Step[]) => {
  const taken = new Set(steps.filter(step => step.kind === 'load').map(step => step.as))
  let candidate = name
  for (let n = 2; taken.has(candidate); n++) candidate = `${name}${n}`
  return candidate
}
const camel = (name: string) => name.charAt(0).toLowerCase() + name.slice(1)

/** A new step of `kind`, as far filled as the action says: the first collection, a lookup argument the action takes by that name, a row it loaded. */
function newStep(kind: AddableKind, ctx: StepsContext, scope: StepScope, steps: readonly Step[], last: boolean): Step {
  const input = (name: string) => scope.input.some(entry => entry.path === name) ? { $input: name } : undefined
  const argsOf = (lookup: { arg: string }) => {
    const value = input(lookup.arg)
    return value ? { [lookup.arg]: value } : {}
  }
  switch (kind) {
    case 'validate': return { kind }
    case 'assert': {
      const repo = ctx.repos.find(entry => entry.lookups.length)
      const lookup = repo?.lookups.find(entry => entry.op !== 'get') ?? repo?.lookups[0]
      return { kind, unless: { repository: repo?.id ?? '', op: lookup?.op ?? '', args: lookup ? argsOf(lookup) : {} } }
    }
    case 'load': {
      const repo = ctx.repos.find(entry => entry.lookups.length)
      const lookup = repo?.lookups[0]
      return { kind, as: repo ? unusedName(camel(repo.name), steps) : '', repository: repo?.id ?? '', op: lookup?.op ?? '', args: lookup ? argsOf(lookup) : {} }
    }
    case 'repository': {
      const repo = ctx.repos.find(entry => entry.writes.length)
      const op = repo?.writes[0]
      const row = repo ? scope.vars.find(entry => entry.row === repo.entity) : undefined
      return {
        kind,
        repository: repo?.id ?? '',
        op: op ?? '',
        ...op === 'update' || op === 'delete' ? (input('id') ? { id: input('id') } : {}) : {},
        ...op === 'update' && row ? { from: { $var: row.path } } : {}
      }
    }
    case 'return': {
      const output = ctx.action.output?.entity
      const row = output ? scope.vars.find(entry => entry.row === output) ?? scope.vars.find(entry => entry.row) : undefined
      return { kind, ...last ? { if: true } : {}, ...output ? (row ? { value: { $var: row.path } } : {}) : { value: { $var: 'undefined' } } }
    }
  }
}

/** A return that gives nothing: no value, or the one value a void result takes (`{ $var: 'undefined' }`). */
const returnsNothing = (step: Step) => step.value === undefined || step.value === null || (isObject(step.value) && step.value.$var === 'undefined')

/**
 * The draft with a new step of `kind`, and where it is. A write and a return that always runs must be the last step, so any other
 * kind goes before them, and a write goes last.
 *
 * A write added after a return that always runs (the blank action's one step) cannot leave that return where it is, for a return
 * that always runs would make the write unreachable. The return is taken out when it gives nothing: it only ended the action, and
 * the write does now. A return that gives a row stays and stops being "always": its condition is cleared, and its card asks when it
 * should return, as the write is the step that returns now.
 */
export function addStep(draft: StepsDraft, kind: AddableKind, ctx: StepsContext): { draft: StepsDraft, index: number } {
  let entries = draft.steps
  const closing = entries.at(-1)?.step
  if (kind === 'repository' && closing?.kind === 'return' && closing.if === true) {
    entries = returnsNothing(closing)
      ? entries.slice(0, -1)
      : entries.map((entry, at) => at === entries.length - 1 ? { ...entry, step: Object.fromEntries(Object.entries(entry.step).filter(([name]) => name !== 'if')) as Step } : entry)
  }
  const steps = entries.map(entry => entry.step)
  const index = kind !== 'repository' && mustBeLast(steps.at(-1)) ? steps.length - 1 : steps.length
  const step = newStep(kind, ctx, scopeAt(ctx.model, ctx.action, steps, index), steps, index === steps.length)
  const next = [...entries]
  next.splice(index, 0, { key: nextKey(draft), step })
  return { draft: { ...draft, steps: next }, index }
}

export function removeStep(draft: StepsDraft, index: number): StepsDraft {
  return { ...draft, steps: draft.steps.filter((_, at) => at !== index) }
}

/** The step at `from` moved so that it is at `to` in the list that results. */
export function moveStep(draft: StepsDraft, from: number, to: number): StepsDraft {
  if (from === to || from < 0 || to < 0 || from >= draft.steps.length || to >= draft.steps.length) return draft
  const next = [...draft.steps]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return { ...draft, steps: next }
}

/** A copy of a step right after it, with a key of its own; a load's copy is named apart from the rows already loaded. */
export function duplicateStep(draft: StepsDraft, index: number): StepsDraft {
  const original = draft.steps[index]
  if (!original) return draft
  const step = plainCopy(original.step)
  if (step.kind === 'load' && typeof step.as === 'string' && step.as !== '') step.as = unusedName(step.as, draft.steps.map(entry => entry.step))
  const next = [...draft.steps]
  next.splice(index + 1, 0, { key: nextKey(draft), step })
  return { ...draft, steps: next }
}

// ── Errors ───────────────────────────────────────────────────────────────

/** The draft with a new error: `new_error`, or `new_error_2`… when taken. Anything `init` gives is kept. */
export function addError(draft: StepsDraft, init: Partial<DraftError>): StepsDraft {
  const taken = new Set(draft.errors.map(error => error.type))
  let type = init.type ?? 'new_error'
  for (let n = 2; !init.type && taken.has(type); n++) type = `new_error_${n}`
  return { ...draft, errors: [...draft.errors, { status: '422', message: '', data: [], ...init, type }] }
}

/** The draft with error `index` renamed, and the steps that raised it by the old name raising it by the new one. */
export function renameError(draft: StepsDraft, index: number, name: string): StepsDraft {
  const previous = draft.errors[index]?.type
  if (previous === undefined) return draft
  const renamed = (value: unknown) => value === previous ? name : value
  return {
    errors: draft.errors.map((error, at) => at === index ? { ...error, type: name } : error),
    steps: draft.steps.map(({ key, step }) => ({
      key,
      step: step.kind === 'assert' && step.error === previous
        ? { ...step, error: renamed(step.error) }
        : step.kind === 'load' && step.orError === previous ? { ...step, orError: renamed(step.orError) } : step
    }))
  }
}

/**
 * The draft with the row load `index` gives renamed, and the later steps that read it (`{ $var: 'post' }`, `{ $var: 'post.title' }`)
 * reading it by the new name, as `renameError` does for an error. A step before the load cannot read it, so it is left as it is.
 * It follows the name as it is typed, an empty name too.
 */
export function renameLoad(draft: StepsDraft, index: number, name: string): StepsDraft {
  const renamed = draft.steps[index]
  if (!renamed || renamed.step.kind !== 'load') return draft
  const previous = typeof renamed.step.as === 'string' ? renamed.step.as : ''
  return {
    ...draft,
    steps: draft.steps.map((entry, at) => {
      if (at === index) return { ...entry, step: { ...entry.step, as: name } }
      return at > index && previous !== name ? { ...entry, step: renameVar(entry.step, previous, name) as Step } : entry
    })
  }
}

// ── What is wrong with a draft ───────────────────────────────────────────

/** A problem the editor sees: at a step (`step`, from 0), at an error (`error`), or with the list (neither). */
export interface StepProblem {
  step?: number
  error?: number
  message: string
}

const NAME = /^[a-z][A-Za-z0-9]*$/

/** Whether a stored value is the one a form leaves for "nothing yet": absent, or an empty text. */
const unset = (value: unknown) => value === undefined || value === '' || (isObject(value) && Object.keys(value).length === 0)

/**
 * What is wrong with an error on its own, said once for the error list and for the form that adds one on a step: its name
 * (lowercase, and not one of `taken`, the names declared before it), its HTTP status, its message and what it carries.
 */
export function errorProblems(error: DraftError, taken: ReadonlySet<string>): string[] {
  const found: string[] = []
  if (!/^[a-z][a-z0-9_]*$/.test(error.type)) found.push('Use a name like “slug_taken”: lowercase letters, digits and _')
  else if (taken.has(error.type)) found.push(`“${error.type}” is already declared`)
  if (!/^\d+$/.test(error.status.trim()) || Number(error.status) < 400 || Number(error.status) > 599) found.push('The status is an HTTP error code, from 400 to 599')
  if (error.message.trim() === '') found.push('Add the message the client gets')
  error.data.forEach((entry, at) => {
    if (!NAME.test(entry.name)) found.push('Name the data like “id”: camelCase')
    else if (error.data.slice(0, at).some(other => other.name === entry.name)) found.push(`“${entry.name}” is given twice`)
  })
  return found
}

/**
 * What the editor can tell is wrong with the draft: the rules of the model's loader (`load.ts`), the generator (`generate/actions.ts`)
 * and the action's own edit (`edit/actions.ts`), said at the step or the error they are about. A draft with none is not
 * necessarily accepted: the module checks all of it again.
 */
export function problemsOf(draft: StepsDraft, ctx: StepsContext): StepProblem[] {
  const steps = draft.steps.map(entry => entry.step)
  const found: StepProblem[] = []
  const output = ctx.action.output?.entity

  steps.forEach((step, index) => {
    const here: string[] = []
    const say = (message: string) => {
      if (!here.includes(message)) here.push(message)
    }
    const scope = scopeAt(ctx.model, ctx.action, steps, index)

    /** Whether a value reads only what is in scope; and, when a literal, whether it is of the type its place takes. */
    const check = (value: unknown, name: string, type?: FieldType) => {
      for (const root of varRoots(value)) {
        if (root === 'undefined' || scope.vars.some(entry => entry.path === root)) continue
        const later = steps.findIndex((other, at) => at >= index && other.kind === 'load' && other.as === root)
        say(later >= 0 ? `Reads “${root}” before it is loaded: the step that loads it comes after (step ${later + 1})` : `“${root}” is not loaded by any step`)
      }
      for (const root of inputRoots(value)) if (!scope.input.some(entry => entry.path === root)) say(`The action does not take “${root}”: add it on the Overview tab`)
      const expr = exprOf(value)
      if (expr.kind === 'literal') {
        const wrong = literalProblem(type, expr.value)
        if (wrong) say(`${name} must be ${wrong}`)
      }
    }
    /** A required value: given, and not an empty text. */
    const need = (value: unknown, message: string, name: string, type?: FieldType) => {
      if (unset(value)) say(message)
      else check(value, name, type)
    }
    /** The collection and the way to find or write a row, as the step names them; the repository when it is known. */
    const collection = (id: unknown, pickCollection: string): RepoInfo | undefined => {
      if (typeof id !== 'string' || id === '') {
        say(pickCollection)
        return undefined
      }
      const repo = ctx.repos.find(entry => entry.id === id)
      if (!repo) say(`Unknown collection “${id}”`)
      return repo
    }
    const lookupOf = (repo: RepoInfo | undefined, op: unknown) => {
      if (!repo) return undefined
      if (typeof op !== 'string' || op === '') {
        say('Pick how to look it up')
        return undefined
      }
      const lookup = repo.lookups.find(entry => entry.op === op)
      if (!lookup) say(`${repo.name} has no lookup “${op}”`)
      return lookup
    }
    const lookup = (call: Record<string, unknown>, pickCollection: string) => {
      const repo = collection(call.repository, pickCollection)
      const found = lookupOf(repo, call.op)
      if (found) need(record(call.args)[found.arg], `Give the ${found.arg} to look up`, found.arg, found.type)
    }
    /** The error a step raises: declared, with a value for each thing it carries. */
    const raises = (type: unknown, data: unknown) => {
      if (typeof type !== 'string' || type === '') return
      const declared = draft.errors.find(error => error.type === type)
      if (!declared) return say(`The error “${type}” is not declared: add it below, or pick another`)
      for (const carried of declared.data) need(record(data)[carried.name], `Give the ${carried.name} the error carries`, carried.name, carried.type)
    }

    if (step.kind === 'validate') {
      if (!ctx.action.input.entity) say('This action takes no body to check: pick its input fields on the Overview tab')
    } else if (step.kind === 'assert') {
      lookup(record(step.unless), 'Pick the collection to look in')
      if (unset(step.error)) say('Pick the error to refuse with')
      else raises(step.error, step.errorData)
    } else if (step.kind === 'load') {
      const name = typeof step.as === 'string' ? step.as : ''
      if (name === '') say('Name the loaded row')
      else if (!NAME.test(name)) say('Use a name like “post”: letters and digits, starting with a lowercase letter')
      else if (ctx.reserved.has(name)) say(`“${name}” is a name bildr uses: pick another`)
      else if (steps.slice(0, index).some(other => other.kind === 'load' && other.as === name)) say(`“${name}” is the name of an earlier row: pick another`)
      lookup(step, 'Pick the collection to look in')
      if (!unset(step.orError)) raises(step.orError, step.errorData)
    } else if (step.kind === 'repository') {
      const repo = collection(step.repository, 'Pick the collection to write')
      const op = step.op
      if (repo && (typeof op !== 'string' || op === '')) say('Pick what to do: create, update or delete')
      else if (repo && !(repo.writes as string[]).includes(op as string)) say(`${repo.name} has no “${String(op)}” write: use create, update or delete`)
      else if (repo) {
        if (op === 'create' && !steps.slice(0, index).some(other => other.kind === 'validate')) say('Create writes the checked input: add a “Check the input” step before it')
        if (op === 'update' || op === 'delete') need(step.id, `Give the key of the row to ${String(op)}`, 'The key', repo.key)
        if (op === 'update') need(step.from, 'Pick the row to write back', 'The row')
        if (op !== 'delete') {
          for (const [field, value] of Object.entries(record(step.set))) {
            const known = repo.fields.find(entry => entry.name === field)
            if (!known) say(`${repo.name} has no field “${field}”`)
            else check(value, field, known.type)
          }
        }
      }
      if (index !== steps.length - 1) say('A write step must be the last step: the action returns its result')
    } else if (step.kind === 'return') {
      if (step.if === undefined) say('Pick when it returns: always, or when a condition holds')
      else if (step.if === false) say('A return with the condition false never runs: remove it')
      else if (step.if === true && index !== steps.length - 1) say('A return that always runs must be the last step: the steps after it would never run')
      else check(step.if, 'The condition', 'boolean')
      if (output) {
        if (returnsNothing(step)) say('This action returns a row: pick the row to return')
        else check(step.value, 'The row')
      } else if (!(isObject(step.value) && step.value.$var === 'undefined')) {
        say('This action has no output, so its return gives nothing')
      }
    }
    for (const message of here) found.push({ step: index, message })
  })

  if (steps.length === 0) found.push({ message: 'An action needs at least one step' })
  else if (!steps.some(step => step.kind === 'repository') && !(steps.at(-1)!.kind === 'return' && steps.at(-1)!.if === true)) {
    found.push({ message: 'An action needs a Write step (create, update or delete), or a last Return step that always runs, to do its work' })
  }

  draft.errors.forEach((error, index) => {
    for (const message of errorProblems(error, new Set(draft.errors.slice(0, index).map(other => other.type)))) found.push({ error: index, message })
  })
  return found
}

// ── Which step a refusal is about ────────────────────────────────────────

/**
 * What a step names, by value: the row it gives (`as`), the errors it raises, its collection (the repository id), the fields it sets
 * and every input and row it reads, with each part of a path (`post.title` is `post` and `title`). Not its keys and not its kind:
 * a refusal that quotes "repository", "return" or "if" is quoting the model's words, and names no step.
 */
function namesIn(step: Step): string[] {
  const names: string[] = []
  const take = (value: unknown) => {
    if (typeof value === 'string' && value !== '') names.push(value)
  }
  take(step.as)
  take(step.error)
  take(step.orError)
  take(step.repository)
  take(record(step.unless).repository)
  names.push(...Object.keys(record(step.set)))
  const reads = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(reads)
    else if (isObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        if ((key === '$var' || key === '$input') && typeof item === 'string') names.push(...item.split('.'))
        else reads(item)
      }
    }
  }
  reads(step)
  return names
}

const quoted = (message: string) => [...message.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1]!)

/**
 * The steps a refusal of the module names, from 0. It names one by its place (`steps.N`: from 1 in the edit's own refusals, from
 * 0 in the model's problems it quotes; `step N` in the generator's), else the steps that use a name the message quotes
 * (an error, a repository, a field).
 */
export function stepsNamed(message: string, steps: readonly DraftStep[]): number[] {
  const loader = message.startsWith('The edit would leave the model with problems')
  const found = new Set<number>()
  for (const match of message.matchAll(/\bsteps\.(\d+)/g)) found.add(loader ? Number(match[1]) : Number(match[1]) - 1)
  for (const match of message.matchAll(/\bstep (\d+) \(/g)) found.add(Number(match[1]) - 1)
  const named = [...found].filter(index => index >= 0 && index < steps.length)
  if (named.length) return named.sort((a, b) => a - b)
  const names = quoted(message)
  return steps.flatMap((entry, index) => namesIn(entry.step).some(name => names.includes(name)) ? [index] : [])
}

/** The errors whose name a refusal quotes, from 0. */
export const errorsNamed = (message: string, errors: readonly DraftError[]): number[] => {
  const names = quoted(message)
  return errors.flatMap((error, index) => names.includes(error.type) ? [index] : [])
}

// ── The action changing under a draft ────────────────────────────────────

const held = (action: ActionFile) => ({ steps: action.steps, errors: action.errors })

/** Whether the stored action differs from `base` in a part the draft holds (its steps or its errors): what Overview edits is not one. */
export const changedOutside = (base: ActionFile, action: ActionFile): boolean => !sameJson(held(base), held(action))

/**
 * The draft after the user chose to keep their edits over an action that changed under them: the part they did not touch (it
 * still reads as `base` has it) shows the stored action's, and the part they touched stays; saved against the stored action as the
 * new base, only the touched part is sent.
 */
export function rebaseDraft(draft: StepsDraft, base: ActionFile, action: ActionFile): StepsDraft {
  const before = draftOf(base)
  const now = draftOf(action)
  return {
    steps: sameJson(draft.steps.map(entry => entry.step), base.steps) ? now.steps : draft.steps,
    errors: sameJson(draft.errors, before.errors) ? now.errors : draft.errors
  }
}
