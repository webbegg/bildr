import { ICON_NAME } from '@bildr/codegen/render'
import { textProblem } from './bindings.ts'
import { fixedValue } from './interactionConversion.ts'
import { routeParams } from './interactionValues.ts'
import { actionOf, pageOf, stateAlias, targetOf, textNames } from './nodeInteractions.ts'
import { stateById, stateLabel } from './stateModel.ts'
import type { Env, NavigateDraft, RunActionDraft, SetStateDraft, StepDraft, Target, ToastDraft, ValueDraft } from './nodeInteractions.ts'

/**
 * What a draft still needs before it can be written (B3, S2): each step's problems, in the words the form shows (none: complete).
 * An interaction is written only when every step is complete, so the module never sees half a step. A step written by hand
 * needs nothing: it is kept as it was.
 */

/** Whether a value is complete: the problem a person would be told, or undefined. */
function valueProblem(draft: ValueDraft, target: Target | undefined, what: string): string | undefined {
  switch (draft.kind) {
    case 'none': return what
    case 'fixed': {
      const typed = fixedValue(target?.type ?? 'text', draft.text, target?.required)
      return 'problem' in typed ? (target?.required && draft.text.trim() === '' ? what : typed.problem) : undefined
    }
    case 'flip': return target?.self ? undefined : 'Set it to a fixed value first'
    default: return undefined
  }
}

const setStateProblems = (env: Env, step: SetStateDraft): string[] => {
  if (!step.state) return ['Choose a state']
  const state = stateById(env.model, step.state)
  if (!state) return ['This state no longer exists']
  if (!step.field) return ['Choose a field']
  if (!state.fields.some(field => field.name === step.field)) return [`${stateLabel(state)} has no field “${step.field}”`]
  if (step.value.kind === 'flip' && !stateAlias(env, state.id)) return [`This page does not use ${stateLabel(state)} yet: set it to a fixed value first`]
  const problem = valueProblem(step.value, targetOf(env, step), 'Choose a value')
  return problem ? [problem] : []
}

const runActionProblems = (env: Env, step: RunActionDraft): string[] => {
  if (!step.action) return ['Choose an action']
  const action = actionOf(env.model, step.action)
  if (!action) return ['This action no longer exists']
  const { args } = step
  if (args.mode === 'none') {
    // An action that takes no input has nothing to choose: it is run as it is.
    if (!action.input.entity && !action.input.params?.length) return []
    return [action.input.params?.length ? `Choose a value for ${action.input.params[0]!.name}` : 'Choose what it gets']
  }
  if (args.mode === 'param') {
    const problem = valueProblem(args.value, targetOf(env, step), `Choose a value for ${args.name}`)
    return problem ? [problem] : []
  }
  return []
}

const navigateProblems = (env: Env, step: NavigateDraft): string[] => {
  if (!step.page) return ['Choose a page']
  const page = pageOf(env.model, step.page)
  if (!page) return ['This page no longer exists']
  return routeParams(page).flatMap((name) => {
    const value = step.params[name] ?? { kind: 'none' as const }
    return valueProblem(value, targetOf(env, step, name), `Give a value for ${name}`) ? [`Give a value for ${name}`] : []
  })
}

const toastProblems = (env: Env, step: ToastDraft): string[] => {
  const names = textNames(env)
  const problems: string[] = []
  if (typeof step.title === 'string' ? step.title.trim() === '' : false) problems.push('Write a title')
  for (const text of [step.title, step.description]) {
    const problem = typeof text === 'string' ? textProblem(text, names) : undefined
    if (problem) problems.push(problem)
  }
  if (step.icon && !ICON_NAME.test(step.icon)) problems.push('Use an icon name like i-lucide-send')
  return problems
}

/** What each step still needs before it can be written: its problems, in the words the form shows (none: complete). */
export function draftProblems(env: Env, drafts: readonly StepDraft[]): string[][] {
  return drafts.map((step) => {
    switch (step.kind) {
      case 'setState': return setStateProblems(env, step)
      case 'runAction': return runActionProblems(env, step)
      case 'navigate': return navigateProblems(env, step)
      case 'toast': return toastProblems(env, step)
      case 'unknown': return []
    }
  })
}
