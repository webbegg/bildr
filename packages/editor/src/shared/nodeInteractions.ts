import { bindingScope } from '@bildr/codegen/edit'
import type { ScopeName } from '@bildr/codegen/edit'
import type { ActionFile, Model, ModelNode, ModuleModel, PageFile, StateFile, Value } from '@bildr/codegen/model'
import type { FieldType } from './dataModel.ts'
import { EVENT_LABELS } from './interactionPanel.ts'
import type { NodeEvent } from './interactionPanel.ts'
import { primOf, valueChoices } from './interactionValues.ts'
import type { Choice, Expect, Place } from './interactionValues.ts'

/**
 * The inspector's Interactions on any node (B3, S2), as pure functions the section and its editor are built on: "When <event> →
 * steps". The module's `node_interaction_*` edits (B1) are the last word on what is accepted; this is what the editor offers, so an
 * offered step is one the module takes (the tests ask it). This file is what a step is and what it can name; the rest is beside it:
 *
 * - `interactionConversion.ts`: a stored step as a draft, every part of it a string a box holds, and back;
 * - `interactionProblems.ts`: what a draft still needs before it can be written, so the module never sees half a step;
 * - `interactionSummary.ts`: what a row says, and which step a refusal is about.
 *
 * Here: which nodes take which events (`eventsOf`: what `generate/ui.ts` attaches events to: a Button, a Checkbox, a Form), which
 * step can come next (`addableKinds`: Set state is a single step, an action goes first, and Go to page and Show message steps
 * follow it (on success) or follow each other (in order); a layout or component has no state or actions to use), the states,
 * actions and pages a step can name, and the ways a step's value can be given (`valueModes`).
 *
 * A step's value is a fixed value (typed by what receives it), the control's value (`{ $event: 'checked' }`), the opposite of the
 * current value (`{ not: { $bind: '<as>.<field>' } }`), a name in scope (`valueChoices`) or a route parameter; any other expression
 * a step holds (a binding with a fallback…) is kept whole as `other` and written back as it was. A step of a kind the editor does
 * not make (a hand-written `setVariant`) is kept whole as `unknown`.
 */

export type { NodeEvent }

/** The events each node type the generator attaches events to takes (`EVENTS_OF` of the module's `interactions.ts`). */
const EVENTS_OF: Record<string, readonly NodeEvent[]> = {
  Button: ['click', 'mouseenter', 'mouseleave'],
  Checkbox: ['click', 'change', 'mouseenter', 'mouseleave'],
  Form: ['click', 'submit', 'mouseenter', 'mouseleave']
}

/** The events a node of `type` can react to (none for a node the generator attaches none to). */
export const eventsOf = (type: string): readonly NodeEvent[] => EVENTS_OF[type] ?? []
export const takesEvents = (type: string): boolean => eventsOf(type).length > 0

export interface EventChoice {
  on: NodeEvent
  label: string
  disabled?: boolean
  hint?: string
}

/** The events a node of `type` lists, Appear last and disabled, and the ones it already has (`taken`) disabled. */
export function eventChoices(type: string, taken: readonly NodeEvent[]): EventChoice[] {
  const events = eventsOf(type)
  if (!events.length) return []
  return [
    ...events.map((on): EventChoice => taken.includes(on) ? { on, label: EVENT_LABELS[on], disabled: true, hint: 'Already has one' } : { on, label: EVENT_LABELS[on] }),
    { on: 'appear', label: EVENT_LABELS.appear, disabled: true, hint: 'Not generated yet' }
  ]
}

// ── Drafts ──────────────────────────────────────────────────────────────

/** What a value is, as the picker shows it: `other` is an expression it doesn't edit, kept whole. */
export type ValueDraft
  = | { kind: 'none' }
    | { kind: 'event' }
    | { kind: 'fixed', text: string }
    | { kind: 'flip' }
    | { kind: 'bind', path: string }
    | { kind: 'route', name: string }
    | { kind: 'other', value: Value }

/** A message's text: the text a box holds (names in it are `{path}`), or an expression the box doesn't edit. */
export type TextDraft = string | { keep: Value }

export type ArgsDraft
  = | { mode: 'none' }
    | { mode: 'form' }
    | { mode: 'param', name: string, value: ValueDraft }
    | { mode: 'other', value: Value }

/** A step as the module stores it. */
export type Stored = Record<string, Value>

export interface SetStateDraft { kind: 'setState', state: string, field: string, value: ValueDraft }
export interface RunActionDraft { kind: 'runAction', action: string, args: ArgsDraft }
export interface NavigateDraft { kind: 'navigate', page: string, params: Record<string, ValueDraft> }
export interface ToastDraft { kind: 'toast', title: TextDraft, description: TextDraft, color: string, icon: string }
/** A step of a kind the editor doesn't make (a hand-written `setVariant`): kept whole, shown read-only, written back as it was. */
export interface UnknownDraft { kind: 'unknown', step: Stored }
export type StepDraft = SetStateDraft | RunActionDraft | NavigateDraft | ToastDraft | UnknownDraft
export type StepKind = StepDraft['kind']
/** The kinds a person can add. */
export type NewKind = Exclude<StepKind, 'unknown'>

export const STEP_KIND_LABELS: Record<StepKind, string> = { setState: 'Set state', runAction: 'Run action', navigate: 'Go to page', toast: 'Show message', unknown: 'Written by hand' }

/** Where an interaction is edited: the node, the event, and what the file is. */
export interface Env {
  model: Model
  place: Place
  nodeType: string
  on: NodeEvent
}

const MAX_STEPS = 10

export function newStep(kind: NewKind): StepDraft {
  switch (kind) {
    case 'setState': return { kind, state: '', field: '', value: { kind: 'none' } }
    case 'runAction': return { kind, action: '', args: { mode: 'none' } }
    case 'navigate': return { kind, page: '', params: {} }
    case 'toast': return { kind, title: '', description: '', color: '', icon: '' }
  }
}

/**
 * The kinds of step that can be added after `steps` (the kinds of the ones there are), for `on`: what the module accepts. Set state
 * is a single step, and not on a submit. An action goes first; Go to page and Show message follow it or one another. A layout or
 * component has no state or actions of its own to use. Nothing follows a step the editor doesn't know: the module takes none.
 */
export function addableKinds(steps: readonly StepKind[], on: NodeEvent, kind: Place['kind']): NewKind[] {
  if (steps.length >= MAX_STEPS || steps.includes('unknown')) return []
  const own = kind === 'page'
  if (!steps.length) {
    const first: NewKind[] = [...(own && on !== 'submit' ? ['setState' as const] : []), ...(own ? ['runAction' as const] : []), 'navigate', 'toast']
    return first
  }
  if (steps[0] === 'setState') return []
  return ['navigate', 'toast']
}

// ── The model's pieces a step names ─────────────────────────────────────

export const isOnly = (value: Record<string, Value>, key: string): boolean => Object.keys(value).length === 1 && key in value

const pages = (model: Model): PageFile[] => Object.values(model.modules).flatMap(mod => mod.pages)
export const pageOf = (model: Model, id: string): PageFile | undefined => pages(model).find(page => page.id === id)
export const stateOf = (model: Model, id: string): StateFile | undefined => Object.values(model.modules).flatMap(mod => mod.state).find(state => state.id === id)
export const actionOf = (model: Model, id: string): ActionFile | undefined => Object.values(model.modules).flatMap(mod => mod.actions).find(action => action.id === id)

const placePage = (env: Env): PageFile | undefined => env.place.kind === 'page' ? pageOf(env.model, env.place.file) : undefined

/** The module the page being edited is in: its states and actions are the ones a step can name. */
const moduleOfPage = (env: Env): ModuleModel | undefined => Object.values(env.model.modules).find(mod => mod.pages.some(page => page.id === env.place.file))

/** The states a Set state step can name: the page's module's, the ones that hold one row (several rows are not generated yet), used by the page or not (the module makes the page use it). A layout or component has none to use. */
export const statesFor = (env: Env): StateFile[] => (env.place.kind === 'page' ? moduleOfPage(env)?.state.filter(state => state.shape === 'single') ?? [] : [])

/** The state `id` among `statesFor`. */
export const stateFor = (env: Env, id: string): StateFile | undefined => statesFor(env).find(state => state.id === id)

/** The actions a Run action step can name: the page's module's, used by the page or not. */
export const actionsFor = (env: Env): ActionFile[] => (env.place.kind === 'page' ? moduleOfPage(env)?.actions ?? [] : [])

/** Every page a Go to page step can go to. */
export const pagesFor = (env: Env): PageFile[] => pages(env.model)

const chainTo = (root: ModelNode, id: string): ModelNode[] => {
  if (root.id === id) return [root]
  for (const child of root.children ?? []) {
    const chain = chainTo(child, id)
    if (chain.length) return [root, ...chain]
  }
  return []
}

const rootOf = (model: Model, file: string): ModelNode | undefined => {
  for (const mod of Object.values(model.modules)) {
    const found = mod.pages.find(page => page.id === file)?.root ?? mod.components.find(component => component.id === file)?.root
    if (found) return found
  }
  return model.layouts.find(layout => layout.id === file)?.root
}

/** The Form the node is, or sits in: what `{ $form: true }` reads. */
const formAbove = (env: Env): ModelNode | undefined => {
  const root = rootOf(env.model, env.place.file)
  return root ? [...chainTo(root, env.place.nodeId)].reverse().find(node => node.type === 'Form') : undefined
}

/**
 * How an action is run from the node: with the values of the Form around it (an action on a collection), or with its one
 * parameter. Anything else the module doesn't generate from a node, and says why: an action that takes no input has no argument
 * to give, and the module (`checkRunAction`) and the generator (`runAction`) both want `$form: true` or exactly one.
 */
export function actionUse(env: Env, action: ActionFile): { how: 'form' } | { how: 'param', name: string } | { how: 'no', why: string } {
  const form = formAbove(env)
  const edited = form ? actionOf(env.model, String(form.props?.action))?.input.entity : undefined
  if (action.input.entity && form && (!edited || edited === action.input.entity)) return { how: 'form' }
  const params = action.input.params ?? []
  if (params.length === 1) return { how: 'param', name: params[0]!.name }
  if (action.input.entity) return { how: 'no', why: form ? 'The form around this element edits another collection' : 'Needs a form around this element' }
  return { how: 'no', why: params.length ? 'Takes several values' : 'Takes no input yet' }
}

/** The name the page reads the state under, when it uses it. */
export const stateAlias = (env: Env, stateId: string): string | undefined => placePage(env)?.uses?.state?.find(use => use.state === stateId)?.as

export const stateLabel = (state: StateFile): string => state.label || state.name

/** The names a message's text may bind: what the generator resolves in the file (`site` only in a layout, a List's item only on a page). */
export const textScope = (env: Env): ScopeName[] => bindingScope(env.model, env.place.file, env.place.nodeId)
  .filter(entry => (entry.source !== 'site' || env.place.kind === 'layout') && (entry.source !== 'item' || env.place.kind === 'page'))
export const textNames = (env: Env): string[] => textScope(env).map(entry => entry.name)

// ── The value a step takes ──────────────────────────────────────────────

export interface Target {
  type: FieldType
  expect: Expect
  /** Writing the same value back (the field the step sets): "its opposite" reads it. */
  self?: string
  /** An empty fixed text is no value. */
  required: boolean
}

/** What step `step` of `drafts` sets or passes, for the value `name` (a page's parameter): its type, what it takes, and the path it reads for "opposite". */
export function targetOf(env: Env, step: StepDraft, name?: string): Target | undefined {
  if (step.kind === 'setState') {
    const state = stateOf(env.model, step.state)
    const field = state?.fields.find(entry => entry.name === step.field)
    if (!state || !field) return undefined
    const alias = stateAlias(env, state.id)
    return { type: field.type, expect: { prims: [primOf(field.type)], null: !!field.nullable, undef: true }, ...(alias ? { self: `${alias}.${field.name}` } : {}), required: false }
  }
  if (step.kind === 'runAction') {
    const param = actionOf(env.model, step.action)?.input.params?.find(entry => entry.name === (step.args.mode === 'param' ? step.args.name : undefined))
    return param ? { type: param.type as FieldType, expect: { prims: [primOf(param.type as FieldType)] }, required: true } : undefined
  }
  if (step.kind === 'navigate' && name !== undefined) return { type: 'text', expect: { prims: ['string', 'number'] }, required: true }
  return undefined
}

export interface ValueModes {
  /** The control's value: a Checkbox's change, as the only step, setting a toggle. */
  event: boolean
  /** The opposite of the field's current value: a toggle the page already uses. */
  flip: boolean
  /** The names in scope that fit the target, and the page's route parameters. */
  choices: Choice[]
  /** The type a fixed value takes (a fixed value is always one of the ways). */
  type: FieldType
}

/** What the value of step `index` (for page parameter `name` of a Go to page step) can be. */
export function valueModes(env: Env, drafts: readonly StepDraft[], index: number, name?: string): ValueModes {
  const step = drafts[index]!
  const target = targetOf(env, step, name)
  const boolean = !!target && step.kind === 'setState' && target.expect.prims.includes('boolean')
  return {
    event: boolean && env.nodeType === 'Checkbox' && env.on === 'change' && drafts.length === 1,
    flip: boolean && !!target?.self,
    choices: target ? valueChoices(env.model, env.place, target.expect) : [],
    type: target?.type ?? 'text'
  }
}
