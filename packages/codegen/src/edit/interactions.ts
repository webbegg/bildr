import { z } from 'zod'
import { ArtifactIdSchema, INTERACTION_EVENTS, LocalIdSchema, UiStepSchema } from '../model/schemas.ts'
import type { ActionFile, ModelNode, PageFile, StateFile, Value } from '../model/schemas.ts'
import { BUTTON_COLORS, uiStepProblems } from '../render/rules.ts'
import { defineEdit, EditError, fail } from './core.ts'
import type { Draft, Tree } from './core.ts'
import { fits } from './entities.ts'
import { checkExpression, describeValue, expectValue, formOf, PRIM_WORDS, primOf, typeOfValue } from './expressions.ts'
import type { ExpressionContext, ExpressionKind, Typed } from './expressions.ts'
import { dropUnusedUses, freeAlias, moduleOfPage, pageNameProblem, useAction } from './queries.ts'
import { findNode, walk } from './tree.ts'

/**
 * Interactions on any node (B1, S2): "when <event> → steps", on the nodes of a page, a layout or a component (the variant
 * interactions of a component, `component_interaction_*`, are another list: the component's own, which switch variants). The steps
 * are the ones `generate/ui.ts` turns into code, and each add or update is refused for anything it would leave out, fail on, or
 * silently ignore:
 *
 * - `setState {state, field, value}`, `runAction {action, args}`, `navigate {to: {page, params}}` and `toast {title, …}`; `setVariant` is not generated.
 * - Events: click, change, submit, mouseenter, mouseleave; `appear` is not generated. Only a Button, a Checkbox and a Form get events.
 * - One step is an inline handler (`@click="setX({ … })"`); several steps, or a submit, are a script handler that runs an action, then
 *   the navigate and toast steps that follow when it worked (`when: "success"`), or navigate and toast steps in order.
 * - `{ "$event": "checked" }` is the value of a Checkbox's change, in the inline handler only.
 * - A page that doesn't use the state or action a step names gets the use in the same edit (`addedUses`). Layouts and components
 *   have no uses: a step there only navigates or shows a message.
 * - The other way round: an update or a remove that leaves no step naming a state or action the page uses, and nothing binding the
 *   state's name or showing the action in a Form, drops that use in the same edit (`droppedUses`), so `state_delete` is not held by
 *   a use that does nothing. The model can't tell a use an interaction added from one `page_use_add` made, so any use of a state or
 *   action the removed steps named that nothing reads or runs goes: the generator skips a use nothing reads anyway.
 * - A value is checked against what receives it (`expectValue`): a state field, a toast's text, a route parameter, an action's
 *   parameter, an action on a collection (a row of it, or the form's), each by what the value is in the generated TypeScript. A
 *   handler the script declares gets the List items it reads from the template (`generate/ui.ts`).
 */

/** The events each node type the generator attaches events to (`events()` in generate/ui.ts) takes. */
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
type Added = { as: string, state: string } | { as: string, action: string }

const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

const FileRef = ArtifactIdSchema.describe('The artifact id of a page, component or layout (pg_*, cmp_*, lay_*)')
const Event = z.enum(INTERACTION_EVENTS).describe('click, change (a Checkbox), submit (a Form), mouseenter or mouseleave; appear is not generated yet')
const Steps = z.array(UiStepSchema).min(1).max(10).describe('The steps, in order: { kind: "setState", state, field, value }, { kind: "runAction", action, args }, { kind: "navigate", to: { page, params? } }, { kind: "toast", title, description?, color?, icon? }; after an action, further navigate and toast steps take when: "success". setVariant is not generated yet')

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
  added: Added[]
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

/** The shape of each step, the steps that go together, and which of them can run on this event (what `events()` and `handler()` generate). */
const checkOrder = (steps: Step[], on: string) => {
  const inline = steps.length === 1 && on !== 'submit'
  const [first] = steps
  if (first!.when !== undefined) fail('invalid', `The first step takes no "when": it is the one that runs first`)
  steps.forEach((step, index) => {
    if (step.when !== undefined && step.when !== 'success') fail('invalid', `steps.${index}: "when" is "success" (the step runs when the action worked)`)
    if (step.when !== undefined && !KEYS[String(step.kind)]!.includes('when')) fail('invalid', `steps.${index}: a ${String(step.kind)} step takes no "when"`)
  })
  if (inline) return
  const [, ...rest] = steps
  const why = on === 'submit' ? 'a submit' : 'several steps'
  if (first!.kind === 'runAction') {
    rest.forEach((step, index) => {
      if (step.kind !== 'navigate' && step.kind !== 'toast') notGenerated(`steps.${index + 1}: after an action, ${why} can only go to a page or show a message, not ${String(step.kind)}`)
      if (step.when !== 'success') fail('invalid', `steps.${index + 1}: a step after an action runs when it worked: say "when": "success"`)
    })
    return
  }
  steps.forEach((step, index) => {
    if (step.kind === 'setState') notGenerated(`steps.${index}: a setState step can't be one of several steps, or on a submit (${why}): it is a handler that runs an action, then goes to a page or shows a message`)
    if (step.kind === 'runAction') notGenerated(`steps.${index}: a runAction step has to come first when there are several steps`)
    if (step.when !== undefined) fail('invalid', `steps.${index}: "when" follows an action: without one the steps run in order`)
  })
}

const stepKeys = (step: Step, index: number) => {
  const keys = KEYS[String(step.kind)] ?? notGenerated(`steps.${index}: a ${String(step.kind)} step`)
  const extra = Object.keys(step).find(key => !keys.includes(key))
  if (extra) fail('invalid', `steps.${index}: "${extra}" is not part of a ${String(step.kind)} step (${keys.join(', ')})`)
}

const checkSetState = (check: Check, context: ExpressionContext, step: Step, where: string) => {
  if (check.tree.kind !== 'page') notGenerated(`${where}: ${check.tree.kind === 'layout' ? 'a layout' : 'a component'} has no state to set (pages use state)`)
  const page = check.tree.owner as PageFile
  const state = stateOf(check.draft, page, step.state)
  if (state.shape !== 'single') notGenerated(`${where}: the state ${state.name} has shape "${state.shape}"`)
  const field = state.fields.find(entry => entry.name === step.field) ?? fail('invalid', `${where}: the state ${state.name} has no field "${String(step.field)}" (${state.fields.map(entry => entry.name).join(', ')})`)
  const value = step.value
  checkExpression(context, value, `${where} value`)
  if (!isObject(value) && !fits(field!.type, value!, false)) fail('invalid', `${where}: ${JSON.stringify(value)} doesn't fit ${state.name}.${field!.name} (${field!.type})`)
  // What the value is against what the field holds: the setter takes a partial row, so unset passes, null only for a nullable field.
  expectValue(context, value, where, `${state.name}.${field!.name} (${field!.type})`, { prims: [primOf(field!.type)], null: !!field!.nullable, undef: true })
}

const entityNameOf = (draft: Draft, id: string | undefined) => Object.values(draft.model.modules).flatMap(mod => mod.entities).find(entity => entity.id === id)?.name ?? String(id)

/** What a value is, in a refusal. */
const describeTyped = (draft: Draft, type: Typed): string =>
  type.shape === 'value' ? type.prims.map(prim => PRIM_WORDS[prim]).join(' or ') : `${type.shape === 'list' ? 'a list' : 'one row'}${type.entity ? ` of ${entityNameOf(draft, type.entity)}` : ''}`

const checkRunAction = (check: Check, context: ExpressionContext, step: Step, where: string) => {
  if (check.tree.kind !== 'page') notGenerated(`${where}: ${check.tree.kind === 'layout' ? 'a layout' : 'a component'} runs no actions (pages use them)`)
  const page = check.tree.owner as PageFile
  const action = actionOf(check.draft, page, step.action)
  const args = step.args
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
    // `execute(id: string)`: one plain value of the parameter's kind, never null or unset.
    expectValue(context, value, `${where} ${name}`, `the parameter ${param.name} (${param.type})`, { prims: [primOf(param.type)] })
  } else if (action.input.entity) {
    // The body of an action on a collection is a whole row of it: a row of that collection, or the form's.
    checkExpression({ ...context, scalar: false }, value, `${where} ${name}`)
    const type = typeOfValue(context, value)
    if (type && (type.shape !== 'row' || type.entity !== action.input.entity)) {
      fail('invalid', `${where}: ${action.name} takes one whole row of ${entityNameOf(check.draft, action.input.entity)} (a row of it the page reads, or { "$form": true }), but ${describeValue(value)} is ${describeTyped(check.draft, type)}`)
    }
  } else {
    fail('invalid', `${where}: ${action.name} takes no input to give`)
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

/**
 * Checks `steps` for `on` of `node`, makes the page use what they name, and returns them as they are stored. Everything is checked
 * against the draft: a refusal leaves the model as it was.
 */
const checkSteps = (check: Check, given: Array<Record<string, unknown>>): Step[] => {
  const { draft, tree, node, on } = check
  const steps = structuredClone(given) as Step[]
  steps.forEach((step, index) => {
    if (step.kind === 'setVariant') notGenerated(`steps.${index}: a setVariant step (a component's variants switch with component_interaction_add)`)
    stepKeys(step, index)
  })
  checkOrder(steps, on)
  const chain = chainTo(tree.root, node.id)
  const inline = steps.length === 1 && on !== 'submit'
  const allow: ExpressionKind[] = ['bind', 'not', 'route', 'form', 'template', ...(inline && on === 'change' && node.type === 'Checkbox' ? ['event' as const] : [])]
  const context: ExpressionContext = {
    draft, file: tree.file, kind: tree.kind, nodeId: node.id, allow: new Set(allow), subject: node.id, scalar: true,
    form: [...chain].reverse().find(entry => entry.type === 'Form')
  }
  // The uses first: a value may read the name a step's state or action is used under.
  for (const step of steps) {
    if (tree.kind !== 'page') break
    const page = tree.owner as PageFile
    if (step.kind === 'setState') useState(check, page, stateOf(draft, page, step.state))
    if (step.kind === 'runAction') {
      const action = actionOf(draft, page, step.action)
      const had = page.uses?.actions?.some(use => use.action === action.id)
      const as = useAction(draft, page, action.id)
      if (!had && as) check.added.push({ as, action: action.id })
    }
  }
  steps.forEach((step, index) => {
    const where = `steps.${index} (${String(step.kind)})`
    if (step.kind === 'setState') checkSetState(check, context, step, where)
    else if (step.kind === 'runAction') checkRunAction(check, context, step, where)
    else if (step.kind === 'navigate') checkNavigate(check, context, step, where)
    else checkToast(context, step, where)
  })
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
        checkSteps({ draft, tree, node, on: interaction.on, added: [] }, interaction.do as Array<Record<string, unknown>>)
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

export const nodeInteractionAdd = defineEdit({
  input: z.object({ file: FileRef, nodeId: LocalIdSchema, on: Event, do: Steps }),
  apply: (draft, { file, nodeId, on, do: steps }) => {
    const tree = draft.tree(file)
    const node = nodeOf(tree, nodeId)
    checkEvent(node, on)
    duplicate(node, on)
    const check: Check = { draft, tree, node, on, added: [] }
    const stored = checkSteps(check, steps)
    const list = node.interactions ??= []
    list.push({ on, do: stored as never })
    checkPageNames(draft, tree)
    return { index: list.length - 1, addedUses: check.added }
  }
})

export const nodeInteractionUpdate = defineEdit({
  input: z.object({
    file: FileRef,
    nodeId: LocalIdSchema,
    index: z.int().nonnegative().describe('Its position in the node\'s interactions'),
    on: Event.optional(),
    do: Steps.optional().describe('Replaces the steps whole')
  }),
  apply: (draft, { file, nodeId, index, on, do: steps }) => {
    if (on === undefined && steps === undefined) fail('invalid', 'Give the event (on) or the steps (do) to change')
    const tree = draft.tree(file)
    const node = nodeOf(tree, nodeId)
    const current = node.interactions?.[index] ?? fail('not_found', `${nodeId} has no interaction at index ${index}`)
    const event = on ?? current.on
    checkEvent(node, event)
    duplicate(node, event, index)
    const check: Check = { draft, tree, node, on: event, added: [] }
    const stored = checkSteps(check, steps ?? current.do)
    const before = usedBy(current.do as Array<Record<string, unknown>>)
    node.interactions![index] = { on: event, do: stored as never }
    checkPageNames(draft, tree)
    return { addedUses: check.added, droppedUses: tree.kind === 'page' ? dropUnusedUses(tree.owner as PageFile, before) : [] }
  }
})

export const nodeInteractionRemove = defineEdit({
  input: z.object({ file: FileRef, nodeId: LocalIdSchema, index: z.int().nonnegative() }),
  apply: (draft, { file, nodeId, index }) => {
    const tree = draft.tree(file)
    const node = nodeOf(tree, nodeId)
    const removed = node.interactions?.[index] ?? fail('not_found', `${nodeId} has no interaction at index ${index}`)
    const before = usedBy(removed.do as Array<Record<string, unknown>>)
    node.interactions!.splice(index, 1)
    if (!node.interactions!.length) delete node.interactions
    return { droppedUses: tree.kind === 'page' ? dropUnusedUses(tree.owner as PageFile, before) : [] }
  }
})
