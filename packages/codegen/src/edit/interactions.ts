import { z } from 'zod'
import { ArtifactIdSchema, INTERACTION_EVENTS, LocalIdSchema, UiStepSchema } from '../model/schemas.ts'
import type { ActionFile, ModelNode, PageFile, StateFile, Value } from '../model/schemas.ts'
import { BUTTON_COLORS, uiStepProblems } from '../render/rules.ts'
import { defineEdit, EditError, fail, isObject } from './core.ts'
import type { Draft, Tree } from './core.ts'
import { entityNameOf, fits } from './entities.ts'
import { checkExpression, describeTyped, describeValue, expectValue, formOf, primOf, typeOfValue } from './expressions.ts'
import type { ExpressionContext, ExpressionKind } from './expressions.ts'
import { dropUnusedUses, freeAlias, moduleOfPage, pageNameProblem, useAction } from './queries.ts'
import type { UseRef } from './queries.ts'
import { findNode, walk } from './tree.ts'

/**
 * Interactions on any node (B1, S2): "when <event> → steps", on the nodes of a page, a layout or a component (the variant
 * interactions of a component, `component_interaction_*`, are another list: the component's own, which switch variants). The steps
 * are the ones `generate/ui/` turns into code, and each add or update is refused for anything it would leave out, fail on, or
 * silently ignore:
 *
 * - `setState {state, field, value}`, `runAction {action, args}`, `navigate {to: {page, params}}` and `toast {title, …}`; `setVariant` is not generated.
 *   `args` of a `runAction` is `{ $form: true }`, the one argument the action takes, or none at all: an action with neither parameters
 *   nor a collection input is run with nothing (`alias()`), and is refused any `args`; an action that needs input is refused a missing one.
 * - Events: click, change, submit, mouseenter, mouseleave; `appear` is not generated. Only a Button, a Checkbox and a Form get events.
 * - One step is an inline handler (`@click="setX({ … })"`); several steps, or a submit, are a script handler that runs an action, then
 *   the navigate and toast steps that follow when it worked (`when: "success"`), or navigate and toast steps in order.
 * - `{ "$event": "checked" }` is the value of a Checkbox's change, in the inline handler only.
 * - A page that doesn't use the state or action a step names gets the use in the same edit (`addedUses`). Layouts and components
 *   have no uses: a step there only navigates or shows a message.
 * - The other way round: an update or a remove that leaves no step naming a state or action the page uses, and nothing binding the
 *   state's name or showing the action in a Form, drops that use in the same edit (`droppedUses`), so `state_delete` is not held by
 *   a use that does nothing. The model can't tell a use an interaction added from one `page_use_add` made, so any use of a state or
 *   action the removed steps named that nothing reads or runs goes: the generator skips a use nothing reads anyway. The action
 *   descriptions say so: "a page use nothing else reads is removed with the last step that needed it".
 * - `node_interaction_update` and `node_interaction_remove` take the event the caller saw at that index (`expectedOn`, `on`): when
 *   the interaction there is another, it changed since the caller opened it, and the edit is refused.
 * - A value is checked against what receives it (`expectValue`): a state field, a toast's text, a route parameter, an action's
 *   parameter, an action on a collection (a row of it, or the form's), each by what the value is in the generated TypeScript. A
 *   handler the script declares gets the List items it reads from the template (`generate/ui/interactions.ts`).
 */

/** The events each node type the generator attaches events to (`events()` in generate/ui/interactions.ts) takes. */
const EVENTS_OF: Record<string, readonly string[]> = {
  Button: ['click', 'mouseenter', 'mouseleave'],
  Checkbox: ['click', 'change', 'mouseenter', 'mouseleave'],
  Form: ['click', 'submit', 'mouseenter', 'mouseleave']
}

const KEYS: Record<string, readonly string[]> = {
  setState: ['kind', 'state', 'field', 'value'],
  runAction: ['kind', 'action', 'args'],
  navigate: ['kind', 'to', 'when'],
  toast: ['kind', 'title', 'description', 'color', 'icon', 'when']
}

type Step = Record<string, Value>

/** How a step reads in a refusal: "step 2 (Set state)", numbered from 1 as the editor lists them. */
const STEP_NAMES: Record<string, string> = { setState: 'Set state', runAction: 'Run action', navigate: 'Go to page', toast: 'Show message', setVariant: 'Set variant' }
const stepName = (step: Step): string => STEP_NAMES[String(step.kind)] ?? String(step.kind)
const at = (index: number): string => `step ${index + 1}`
const atStep = (step: Step, index: number): string => `${at(index)} (${stepName(step)})`

const FileRef = ArtifactIdSchema.describe('The artifact id of a page, component or layout (pg_*, cmp_*, lay_*)')
const Event = z.enum(INTERACTION_EVENTS).describe('click, change (a Checkbox), submit (a Form), mouseenter or mouseleave; appear is not generated yet')
const Steps = z.array(UiStepSchema).min(1).max(10).describe('The steps, in order: Set state { kind: "setState", state, field, value }, Run action { kind: "runAction", action, args? } (no args for an action that takes no input), Go to page { kind: "navigate", to: { page, params? } }, Show message { kind: "toast", title, description?, color?, icon? }. After an action, further Go to page and Show message steps take when: "success". setVariant is not generated yet')

/** The nodes from the tree's root down to node `id`, inclusive. */
const chainTo = (root: ModelNode, id: string): ModelNode[] => {
  if (root.id === id) return [root]
  for (const child of root.children ?? []) {
    const chain = chainTo(child, id)
    if (chain.length) return [root, ...chain]
  }
  return []
}

const nodeOf = (tree: Tree, nodeId: string): ModelNode => findNode(tree.root, nodeId) ?? fail('not_found', `Node "${nodeId}" not found in ${tree.file}`)

const notGenerated = (message: string): never => fail('invalid', `${message}: not generated yet`)

/** Refuses an event the node can't get: `appear`, a node type the generator attaches no events to, and an event its type has no use for. */
const checkEvent = (node: ModelNode, on: string) => {
  if (on === 'appear') notGenerated('"appear" interactions')
  const events = EVENTS_OF[node.type]
  if (!events) notGenerated(`${node.id} is a ${node.type}, and only ${Object.keys(EVENTS_OF).join(', ')} nodes get interactions`)
  if (!events!.includes(on)) fail('invalid', `A ${node.type} has no "${on}" event here (${events!.join(', ')})`)
}

interface Check {
  draft: Draft
  tree: Tree
  node: ModelNode
  on: string
  added: UseRef[]
}

/** Makes the page use the state of a step, under its name or the first free one, unless it does. */
const useState = (check: Check, page: PageFile, state: StateFile) => {
  const existing = page.uses?.state?.find(use => use.state === state.id)
  if (existing) return
  const as = freeAlias(check.draft, page, state.name, 'state')
  ;((page.uses ??= {}).state ??= []).push({ as, state: state.id })
  check.added.push({ as, state: state.id })
}

const stateOf = (draft: Draft, page: PageFile, id: unknown): StateFile => {
  const { mod } = moduleOfPage(draft, page)
  return mod.state.find(entry => entry.id === id) ?? fail('not_found', `No state "${String(id)}" in the page's module`)
}

const actionOf = (draft: Draft, page: PageFile, id: unknown): ActionFile => {
  const { mod } = moduleOfPage(draft, page)
  return mod.actions.find(entry => entry.id === id) ?? fail('not_found', `No action "${String(id)}" in the page's module`)
}

/** One step is an inline handler (`@click="setX({ … })"`); several, or a submit, are a script handler. */
const isInline = (steps: Step[], on: string): boolean => steps.length === 1 && on !== 'submit'

/** The steps that go together, and which of them can run on this event (what `events()` and `handler()` generate). */
const checkOrder = (steps: Step[], on: string, inline: boolean) => {
  const [first] = steps
  if (first!.when !== undefined) fail('invalid', `The first step takes no "when": it is the one that runs first`)
  steps.forEach((step, index) => {
    if (step.when !== undefined && step.when !== 'success') fail('invalid', `${at(index)}: "when" is "success" (the step runs when the action worked)`)
    if (step.when !== undefined && !KEYS[String(step.kind)]!.includes('when')) fail('invalid', `${at(index)}: a ${stepName(step)} step takes no "when"`)
  })
  if (inline) return
  const [, ...rest] = steps
  const why = on === 'submit' ? 'a submit' : 'several steps'
  if (first!.kind === 'runAction') {
    rest.forEach((step, index) => {
      if (step.kind !== 'navigate' && step.kind !== 'toast') notGenerated(`${at(index + 1)}: after an action, ${why} can only go to a page or show a message, not a ${stepName(step)} step`)
      if (step.when !== 'success') fail('invalid', `${at(index + 1)}: a step after an action runs when it worked: say "when": "success"`)
    })
    return
  }
  steps.forEach((step, index) => {
    if (step.kind === 'setState') notGenerated(`${at(index)}: a ${stepName(step)} step can't be one of several steps, or on a submit (${why}): it is a handler that runs an action, then goes to a page or shows a message`)
    if (step.kind === 'runAction') notGenerated(`${at(index)}: a ${stepName(step)} step has to come first when there are several steps`)
    if (step.when !== undefined) fail('invalid', `${at(index)}: "when" follows an action: without one the steps run in order`)
  })
}

const stepKeys = (step: Step, index: number) => {
  const keys = KEYS[String(step.kind)] ?? notGenerated(`${at(index)}: a ${stepName(step)} step`)
  const extra = Object.keys(step).find(key => !keys.includes(key))
  if (extra) fail('invalid', `${at(index)}: "${extra}" is not part of a ${stepName(step)} step (${keys.join(', ')})`)
}

const checkSetState = (check: Check, context: ExpressionContext, step: Step, where: string) => {
  if (check.tree.kind !== 'page') notGenerated(`${where}: ${check.tree.kind === 'layout' ? 'a layout' : 'a component'} has no state to set (pages use state)`)
  const page = check.tree.owner as PageFile
  const state = stateOf(check.draft, page, step.state)
  if (state.shape !== 'single') notGenerated(`${where}: the state ${state.name} has several rows`)
  const field = state.fields.find(entry => entry.name === step.field) ?? fail('invalid', `${where}: the state ${state.name} has no field "${String(step.field)}" (${state.fields.map(entry => entry.name).join(', ')})`)
  const value = step.value
  checkExpression(context, value, `${where} value`)
  // A select holds one of its options, which the generated setter types as their union: an expression can't be checked against them (verify B3).
  if (field!.type === 'select' && isObject(value)) fail('invalid', `${where}: ${state.name}.${field!.name} is one of ${(field!.options ?? []).join(', ')}: set it to one of them`)
  if (!isObject(value) && !fits(field!.type, value!, false, field!.options)) fail('invalid', `${where}: ${JSON.stringify(value)} doesn't fit ${state.name}.${field!.name} (${field!.type})`)
  // What the value is against what the field holds: the setter takes a partial row, so unset passes, null only for a nullable field.
  expectValue(context, value, where, `${state.name}.${field!.name} (${field!.type})`, { prims: [primOf(field!.type)], null: !!field!.nullable, undef: true })
}

const checkRunAction = (check: Check, context: ExpressionContext, step: Step, where: string) => {
  if (check.tree.kind !== 'page') notGenerated(`${where}: ${check.tree.kind === 'layout' ? 'a layout' : 'a component'} runs no actions (pages use them)`)
  const page = check.tree.owner as PageFile
  const action = actionOf(check.draft, page, step.action)
  const args = step.args
  // An action with neither parameters nor a collection input is run with nothing: `alias()`. Args it can't read would be dropped or break the call.
  if (!action.input.entity && !(action.input.params ?? []).length) {
    if (args !== undefined) fail('invalid', `${where}: ${action.name} takes no input, so the step has no args`)
    return
  }
  if (!isObject(args)) return fail('invalid', `${where}: args is { "$form": true } or the one argument the action takes, like { "id": … }`)
  if ('$form' in args) {
    if (Object.keys(args).length !== 1 || args.$form !== true) fail('invalid', `${where}: the form is { "$form": true }`)
    checkExpression(context, args, `${where} args`)
    if (!action.input.entity) fail('invalid', `${where}: ${action.name} takes route params, not a form's values: give { "<param>": value }`)
    const edited = context.form ? formOf(check.draft, context.form).entity : undefined
    if (edited && edited.id !== action.input.entity) fail('invalid', `${where}: the form edits ${edited.name}, but ${action.name} takes ${entityNameOf(check.draft, action.input.entity)}`)
    return
  }
  const entries = Object.entries(args)
  if (entries.length !== 1) fail('invalid', `${where}: args is { "$form": true } or exactly one argument (the generator passes one)`)
  const [name, value] = entries[0]!
  const params = action.input.params ?? []
  if (params.length) {
    if (params.length !== 1) notGenerated(`${where}: ${action.name} takes ${params.length} parameters, and only actions with one are run from a node`)
    const param = params[0]!
    if (name !== param.name) fail('invalid', `${where}: ${action.name} takes "${param.name}", not "${name}"`)
    checkExpression(context, value, `${where} ${name}`)
    if (!isObject(value) && !fits(param.type, value, false)) fail('invalid', `${where}: ${JSON.stringify(value)} doesn't fit the parameter ${param.name} (${param.type})`)
    // `run(id: string)`: one plain value of the parameter's kind, never null or unset.
    expectValue(context, value, `${where} ${name}`, `the parameter ${param.name} (${param.type})`, { prims: [primOf(param.type)] })
  } else if (action.input.entity) {
    // The body of an action on a collection is a whole row of it: a row of that collection, or the form's.
    checkExpression({ ...context, scalar: false }, value, `${where} ${name}`)
    const type = typeOfValue(context, value)
    if (type && (type.shape !== 'row' || type.entity !== action.input.entity)) {
      fail('invalid', `${where}: ${action.name} takes one whole row of ${entityNameOf(check.draft, action.input.entity)} (a row of it the page reads, or { "$form": true }), but ${describeValue(value)} is ${describeTyped(check.draft, type)}`)
    }
  }
}

const checkNavigate = (check: Check, context: ExpressionContext, step: Step, where: string) => {
  const to = step.to
  if (!isObject(to) || typeof to.page !== 'string') return fail('invalid', `${where}: navigate takes to: { page, params? }, like { "page": "pg_index" }`)
  const extra = Object.keys(to).find(key => key !== 'page' && key !== 'params')
  if (extra) fail('invalid', `${where}: "${extra}" is not part of to (page, params)`)
  const { page } = check.draft.page(to.page)
  const needed = page.path.split('/').filter(segment => segment.startsWith(':')).map(segment => segment.slice(1))
  const params = to.params
  if (params !== undefined && !isObject(params)) fail('invalid', `${where}: params is { "<name>": value }`)
  const given = Object.keys(isObject(params) ? params : {})
  const missing = needed.filter(name => !given.includes(name))
  if (missing.length) fail('invalid', `${where}: ${page.path} needs ${missing.map(name => `"${name}"`).join(', ')} in params`)
  const unknown = given.find(name => !needed.includes(name))
  if (unknown) fail('invalid', `${where}: ${page.path} has no parameter "${unknown}"${needed.length ? ` (${needed.join(', ')})` : ''}`)
  for (const [name, value] of Object.entries(isObject(params) ? params : {})) {
    checkExpression(context, value, `${where} ${name}`)
    // A route's params are text or a number, and a named route needs each one.
    expectValue(context, value, `${where} ${name}`, `the route parameter ${name}`, { prims: ['string', 'number'] })
  }
}

const checkToast = (context: ExpressionContext, step: Step, where: string) => {
  const problem = uiStepProblems(step)[0]
  if (problem) fail('invalid', `${where}: ${problem.message}`)
  for (const key of ['title', 'description', 'color', 'icon']) if (step[key] !== undefined) checkExpression(context, step[key], `${where} ${key}`)
  // The title, description and icon are text (Nuxt UI's toast leaves them out when unset). The colour is one of a fixed set of words, so a bound value can't be it.
  for (const key of ['title', 'description', 'icon']) if (step[key] !== undefined) expectValue(context, step[key], `${where} ${key}`, `a toast ${key}`, { prims: ['string'], undef: true })
  if (step.color !== undefined && typeof step.color !== 'string') fail('invalid', `${where} color: a toast colour is one of ${BUTTON_COLORS.join(', ')}, written out: ${describeValue(step.color)} is a value that is only known later`)
}

/** Refuses steps the generator can't turn into code, or can't put in this order: what each kind takes, and what goes with what. No uses are made. */
const checkShape = (steps: Step[], on: string, inline: boolean) => {
  steps.forEach((step, index) => {
    if (step.kind === 'setVariant') notGenerated(`${at(index)}: a ${stepName(step)} step (a component's variants switch with component_interaction_add)`)
    stepKeys(step, index)
  })
  checkOrder(steps, on, inline)
}

/** Makes the page use the state or action each step names (a layout or component has no uses), adding what it made to `check.added`. */
const addUses = (check: Check, steps: Step[]) => {
  const { draft, tree } = check
  if (tree.kind !== 'page') return
  const page = tree.owner as PageFile
  for (const step of steps) {
    if (step.kind === 'setState') useState(check, page, stateOf(draft, page, step.state))
    if (step.kind === 'runAction') {
      const action = actionOf(draft, page, step.action)
      const had = page.uses?.actions?.some(use => use.action === action.id)
      const as = useAction(draft, page, action.id)
      if (!had && as) check.added.push({ as, action: action.id })
    }
  }
}

/** Refuses a step whose values the node can't read, or that isn't the kind the step takes. Reads the page's uses: `addUses` goes first. */
const checkValues = (check: Check, steps: Step[], inline: boolean) => {
  const { draft, tree, node, on } = check
  const chain = chainTo(tree.root, node.id)
  const allow: ExpressionKind[] = ['bind', 'not', 'route', 'form', 'template', ...(inline && on === 'change' && node.type === 'Checkbox' ? ['event' as const] : [])]
  const context: ExpressionContext = {
    draft, file: tree.file, kind: tree.kind, nodeId: node.id, allow: new Set(allow), subject: node.id, scalar: true,
    form: [...chain].reverse().find(entry => entry.type === 'Form')
  }
  steps.forEach((step, index) => {
    const where = atStep(step, index)
    if (step.kind === 'setState') checkSetState(check, context, step, where)
    else if (step.kind === 'runAction') checkRunAction(check, context, step, where)
    else if (step.kind === 'navigate') checkNavigate(check, context, step, where)
    else checkToast(context, step, where)
  })
}

/**
 * Checks `steps` for `on` of `node`, makes the page use what they name (a value may read the name a step's state or action is used
 * under, so the uses come before the values), and returns them as they are stored. Everything is done to the draft: a refusal leaves
 * the model as it was.
 */
const prepareSteps = (check: Check, given: Array<Record<string, unknown>>): Step[] => {
  const steps = structuredClone(given) as Step[]
  const inline = isInline(steps, check.on)
  checkShape(steps, check.on, inline)
  addUses(check, steps)
  checkValues(check, steps, inline)
  return steps
}

/** Refuses a page whose script would declare a name twice (a handler named like a use, a derived name meeting another). */
const checkPageNames = (draft: Draft, tree: Tree) => {
  if (tree.kind !== 'page') return
  const problem = pageNameProblem(draft, tree.owner as PageFile)
  if (problem) fail('invalid', problem)
}

/**
 * Checks every interaction of a page's nodes again, against the draft as it is: an edit that changes what the steps read (a computed
 * value's kind) must not leave one that no longer generates. A refusal names the node and the event.
 */
export const recheckInteractions = (draft: Draft, page: PageFile): void => {
  const tree = draft.tree(page.id)
  walk(tree.root, (node) => {
    for (const interaction of node.interactions ?? []) {
      try {
        prepareSteps({ draft, tree, node, on: interaction.on, added: [] }, interaction.do as Array<Record<string, unknown>>)
      } catch (error) {
        if (error instanceof EditError) throw new EditError(error.code, `${node.id} (${interaction.on}) would stop working: ${error.message}`)
        throw error
      }
    }
  })
}

/** The ids of the states and actions steps name. */
const usedBy = (steps: ReadonlyArray<Record<string, unknown>>) => ({
  state: new Set(steps.flatMap(step => step.kind === 'setState' && typeof step.state === 'string' ? [step.state] : [])),
  action: new Set(steps.flatMap(step => step.kind === 'runAction' && typeof step.action === 'string' ? [step.action] : []))
})

const duplicate = (node: ModelNode, on: string, self?: number) => {
  const index = (node.interactions ?? []).findIndex((entry, i) => i !== self && entry.on === on)
  if (index !== -1) fail('invalid', `${node.id} already has a ${on} interaction (index ${index}): change it with node_interaction_update`)
}

/** Adds `on` → `steps` to `node` of `tree`, checked as `node_interaction_add` checks them (a refusal throws, the draft may be part done). */
export const addInteraction = (draft: Draft, tree: Tree, node: ModelNode, on: z.infer<typeof Event>, steps: Array<Record<string, unknown>>) => {
  checkEvent(node, on)
  duplicate(node, on)
  const check: Check = { draft, tree, node, on, added: [] }
  const stored = prepareSteps(check, steps)
  const list = node.interactions ??= []
  list.push({ on, do: stored as never })
  checkPageNames(draft, tree)
  return { index: list.length - 1, addedUses: check.added }
}

export const nodeInteractionAdd = defineEdit({
  input: z.object({ file: FileRef, nodeId: LocalIdSchema, on: Event, do: Steps }),
  apply: (draft, { file, nodeId, on, do: steps }) => {
    const tree = draft.tree(file)
    return addInteraction(draft, tree, nodeOf(tree, nodeId), on, steps)
  }
})

/** The interaction at `index` of `node`; refused when there is none, or when it isn't the one (`seen`) the caller says it opened. */
const interactionAt = (node: ModelNode, index: number, seen?: string) => {
  const found = node.interactions?.[index] ?? fail('not_found', `${node.id} has no interaction at index ${index}`)
  if (seen !== undefined && found.on !== seen) fail('invalid', `${node.id}'s interaction at index ${index} is "${found.on}", not "${seen}": it changed since you opened it`)
  return found
}

export const nodeInteractionUpdate = defineEdit({
  input: z.object({
    file: FileRef,
    nodeId: LocalIdSchema,
    index: z.int().nonnegative().describe('Its position in the node\'s interactions'),
    on: Event.optional().describe('The new event'),
    expectedOn: Event.optional().describe('The event the caller saw at this index (the editor always sends it): when the interaction there is another, it changed since it was opened and nothing is written'),
    do: Steps.optional().describe('Replaces the steps whole')
  }),
  apply: (draft, { file, nodeId, index, on, expectedOn, do: steps }) => {
    if (on === undefined && steps === undefined) fail('invalid', 'Give the event (on) or the steps (do) to change')
    const tree = draft.tree(file)
    const node = nodeOf(tree, nodeId)
    const current = interactionAt(node, index, expectedOn)
    const event = on ?? current.on
    checkEvent(node, event)
    duplicate(node, event, index)
    const check: Check = { draft, tree, node, on: event, added: [] }
    const stored = prepareSteps(check, steps ?? current.do)
    const before = usedBy(current.do as Array<Record<string, unknown>>)
    node.interactions![index] = { on: event, do: stored as never }
    checkPageNames(draft, tree)
    return { addedUses: check.added, droppedUses: tree.kind === 'page' ? dropUnusedUses(tree.owner as PageFile, before) : [] }
  }
})

export const nodeInteractionRemove = defineEdit({
  input: z.object({
    file: FileRef,
    nodeId: LocalIdSchema,
    index: z.int().nonnegative(),
    on: Event.optional().describe('The event the caller saw at this index (the editor always sends it): when the interaction there is another, it changed since it was opened and nothing is removed')
  }),
  apply: (draft, { file, nodeId, index, on }) => {
    const tree = draft.tree(file)
    const node = nodeOf(tree, nodeId)
    const removed = interactionAt(node, index, on)
    const before = usedBy(removed.do as Array<Record<string, unknown>>)
    node.interactions!.splice(index, 1)
    // The ones that were after it moved down: the order a caller's indexes now follow.
    const interactions = node.interactions!.map((entry, position) => ({ index: position, on: entry.on }))
    if (!node.interactions!.length) delete node.interactions
    return { droppedUses: tree.kind === 'page' ? dropUnusedUses(tree.owner as PageFile, before) : [], interactions }
  }
})
