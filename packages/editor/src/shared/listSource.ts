import { queryBehind } from '@bildr/codegen/edit'
import type { Model, PageFile, Value } from '@bildr/codegen/model'
import { isExpression } from './bindings.ts'
import { valueChoices } from './interactionValues.ts'
import { isOnly } from './nodeInteractions.ts'
import { stateChoices, stateFieldLabel } from './stateBinding.ts'
import type { StateChoice } from './stateBinding.ts'

/**
 * A List's conditional source (B4, S4): "if <a true or false value> then <a list> else <another list of the same collection>", which the
 * page keeps as a computed value (`uses.computed`, written with `page_computed_set`) and the List's `items` bind by name. This reads
 * and writes that shape for the List's source panel: the condition a computed value holds (when it is one the panel can show: a field,
 * or the opposite of one, and two of the page's own query uses, and nothing else in the entry), what the condition can read, the lists a
 * branch can be, and the input of the write. A computed value of any other shape (a template, a path into a list, an entry with more
 * than a condition) stays a plain name the panel does not edit: the module writes an entry back as the condition alone.
 */

/** A condition as the panel edits it. */
export interface Condition {
  /** The computed value's name. */
  as: string
  /** What the condition reads: `preferences.showDrafts`. */
  path: string
  /** "is off": the condition is the opposite of the value (`{ not: … }`). */
  off: boolean
  /** The query uses (names) the List shows when the condition holds, and when it does not. */
  then: string
  else: string
}

/** A condition being made: it has no name yet, and is not written until its value and both lists are chosen. */
export type ConditionDraft = Omit<Condition, 'as'>

/** A computed value of a page, as the module holds it (the page's schema leaves what is in it open). */
export interface ComputedUse {
  as: string
  if?: Value
  then?: Value
  else?: Value
}

/** The computed values of a page. */
export const computedValues = (page: PageFile): ComputedUse[] => (page.uses?.computed ?? []) as ComputedUse[]

/** What `$bind` reads, when the value is only that (no fallback beside it). */
const bindOf = (value: unknown): string | undefined => (isExpression(value) && isOnly(value, '$bind') && typeof value.$bind === 'string' ? value.$bind : undefined)

/** A name (no path into it) a branch binds. */
const nameBound = (value: unknown): string | undefined => {
  const read = bindOf(value)
  return read && !read.includes('.') ? read : undefined
}

const CONDITION_KEYS = ['as', 'if', 'then', 'else']

/** The condition computed value `as` of the page holds, or undefined when there is none or it is not one the panel can edit. */
export function conditionOf(page: PageFile, as: string): Condition | undefined {
  const entry = computedValues(page).find(use => use.as === as)
  if (!entry || Object.keys(entry).some(key => !CONDITION_KEYS.includes(key))) return undefined
  const off = isExpression(entry.if) && isOnly(entry.if, 'not')
  const path = bindOf(isExpression(entry.if) && off ? entry.if.not : entry.if)
  const then = nameBound(entry.then)
  const otherwise = nameBound(entry.else)
  const queries = page.uses?.queries ?? []
  if (!path || !then || !otherwise || !queries.some(use => use.as === then) || !queries.some(use => use.as === otherwise)) return undefined
  return { as, path, off, then, else: otherwise }
}

/** A true or false value a condition can read. */
export interface ConditionChoice {
  /** What the condition reads. */
  path: string
  /** What an option says: a State field as its name (with its State where two fields share one), anything else by its path. */
  label: string
  /** What the choice is called in full: "showDrafts · Blog preferences". */
  title: string
  /** The State's label, for a State field: the group it is listed under. */
  group?: string
  /** For a State field: how it is bound (and whether the page uses its State yet). */
  state?: StateChoice
}

/**
 * The true or false values a page's condition can read: the fields of the module's States (a State the page does not use is added when
 * its field is picked), then the other true or false values the page has (an action's `pending`). The page's own scope, not a node's:
 * a computed value belongs to the page, so a List's item is not there.
 */
export function conditionChoices(model: Model, page: PageFile): ConditionChoice[] {
  const states = stateChoices(model, { file: page.id, kind: 'page' }, { prims: ['boolean'] })
  const stateRoots = new Set(page.uses?.state?.map(use => use.as))
  const others = valueChoices(model, { file: page.id, kind: 'page', nodeId: page.root.id }, { prims: ['boolean'] })
    .filter(choice => choice.kind === 'bind' && !stateRoots.has(choice.path.split('.')[0]!))
  const shared = (field: string) => states.filter(state => state.field === field).length > 1
  return [
    ...states.map((state): ConditionChoice => ({
      path: state.path,
      label: stateFieldLabel(state.field, state.stateLabel, shared(state.field)),
      title: stateFieldLabel(state.field, state.stateLabel),
      group: state.stateLabel,
      state
    })),
    ...others.map((choice): ConditionChoice => ({ path: choice.path, label: choice.label, title: choice.label }))
  ]
}

/** What a condition's value is called in a sentence: as the If select labels it, or its path. */
const valueLabel = (model: Model, page: PageFile, path: string): string => conditionChoices(model, page).find(choice => choice.path === path)?.label ?? path

/** A query use's label (the query's), or its name. */
const labelOf = (model: Model, page: PageFile, alias: string): string => queryBehind(model, page, alias)?.label ?? alias

/** "If showDrafts is on: Then All posts, Otherwise Featured posts". */
export function conditionSentence(model: Model, page: PageFile, condition: Condition): string {
  return `If ${valueLabel(model, page, condition.path)} is ${condition.off ? 'off' : 'on'}: Then ${labelOf(model, page, condition.then)}, Otherwise ${labelOf(model, page, condition.else)}`
}

/** A list a branch can be: one of the page's query uses. */
export interface BranchChoice {
  alias: string
  label: string
  /** The collection's id. */
  entity: string
}

/** The page's query uses that return a list, in the order the page has them; of one collection when `entity` is given. */
export function branchChoices(model: Model, page: PageFile, entity?: string): BranchChoice[] {
  return (page.uses?.queries ?? []).flatMap((use): BranchChoice[] => {
    const query = queryBehind(model, page, use.as)
    return query?.result === 'many' && (!entity || query.from === entity) ? [{ alias: use.as, label: query.label, entity: query.from }] : []
  })
}

/** The input of `page_computed_set` for a condition. */
export function computedInput(page: string, condition: Condition) {
  const read: Value = { $bind: condition.path }
  return {
    page,
    as: condition.as,
    if: condition.off ? { not: read } : read,
    then: { $bind: condition.then } as Value,
    else: { $bind: condition.else } as Value
  }
}
