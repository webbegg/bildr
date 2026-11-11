/**
 * The interactions UI's pure parts: what the inspector and the board call
 * events, variants and interactions (`Click → Variant 2`), the targets an
 * interaction may go to (base variants, never states), the Transition row's
 * summary and curve preview, and the page "Preview interactions" opens.
 * Variant ids are `''` for the primary, as in the document.
 */
import { INSTANCE_TYPE } from '../document/components'
import type { ComponentDefinition, DocNode, Interaction, InteractionEvent, Page, Project, Transition } from '../document/schema'
import { DEFAULT_TRANSITION, springCurve } from '../runtime/interactions'

export const EVENT_LABELS: Record<InteractionEvent, string> = { click: 'Click', mouseenter: 'Mouse enter', mouseleave: 'Mouse leave', appear: 'Appear' }

/** A variant's name, `Primary` for `''`. */
export function variantLabel(def: Pick<ComponentDefinition, 'variants'>, id: string): string {
  if (id === '') return 'Primary'
  return def.variants.find(v => v.id === id)?.name ?? 'Missing variant'
}

/** An interaction's row, e.g. `Click → Variant 2`. */
export function interactionLabel(def: Pick<ComponentDefinition, 'variants'>, interaction: Pick<Interaction, 'on' | 'to'>): string {
  return `${EVENT_LABELS[interaction.on]} → ${variantLabel(def, interaction.to)}`
}

/** Interaction `id` of `def` and the variant it belongs to (`''`: the primary); undefined when there is none. */
export function findInteraction(def: Pick<ComponentDefinition, 'interactions' | 'variants'>, id: string): { owner: string, interaction: Interaction } | undefined {
  const owners = [{ owner: '', list: def.interactions ?? [] }, ...def.variants.map(v => ({ owner: v.id, list: v.interactions ?? [] }))]
  for (const { owner, list } of owners) {
    const interaction = list.find(i => i.id === id)
    if (interaction) return { owner, interaction }
  }
  return undefined
}

/** Where an interaction of variant `fromId` may go: Primary and every variant that is no state, except `fromId` itself. */
export function interactionTargets(def: Pick<ComponentDefinition, 'variants'>, fromId: string): { id: string, label: string }[] {
  return [{ id: '', label: 'Primary' }, ...def.variants.filter(v => !v.state).map(v => ({ id: v.id, label: v.name }))].filter(t => t.id !== fromId)
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
  if (type === 'ease') return { type: 'ease', duration: DEFAULT_TRANSITION.duration, easing: 'ease' }
  if (type === 'spring') return { type: 'spring', ...SPRING_DEFAULTS }
  return { type: 'instant' }
}

/** The CSS easings' cubic-bezier control points. */
const BEZIERS: Record<NonNullable<Transition['easing']>, [number, number, number, number]> = {
  'ease': [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'linear': [0, 0, 1, 1]
}

const round = (n: number) => Math.round(n * 100) / 100

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

const usesComponent = (root: DocNode, componentId: string): boolean =>
  (root.type === INSTANCE_TYPE && root.props.component === componentId) || root.children.some(child => usesComponent(child, componentId))

/**
 * The page "Preview interactions" opens: the first page showing component
 * `componentId`, directly, through its layout, or inside another component
 * shown there; null when no page does.
 */
export function previewPageFor(project: Pick<Project, 'pages' | 'components' | 'layouts'>, componentId: string): Page | null {
  const shown = new Set<string>()
  const queue = [componentId]
  // Every component whose instances would show `componentId`: it and the ones containing them.
  while (queue.length) {
    const id = queue.shift()!
    if (shown.has(id)) continue
    shown.add(id)
    for (const def of project.components) if (!shown.has(def.id) && usesComponent(def.root, id)) queue.push(def.id)
  }
  const showsIn = (root: DocNode) => [...shown].some(id => usesComponent(root, id))
  const layouts = new Set(project.layouts.filter(l => showsIn(l.root)).map(l => l.id))
  return project.pages.find(page => showsIn(page.root) || (!!page.layoutId && layouts.has(page.layoutId))) ?? null
}
