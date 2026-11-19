import type { Value } from '@bildr/codegen/model'
import { isExpression, valueText } from './bindings.ts'
import { actionOf, isOnly, pageOf } from './nodeInteractions.ts'
import type { Env, Stored } from './nodeInteractions.ts'
import { stateById, stateFieldText } from './stateModel.ts'

/**
 * What an interaction's row says (B3, S2), and which step a module refusal is about. The words are the ones a person reads, never the
 * code's: "Set showDrafts · Blog preferences to the checkbox's value", "Run Publish post, then show “Post published”".
 */

function valueWords(value: Value | undefined): string {
  if (value === undefined) return ''
  if (value === true) return 'on'
  if (value === false) return 'off'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return `“${value}”`
  if (isExpression(value)) {
    if (isOnly(value, '$event')) return 'the checkbox\'s value'
    if (isOnly(value, 'not')) return 'the opposite of the current value'
    if (typeof value.$bind === 'string') return value.$bind
    if (typeof value.$route === 'string') return `the page's ${value.$route}`
    if (typeof value.$template === 'string') return `“${value.$template}”`
  }
  return 'a value'
}

function phrase(env: Env, step: Stored): string {
  switch (step.kind) {
    case 'setState': {
      const state = stateById(env.model, String(step.state))
      const to = valueWords(step.value)
      // A State that is gone is not named by its id: the field alone says what the step sets.
      const field = state ? stateFieldText(String(step.field), state) : String(step.field)
      return `Set ${field}${to ? ` to ${to}` : ''}`
    }
    case 'runAction': {
      const action = actionOf(env.model, String(step.action))
      return `Run ${action?.label || action?.name || String(step.action)}`
    }
    case 'navigate': {
      const to = isExpression(step.to) ? step.to : {}
      return `Go to ${pageOf(env.model, String(to.page))?.name ?? String(to.page)}`
    }
    case 'toast': {
      const title = valueText(step.title as Value) || (isExpression(step.title) ? 'a message' : '')
      return `Show ${title ? `“${title}”` : 'a message'}`
    }
    default: return 'A step written by hand'
  }
}

/** What an interaction's steps say, for its row: "Set showDrafts · Blog preferences to the checkbox's value". The ones after the first read on, "then …". */
export function summarize(env: Env, steps: ReadonlyArray<Record<string, unknown>>): string {
  return steps.map((step, index) => {
    const text = phrase(env, step as Stored)
    return index === 0 ? text : `then ${text.charAt(0).toLowerCase()}${text.slice(1)}`
  }).join(', ')
}

// ── Refusals ────────────────────────────────────────────────────────────

const STEP_AT = /step (\d+)(?: \([^)]*\))?:?\s*/

/**
 * The step a module refusal is about (its messages say "step N (…)", numbered from 1) and what it says of it: the prefix is dropped,
 * what came before it stays. A refusal about no step of the list (or one it doesn't have) belongs to the whole interaction, whole.
 */
export function refusalAt(message: string, count: number): { step: number | null, text: string } {
  const found = STEP_AT.exec(message)
  const number = found ? Number(found[1]) : 0
  if (!found || number < 1 || number > count) return { step: null, text: message }
  const text = message.replace(STEP_AT, '')
  return { step: number - 1, text: text.charAt(0).toUpperCase() === text.charAt(0) || found.index > 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}` }
}
