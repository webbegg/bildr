import type { Model, Value } from '@bildr/codegen/model'
import { isExpression } from './bindings.ts'
import { fieldAccepted } from './interactionValues.ts'
import type { Expect, Place } from './interactionValues.ts'
import type { FieldType } from './dataModel.ts'
import { isOnly, pageOf } from './nodeInteractions.ts'
import { freeAlias } from './pageNames.ts'
import { BINDABLE } from './nodeProps.ts'
import { stateFieldText, stateLabel, stateOfAlias, statesOfPage, useOfState } from './stateModel.ts'

/**
 * What a prop can bind to State (B4, S3). The binding picker offers the module's states and their fields, typed for the prop (a
 * field is offered when the generated app can use it where the prop reads it, as the Interactions' value picker decides: `fieldAccepted`),
 * whether the page uses the state yet or not: a state the page does not use is added to the page when a field of it is picked, under
 * the state's name or the first free one (`freeAlias`). Only a page reads State: a layout or a component has no use of a state to read
 * it through, and a state of several rows is not generated yet, so neither is offered.
 */

/** Why a Checkbox that fills a Form field has no value of its own to set or bind. */
export const VALUE_FROM_FORM = 'A Checkbox that fills a Form field gets its value from the Form: clear its Field to set or bind it here.'

/** Why the prop `prop` of a node of type `nodeType` with `nodeProps` can't be set or bound by hand, or undefined when it can. */
export function propLock(nodeType: string, prop: string, nodeProps: Record<string, Value> | undefined): string | undefined {
  const filled = nodeProps?.field !== undefined && nodeProps.field !== null && nodeProps.field !== ''
  return nodeType === 'Checkbox' && prop === 'value' && filled ? VALUE_FROM_FORM : undefined
}

/** The values a prop of a node can be bound to State for, or undefined when the prop takes no binding of State. */
export function statePropExpect(nodeType: string, prop: string, nodeProps?: Record<string, Value>): Expect | undefined {
  if (propLock(nodeType, prop, nodeProps)) return undefined
  if (nodeType === 'Checkbox' && prop === 'value') return { prims: ['boolean'] }
  if (!BINDABLE[nodeType]?.includes(prop)) return undefined
  // A source or an alt text is text; the text a node shows prints a number, and nothing where a field is empty.
  return nodeType === 'Image' ? { prims: ['string'] } : { prims: ['string', 'number'], null: true, undef: true }
}

/** A field of a state a prop can bind to. */
export interface StateChoice {
  /** The state's id, and its label. */
  state: string
  stateLabel: string
  field: string
  type: FieldType
  /** The name the page reads the state under: the one it has, or the one a use would get. */
  alias: string
  /** What `{ $bind }` reads: `alias.field`. */
  path: string
  /** The page uses the state already: picking the field only binds it. */
  used: boolean
}

/**
 * The fields of the page's module's states that `expect` takes, in the order of the module's states and of their fields. Nothing for a
 * layout or a component.
 */
export function stateChoices(model: Model, place: Pick<Place, 'file' | 'kind'>, expect: Expect): StateChoice[] {
  const page = place.kind === 'page' ? pageOf(model, place.file) : undefined
  if (!page) return []
  return statesOfPage(model, page).filter(state => state.shape === 'single').flatMap((state) => {
    const use = useOfState(page, state.id)
    const alias = use?.as ?? freeAlias(page, state.name, 'state')
    return state.fields.filter(field => fieldAccepted(expect, field)).map((field): StateChoice => ({
      state: state.id, stateLabel: stateLabel(state), field: field.name, type: field.type, alias, path: `${alias}.${field.name}`, used: !!use
    }))
  })
}

/**
 * `picked` as the page has it now: the name it reads the state under and whether it uses it are asked when the field is picked, not
 * when the menu was built, so a use made since (by another pick, another editor) is bound and not made again, and a name taken since
 * is not offered. Undefined when the field is gone.
 */
export const stateChoiceNow = (model: Model, place: Pick<Place, 'file' | 'kind'>, expect: Expect, picked: Pick<StateChoice, 'state' | 'field'>): StateChoice | undefined =>
  stateChoices(model, place, expect).find(choice => choice.state === picked.state && choice.field === picked.field)

/** What a chip shows for a bound State field: "showDrafts · Blog preferences". */
export interface StateChip {
  /** The name the page reads the State under. */
  alias: string
  field: string
  /** The State's label. */
  label: string
  text: string
}

/** The chip for `{ $bind: 'alias.field' }` when it reads a field of a state the page uses; undefined for anything else. */
export function stateChip(model: Model, pageId: string, value: Value | undefined): StateChip | undefined {
  if (!isExpression(value) || !isOnly(value, '$bind') || typeof value.$bind !== 'string') return undefined
  const page = pageOf(model, pageId)
  const [alias, field, ...rest] = value.$bind.split('.')
  if (!page || !alias || !field || rest.length) return undefined
  const state = stateOfAlias(model, page, alias)
  if (!state?.fields.some(entry => entry.name === field)) return undefined
  return { alias, field, label: stateLabel(state), text: stateFieldText(field, state) }
}
