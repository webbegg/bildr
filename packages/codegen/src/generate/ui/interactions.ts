import type { ModelNode, Value } from '../../model/schemas.ts'
import { uiStepProblems } from '../../render/rules.ts'
import { identifier } from '../text.ts'
import type { Ctx, Env } from './env.ts'
import { handlerName, itemParam, useNames } from '../names.ts'
import { actionById, expression, fail, isObject, pageById, routeLocation, use, where } from './env.ts'
import type { Attr } from './markup.ts'
import { attr, escapeAttr } from './markup.ts'

export const runAction = (env: Env, node: ModelNode, step: Record<string, Value>, ctx: Ctx) => {
  const alias = env.aliases.actions.get(String(step.action)) ?? fail(env, node, `action ${String(step.action)} isn't in the page's uses.actions`)
  use(env, `action:${alias}`, 'execute')
  const args = step.args
  // An action with no parameters and no collection input is run with nothing.
  const { input } = actionById(env, node, step.action)
  if (!input.entity && !(input.params ?? []).length) return args === undefined ? `${alias}()` : fail(env, node, 'runAction on an action that takes no input has no args')
  if (isObject(args) && args.$form === true) return `${alias}(${expression(env, node, args, ctx)})`
  const entries = isObject(args) ? Object.values(args) : []
  if (entries.length !== 1) return fail(env, node, 'runAction takes `$form: true` or one argument')
  return `${alias}(${expression(env, node, entries[0], ctx)})`
}

export const setState = (env: Env, node: ModelNode, step: Record<string, Value>) => {
  const alias = env.aliases.state.get(String(step.state)) ?? fail(env, node, `state ${String(step.state)} isn't in the page's uses.state`)
  use(env, `state:${alias}`, 'set')
  return `${useNames(alias).set}({ ${identifier(String(step.field), where(env, node))}: ${expression(env, node, step.value, 'template')} })`
}

export const EVENT_NAMES: Record<string, string> = { click: 'click', change: 'update:model-value', mouseenter: 'mouseenter', mouseleave: 'mouseleave' }

export const events = (env: Env, node: ModelNode): Attr[] => (node.interactions ?? []).map((interaction) => {
  const steps = interaction.do as Array<Record<string, Value>>
  if (interaction.on === 'submit') return attr('event', `@submit.prevent="${handler(env, node, interaction.on, steps)}"`)
  const name = EVENT_NAMES[interaction.on] ?? fail(env, node, `${interaction.on} interactions can't be generated yet`)
  if (steps.length !== 1) return attr('event', `@${name}="${handler(env, node, interaction.on, steps)}"`)
  const step = steps[0]!
  if (step.kind === 'runAction') return attr('event', `@${name}="${escapeAttr(runAction(env, node, step, 'template'))}"`)
  if (step.kind === 'setState') return attr('event', `@${name}="${escapeAttr(setState(env, node, step))}"`)
  if (step.kind === 'toast' && step.when === undefined) return attr('event', `@${name}="${escapeAttr(toast(env, node, step, 'template'))}"`)
  return attr('event', `@${name}="${handler(env, node, interaction.on, steps)}"`)
})

/** A `toast` step: Nuxt UI's `useToast`, with the title, description, colour and icon of the step. */
export const toast = (env: Env, node: ModelNode, step: Record<string, Value>, ctx: Ctx) => {
  const problem = uiStepProblems(step)[0]
  if (problem) fail(env, node, problem.message)
  env.needs.add('toast')
  const options = (['title', 'description', 'color', 'icon'] as const).filter(key => step[key] !== undefined).map(key => `${key}: ${expression(env, node, step[key], ctx)}`)
  return `toast.add({ ${options.join(', ')} })`
}

/**
 * A named script handler for a multi-step interaction: run an action, then
 * the steps that follow it when it succeeded (`when: "success"`): navigate or
 * show a toast. Without an action, the navigate and toast steps in order.
 */
export const handler = (env: Env, node: ModelNode, on: string, steps: Array<Record<string, Value>>) => {
  const name = handlerName(node.id, on)
  const unsupported = (): never => fail(env, node, `this ${on} interaction can't be generated yet`)
  const statement = (step: Record<string, Value>): { code: string, summary: string } => {
    if (step.kind === 'navigate') return { code: `await navigateTo(${routeLocation(env, node, step.to, 'script').code})`, summary: `go to ${pageById(env, node, String((step.to as Record<string, Value>).page)).path}` }
    if (step.kind === 'toast') return { code: toast(env, node, step, 'script'), summary: 'show a toast' }
    return unsupported()
  }
  const [first, ...rest] = steps
  // The List items the steps read are the template's: the handler takes them as parameters, and the template passes them.
  env.track.items = new Set()
  // A one-record query the handler reads may be empty: it returns early then, and reads it without `?.` after.
  env.optional.used.clear()
  if (first?.kind === 'runAction') {
    runAction(env, node, first, 'script')
    rest.forEach(statement)
  } else {
    steps.forEach(statement)
  }
  const guards = [...env.optional.used]
  env.optional.guarded = new Set(guards)
  const body: string[] = guards.map(name => `  if (!${name}.value) return`)
  const summaries: string[] = []
  if (first?.kind === 'runAction') {
    const run = runAction(env, node, first, 'script')
    summaries.push(`run action ${actionById(env, node, first.action).label}`)
    if (rest.some(step => step.when !== 'success')) unsupported()
    const then = rest.map(statement)
    summaries.push(...then.map(entry => entry.summary))
    body.push(...(!then.length
      ? [`  await ${run}`]
      : then.length === 1 ? [`  if (await ${run}) ${then[0]!.code}`] : [`  if (await ${run}) {`, ...then.map(entry => `    ${entry.code}`), '  }']))
  } else {
    if (steps.some(step => step.when !== undefined)) unsupported()
    const all = steps.map(statement)
    summaries.push(...all.map(entry => entry.summary))
    body.push(...all.map(entry => `  ${entry.code}`))
  }
  env.optional.guarded = new Set()
  const read = [...env.items.keys()].filter(item => env.track.items!.has(item))
  env.track.items = undefined
  const params = read.map(item => `${itemParam(item)}: ${env.items.get(item)!()}`)
  env.handlers.push([`// Interaction "${on}": ${summaries.join(', then ')}.`, `const ${name} = async (${params.join(', ')}) => {`, ...body, '}'])
  return `${name}${read.length ? `(${read.join(', ')})` : ''}`
}
