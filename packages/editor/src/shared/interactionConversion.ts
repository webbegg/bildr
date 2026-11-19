import type { Value } from '@bildr/codegen/model'
import { boundPaths, isExpression, isReadableBinding, textValue, valueText } from './bindings.ts'
import type { FieldType } from './dataModel.ts'
import { isOnly, stateAlias, targetOf, textNames } from './nodeInteractions.ts'
import type { Env, Stored, StepDraft, Target, TextDraft, ValueDraft } from './nodeInteractions.ts'

/**
 * A step as the module stores it, and as a draft: every part of it a string a box holds (`draftOfStep`), and back
 * (`stepsOfDrafts`). A draft that is not complete yet (`draftProblems`) is not written, so the module never sees half a step.
 *
 * Writing back is faithful: a step that is not edited is written as it was stored, not as the form would write it (its keys in
 * the order they were, a `when` that was there, a number the box would hold as text). A step counts as not edited when the form
 * writes the same thing for it as for the step it came from (`stepsOfDrafts`' `previous`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/** A fixed value typed in a box, as the field type holds it, or why it can't be one. `required`: an empty text is no value (a parameter). */
export function fixedValue(type: FieldType, text: string, required = false): { value: Value } | { problem: string } {
  const typed = text.trim()
  switch (type) {
    case 'boolean': return typed === 'true' ? { value: true } : typed === 'false' ? { value: false } : { problem: 'Choose On or Off' }
    case 'integer': return /^[+-]?\d+$/.test(typed) ? { value: Number(typed) } : { problem: 'Use a whole number' }
    case 'number': return typed !== '' && Number.isFinite(Number(typed)) ? { value: Number(typed) } : { problem: 'Use a number' }
    case 'date': return DATE.test(typed) ? { value: typed } : { problem: 'Use a date like 2026-01-31' }
    case 'datetime': return DATETIME.test(typed) ? { value: typed } : { problem: 'Use a date and time like 2026-01-31T09:30:00Z' }
    case 'uuid': return UUID.test(typed) ? { value: typed } : { problem: 'Use an id like 123e4567-e89b-12d3-a456-426614174000' }
    default: return required && typed === '' ? { problem: 'Give a value' } : { value: text }
  }
}

// ── Values ──────────────────────────────────────────────────────────────

function valueDraftOf(value: Value | undefined, self?: string): ValueDraft {
  if (value === undefined) return { kind: 'none' }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return { kind: 'fixed', text: String(value) }
  if (isExpression(value)) {
    if (isOnly(value, '$event') && value.$event === 'checked') return { kind: 'event' }
    if (isOnly(value, 'not') && isExpression(value.not) && isOnly(value.not, '$bind') && self !== undefined && value.not.$bind === self) return { kind: 'flip' }
    if (isOnly(value, '$bind') && typeof value.$bind === 'string') return { kind: 'bind', path: value.$bind }
    if (isOnly(value, '$route') && typeof value.$route === 'string') return { kind: 'route', name: value.$route }
  }
  return { kind: 'other', value }
}

export function valueOut(draft: ValueDraft, target: Target | undefined): Value | undefined {
  switch (draft.kind) {
    case 'none': return undefined
    case 'event': return { $event: 'checked' }
    case 'fixed': {
      const typed = fixedValue(target?.type ?? 'text', draft.text, target?.required)
      return 'value' in typed ? typed.value : undefined
    }
    case 'flip': return target?.self ? { not: { $bind: target.self } } : undefined
    case 'bind': return { $bind: draft.path }
    case 'route': return { $route: draft.name }
    case 'other': return draft.value
  }
}

// ── Messages' text ──────────────────────────────────────────────────────

/** A message's text as a box holds it. An expression a box can't hold (a binding with a fallback, or text that holds a `{name}` it would bind) is kept whole. */
function textIn(value: Value | undefined, names: string[]): TextDraft {
  if (value === undefined) return ''
  if (typeof value === 'string') return boundPaths(value, names).length ? { keep: value } : value
  if (isExpression(value) && Object.keys(value).length === 1 && isReadableBinding(value, names)) return valueText(value)
  return { keep: value }
}

/** The text a box holds as the value it means: a name in it is a template, even when it is the whole text (a template is always text). */
function textOut(draft: TextDraft, names: string[]): Value | undefined {
  if (typeof draft !== 'string') return draft.keep
  if (draft === '') return undefined
  const value = textValue(draft, names)
  return isExpression(value) && '$bind' in value ? { $template: draft } : value ?? undefined
}

// ── Stored ⇄ draft ──────────────────────────────────────────────────────

export function draftOfStep(env: Env, given: Record<string, unknown>): StepDraft {
  const step = given as Stored
  switch (step.kind) {
    case 'setState': {
      const state = String(step.state ?? '')
      const field = String(step.field ?? '')
      const alias = stateAlias(env, state)
      return { kind: 'setState', state, field, value: valueDraftOf(step.value, alias ? `${alias}.${field}` : undefined) }
    }
    case 'runAction': {
      const args = step.args
      const action = String(step.action ?? '')
      if (isExpression(args) && isOnly(args, '$form') && args.$form === true) return { kind: 'runAction', action, args: { mode: 'form' } }
      const entries = isExpression(args) ? Object.entries(args) : []
      if (entries.length === 1) return { kind: 'runAction', action, args: { mode: 'param', name: entries[0]![0], value: valueDraftOf(entries[0]![1]) } }
      return { kind: 'runAction', action, args: args === undefined ? { mode: 'none' } : { mode: 'other', value: args } }
    }
    case 'navigate': {
      const to = isExpression(step.to) ? step.to : {}
      const params = isExpression(to.params) ? to.params : {}
      return { kind: 'navigate', page: typeof to.page === 'string' ? to.page : '', params: Object.fromEntries(Object.entries(params).map(([name, value]) => [name, valueDraftOf(value)])) }
    }
    case 'toast': {
      const names = textNames(env)
      return { kind: 'toast', title: textIn(step.title, names), description: textIn(step.description, names), color: typeof step.color === 'string' ? step.color : '', icon: typeof step.icon === 'string' ? step.icon : '' }
    }
    default: return { kind: 'unknown', step }
  }
}

function stepOut(env: Env, draft: StepDraft, names: string[]): Stored {
  switch (draft.kind) {
    case 'setState': {
      const value = valueOut(draft.value, targetOf(env, draft))
      return { kind: 'setState', state: draft.state, field: draft.field, ...(value !== undefined ? { value } : {}) }
    }
    case 'runAction': {
      const { args } = draft
      const written: Value = args.mode === 'form'
        ? { $form: true }
        : args.mode === 'param' ? { [args.name]: valueOut(args.value, targetOf(env, draft)) ?? null } : args.mode === 'other' ? args.value : {}
      return { kind: 'runAction', action: draft.action, args: written }
    }
    case 'navigate': {
      const params = Object.fromEntries(Object.entries(draft.params).flatMap(([name, value]) => {
        const written = valueOut(value, targetOf(env, draft, name))
        return written === undefined ? [] : [[name, written] as const]
      }))
      return { kind: 'navigate', to: { page: draft.page, ...(Object.keys(params).length ? { params } : {}) } }
    }
    case 'toast': {
      const title = textOut(draft.title, names)
      const description = textOut(draft.description, names)
      return { kind: 'toast', ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}), ...(draft.color ? { color: draft.color } : {}), ...(draft.icon ? { icon: draft.icon } : {}) }
    }
    case 'unknown': return draft.step
  }
}

const withoutWhen = (step: Stored): Stored => Object.fromEntries(Object.entries(step).filter(([key]) => key !== 'when'))

/**
 * The steps as the module stores them: each step after an action runs `when: "success"`, and no other has a `when`. `previous` is
 * the steps the drafts were made from: a draft that writes what one of them would is that step, as it was stored (a hand-written
 * step is always its own), with its `when` only where the order needs one.
 */
export function stepsOfDrafts(env: Env, drafts: readonly StepDraft[], previous: readonly Stored[] = []): Stored[] {
  const names = textNames(env)
  const afterAction = drafts[0]?.kind === 'runAction'
  const originals = previous.map(step => ({ step, written: JSON.stringify(stepOut(env, draftOfStep(env, step), names)) }))
  return drafts.map((draft, index) => {
    const out = stepOut(env, draft, names)
    const base = originals.find(entry => entry.written === JSON.stringify(out))?.step ?? out
    if (draft.kind === 'unknown') return base
    const when = afterAction && index > 0 ? 'success' : undefined
    if (base.when === when) return base
    return when ? { ...withoutWhen(base), when } : withoutWhen(base)
  })
}
