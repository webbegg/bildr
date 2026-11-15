import type { ComponentFile, Transition } from '@bildr/codegen/model'
import { DEFAULT_TRANSITION } from '@bildr/codegen/render'

/**
 * The interactions UI's pure parts (the hosted `shared/editor/interactionPanel.ts` and the
 * transition helpers of `shared/runtime/interactions.ts`, over the model's variants): what
 * the inspector calls events, variants and interactions (`Click → Variant 2`), the targets an
 * interaction may go to (base variants, never states), the Transition row's summary, the
 * curve preview and the CSS transition the preview swatch runs with. Variant ids are `''`
 * for the primary, as in the model.
 *
 * An interaction has no id in the model: it is the `index`th of its variant, written
 * `<variant>:<index>` (the adapter's `interactionKey`), and it goes to one variant
 * (`do: [{ kind: 'setVariant', to, delay? }]`), which `InteractionRow` flattens.
 */

type Variant = ComponentFile['variants'][number]
type VariantInteraction = NonNullable<Variant['interactions']>[number]
export type VariantEvent = VariantInteraction['on']
export type TransitionEasing = NonNullable<Transition['easing']>

/** The events an interaction takes, as the model lists them (`VARIANT_EVENTS`); typed against it, so a new event is a compile error here. */
export const VARIANT_EVENTS = ['click', 'mouseenter', 'mouseleave', 'appear'] as const satisfies readonly VariantEvent[]
export const TRANSITION_EASINGS = ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'] as const satisfies readonly TransitionEasing[]

export const EVENT_LABELS: Record<VariantEvent, string> = { click: 'Click', mouseenter: 'Mouse enter', mouseleave: 'Mouse leave', appear: 'Appear' }

/** An interaction of a variant as the rows show it: `key` is `<variant>:<index>`, `to` the variant it goes to (`''`: the primary). */
export interface InteractionRow {
  key: string
  /** The variant it belongs to (`''`: the primary). */
  owner: string
  index: number
  on: VariantEvent
  to: string
  delay?: number
}

/** The key of interaction `index` of variant `owner` (`''` or null: the primary). */
export const interactionKey = (owner: string | null, index: number): string => `${owner ?? ''}:${index}`

/** The variant and index a key names, or null when it is not one. */
export const parseInteractionKey = (key: string): { variantId: string, index: number } | null => {
  const at = key.lastIndexOf(':')
  const index = Number(key.slice(at + 1))
  return at < 0 || !Number.isInteger(index) ? null : { variantId: key.slice(0, at), index }
}

const rowOf = (owner: string, index: number, interaction: VariantInteraction): InteractionRow => {
  const step = interaction.do[0]
  return { key: interactionKey(owner, index), owner, index, on: interaction.on, to: step.to, ...(step.delay ? { delay: step.delay } : {}) }
}

/** The interactions of variant `owner` (the component's own for the primary), in order. */
export function interactionRows(def: Pick<ComponentFile, 'interactions' | 'variants'>, owner: string): InteractionRow[] {
  const list = owner === '' ? def.interactions : def.variants.find(variant => variant.id === owner)?.interactions
  return (list ?? []).map((interaction, index) => rowOf(owner, index, interaction))
}

/** A variant's name, `Primary` for `''`. */
export function variantLabel(def: Pick<ComponentFile, 'variants'>, id: string): string {
  if (id === '') return 'Primary'
  return def.variants.find(variant => variant.id === id)?.name ?? 'Missing variant'
}

/** An interaction's row, e.g. `Click → Variant 2`. */
export function interactionLabel(def: Pick<ComponentFile, 'variants'>, interaction: Pick<InteractionRow, 'on' | 'to'>): string {
  return `${EVENT_LABELS[interaction.on]} → ${variantLabel(def, interaction.to)}`
}

/** The interaction `key` names in `def`, with the variant it belongs to; undefined when there is none. */
export function findInteraction(def: Pick<ComponentFile, 'interactions' | 'variants'>, key: string): InteractionRow | undefined {
  const target = parseInteractionKey(key)
  return target ? interactionRows(def, target.variantId)[target.index] : undefined
}

/** Where an interaction of variant `fromId` may go: Primary and every variant that is no state, except `fromId` itself. */
export function interactionTargets(def: Pick<ComponentFile, 'variants'>, fromId: string): { id: string, label: string }[] {
  return [{ id: '', label: 'Primary' }, ...def.variants.filter(variant => !variant.state).map(variant => ({ id: variant.id, label: variant.name }))].filter(target => target.id !== fromId)
}

const SPRING_DEFAULTS = { stiffness: 300, damping: 30 }

/** The Transition row: `Ease 0.3s`, `Spring`, `Instant`; unset, `Inherit` on a variant (`inherits`), else the default's. */
export function transitionSummary(transition: Transition | undefined, inherits: boolean): string {
  if (!transition) return inherits ? 'Inherit' : transitionSummary(DEFAULT_TRANSITION, false)
  if (transition.type === 'ease') return `Ease ${transition.duration ?? DEFAULT_TRANSITION.duration}s`
  return transition.type === 'spring' ? 'Spring' : 'Instant'
}

/** The transition a type tab picks: `current` when it already is one, else the type's defaults. */
export function withTransitionType(current: Transition | undefined, type: Transition['type']): Transition {
  if (current?.type === type) return current
  if (type === 'ease') return { type: 'ease', duration: DEFAULT_TRANSITION.duration!, easing: 'ease' }
  if (type === 'spring') return { type: 'spring', ...SPRING_DEFAULTS }
  return { type: 'instant' }
}

/** The CSS easings' cubic-bezier control points. */
const BEZIERS: Record<TransitionEasing, [number, number, number, number]> = {
  'ease': [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'linear': [0, 0, 1, 1]
}

const round = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

const curves = new Map<string, { duration: number, points: number[] }>()

const computeSpring = (stiffness: number, damping: number): { duration: number, points: number[] } => {
  const w0 = Math.sqrt(Math.max(stiffness, 1))
  const zeta = Math.max(damping, 0) / (2 * w0)
  const at = (t: number): number => {
    if (Math.abs(zeta - 1) < 1e-6) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta)
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t))
    }
    const root = Math.sqrt(zeta * zeta - 1)
    const r1 = -w0 * (zeta - root)
    const r2 = -w0 * (zeta + root)
    return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2)
  }
  // Settled once it stays within 0.1% of the end; at most 5 s (no damping never settles).
  let duration = 0.05
  for (let t = 0; t <= 5; t += 0.001) if (Math.abs(at(t) - 1) > 0.001) duration = t
  const count = Math.max(10, Math.min(60, Math.round(duration * 60)))
  const points = Array.from({ length: count + 1 }, (_, i) => (i === 0 ? 0 : i === count ? 1 : round3(at(duration * i / count))))
  return { duration: round3(duration), points }
}

/** A damped spring from 0 to 1 (mass 1): its settle time in seconds and samples of its position, ending at 1. */
export function springCurve(stiffness: number, damping: number): { duration: number, points: number[] } {
  const key = `${stiffness}:${damping}`
  const cached = curves.get(key)
  if (cached) return cached
  const curve = computeSpring(stiffness, damping)
  if (curves.size > 100) curves.clear()
  curves.set(key, curve)
  return curve
}

/**
 * The curve preview's SVG path in a `width` × `height` box, progress going
 * up over time: an ease's cubic-bezier, a spring's samples (scaled so an
 * overshoot stays in the box), or instant's step.
 */
export function transitionCurve(transition: Transition, width: number, height: number): string {
  if (transition.type === 'instant') return `M 0 ${height} L 0 0 L ${width} 0`
  if (transition.type === 'ease') {
    const [x1, y1, x2, y2] = BEZIERS[transition.easing ?? 'ease']
    return `M 0 ${height} C ${round(x1 * width)} ${round(height - y1 * height)} ${round(x2 * width)} ${round(height - y2 * height)} ${width} 0`
  }
  const { points } = springCurve(transition.stiffness ?? SPRING_DEFAULTS.stiffness, transition.damping ?? SPRING_DEFAULTS.damping)
  const lo = Math.min(0, ...points)
  const hi = Math.max(1, ...points)
  const y = (value: number) => round(height - ((value - lo) / (hi - lo)) * height)
  return `M ${points.map((value, i) => `${round((i / (points.length - 1)) * width)} ${y(value)}`).join(' L ')}`
}

/** The CSS `transition` value animating `properties` with `transition` (the preview swatch's); undefined for an instant one. A spring follows its samples with `linear()`. */
export function cssTransition(transition: Transition, properties: string[]): string | undefined {
  if (transition.type === 'instant' || !properties.length) return undefined
  let timing: string
  if (transition.type === 'spring') {
    const curve = springCurve(transition.stiffness ?? SPRING_DEFAULTS.stiffness, transition.damping ?? SPRING_DEFAULTS.damping)
    timing = `${Math.round(curve.duration * 1000)}ms linear(${curve.points.join(', ')})`
  } else {
    timing = `${Math.round((transition.duration ?? DEFAULT_TRANSITION.duration!) * 1000)}ms ${transition.easing ?? 'ease'}`
  }
  return properties.map(property => `${property} ${timing}`).join(', ')
}
