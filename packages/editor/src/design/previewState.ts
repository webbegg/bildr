import type { Model as ProjectModel, PageFile, StateFile } from '@bildr/codegen/model'
import type { PlainValue } from '../canvas/protocol.ts'
import { primOf } from '../shared/interactionValues.ts'
import { findNode } from './tree.ts'

/**
 * The State the canvas holds in preview (B5, S5). A State's fields start at their defaults (`designData`); what a visitor of the
 * preview does (a `setState` step the canvas reports, `canvas/protocol.ts`) is kept here, by State id, then field name, over those
 * defaults. State is module-wide, so every page that uses a State reads the same value, as in the app.
 *
 * Values live in the editor, not in a canvas frame: every device frame shows the same ones, they outlast a canvas re-render (a
 * model edit, a reload of the frame, another page) and go with the editor on a reload. Where the app keeps them (memory, tab,
 * browser) is the app's concern: the canvas never persists them. They start over when preview ends (`design/store.ts`), so the
 * canvas in edit mode is the app's first render, and `prunePreviewState` drops those a model edit left without a field to be the
 * value of.
 */

/** The values set in the preview: State id → field name → value. */
export type StatePreview = Record<string, Record<string, PlainValue>>

type StateField = StateFile['fields'][number]

/** The longest text a preview value can be: the canvas is another window, and a message from it is not trusted to be sane. */
const MAX_TEXT = 10_000

/**
 * Whether `value` is something the field holds: what the generated app's `setState` would store without a type error. The kind
 * is B3's (`primOf`, as the module's check of a step's value takes it); `fieldAccepted` goes the other way (a field read as a
 * value), so the rest is the module's own rule for a field as a target: null only for a nullable field, an integer whole.
 */
const fits = (field: StateField, value: unknown): value is PlainValue => {
  if (value === null) return field.nullable === true
  if (typeof value !== primOf(field.type)) return false
  if (typeof value === 'string') return value.length <= MAX_TEXT
  if (typeof value === 'number') return field.type === 'integer' ? Number.isInteger(value) : Number.isFinite(value)
  return true
}

const statesOf = (model: ProjectModel | null): StateFile[] => Object.values(model?.modules ?? {}).flatMap(entry => entry.state)

/** A `bildr:interaction` of the canvas (`canvas/protocol.ts`): the node whose interaction ran for `on`, and the step it reported. */
export interface ReportedStep {
  nodeId: string
  on: string
  step: Record<string, unknown>
}

/**
 * `values` with a reported `setState` step applied: its field of its State set to its value. A step the preview can't apply
 * changes nothing, and `values` itself comes back: not a `setState`; a node of the page that has no such step for that event (the
 * canvas is another window: match by node, event, State and field); a State the page doesn't use (a layout or a component being
 * edited has no page, so sets nothing); a State or field that isn't there; a value the field can't hold or the canvas left
 * unresolved. The values are never changed in place.
 */
export function applySetState(model: ProjectModel | null, page: PageFile | undefined, values: StatePreview, reported: ReportedStep): StatePreview {
  const { nodeId, on, step } = reported
  if (step.kind !== 'setState' || typeof step.state !== 'string' || typeof step.field !== 'string') return values
  if (!page?.uses?.state?.some(use => use.state === step.state)) return values
  const node = findNode(page.root, nodeId)
  const has = node?.interactions?.some(interaction => interaction.on === on && interaction.do.some((entry) => {
    const own = entry as Record<string, unknown>
    return own.kind === 'setState' && own.state === step.state && own.field === step.field
  }))
  if (!has) return values
  const state = statesOf(model).find(entry => entry.id === step.state)
  const field = state?.shape === 'single' ? state.fields.find(entry => entry.name === step.field) : undefined
  if (!state || !field || !fits(field, step.value)) return values
  return { ...values, [state.id]: { ...values[state.id], [field.name]: step.value } }
}

const countOf = (values: StatePreview): number => Object.values(values).reduce((total, fields) => total + Object.keys(fields).length, 0)

/**
 * `values` without what the model no longer has a place for: the values of a State that is gone, of a field that was removed or
 * renamed (a renamed field starts again at its default), or whose type no longer holds the value. A State left with no value is
 * dropped too (an entry is never empty). `values` itself comes back when nothing was dropped.
 */
export function prunePreviewState(model: ProjectModel, values: StatePreview): StatePreview {
  const states = statesOf(model)
  const kept = Object.fromEntries(Object.entries(values).flatMap(([id, fields]) => {
    const state = states.find(entry => entry.id === id)
    const fitting = Object.entries(fields).filter(([name, value]) => {
      const field = state?.shape === 'single' ? state.fields.find(entry => entry.name === name) : undefined
      return !!field && fits(field, value)
    })
    return fitting.length ? [[id, Object.fromEntries(fitting)]] : []
  }))
  return Object.keys(kept).length === Object.keys(values).length && countOf(kept) === countOf(values) ? values : kept
}

/** Whether nothing was set in the preview: there is nothing to reset. */
export const previewIsEmpty = (values: StatePreview): boolean => countOf(values) === 0
