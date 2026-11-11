import { parseStyleKey } from '../design/tokens'
import { PRIMARY_VARIANT } from '../document/schema'
import type { ComponentDefinition, Interaction, InteractionEvent, StateKind, Transition, Variant } from '../document/schema'

/**
 * Framer-style interactions at run time, as pure functions: which variant an
 * instance shows (its current variant, or one of that variant's hover and
 * pressed states while the pointer is over or pressing it), which variant
 * an event switches it to, and how the change animates. The renderer
 * (BildrNode) keeps the state per instance and only runs this outside the
 * editor's edit mode. Variant ids are `''` for the primary variant.
 */

/** Used when neither the variant nor the component sets a transition. */
export const DEFAULT_TRANSITION: Transition = { type: 'ease', duration: 0.3, easing: 'ease' }
const EASE_DURATION = 0.3
const SPRING_STIFFNESS = 300
const SPRING_DAMPING = 30

function variantById(def: ComponentDefinition, id: string): Variant | undefined {
  return id === PRIMARY_VARIANT ? undefined : def.variants.find(v => v.id === id)
}

/** `id` when it names a variant of `def` (or the primary), else undefined. */
function known(def: ComponentDefinition, id: string | undefined): string | undefined {
  if (id === undefined) return undefined
  return id === PRIMARY_VARIANT || variantById(def, id) ? id : undefined
}

/** The `kind` state of base variant `baseId`, if it has one. */
export function stateOf(def: ComponentDefinition, baseId: string, kind: StateKind): Variant | undefined {
  return def.variants.find(v => v.state?.of === baseId && v.state.kind === kind)
}

/** The interactions of variant `id` (the component's own for the primary). */
export function interactionsOf(def: ComponentDefinition, id: string): Interaction[] {
  return (id === PRIMARY_VARIANT ? def.interactions : variantById(def, id)?.interactions) ?? []
}

/** Whether instances of `def` react at all: it has states or interactions. */
export function hasInteractivity(def: ComponentDefinition): boolean {
  return !!def.interactions?.length || def.variants.some(v => v.state || v.interactions?.length)
}

/** Whether `def` has a click interaction anywhere, so its instances act as buttons. */
export function hasClick(def: ComponentDefinition): boolean {
  return [def.interactions ?? [], ...def.variants.map(v => v.interactions ?? [])].some(list => list.some(i => i.on === 'click'))
}

export interface PointerFlags {
  hover: boolean
  pressed: boolean
}

/**
 * The variant an instance shows: pressed over hover over the current
 * variant, using the current variant's states (an unknown current variant
 * counts as the primary). A current variant that is itself a state shows
 * as is.
 */
export function renderedVariant(def: ComponentDefinition, current: string, { hover, pressed }: PointerFlags): string {
  const base = known(def, current) ?? PRIMARY_VARIANT
  if (variantById(def, base)?.state) return base
  const press = pressed ? stateOf(def, base, 'pressed') : undefined
  if (press) return press.id
  const over = hover ? stateOf(def, base, 'hover') : undefined
  return over?.id ?? base
}

export interface VariantStep {
  to: string
  /** Seconds. */
  delay: number
}

/**
 * Where `event` takes an instance whose current variant is `current` (the
 * set variant `setVariant` when that is gone): the first interaction for
 * the event on the shown state (`rendered`), else on the current variant,
 * else on the current state's base. Null when nothing listens.
 */
export function nextVariant(def: ComponentDefinition, setVariant: string, current: string, event: InteractionEvent, rendered?: string): VariantStep | null {
  const base = known(def, current) ?? known(def, setVariant) ?? PRIMARY_VARIANT
  const shown = known(def, rendered)
  const of = variantById(def, base)?.state?.of
  const owners = [...new Set([...(shown === undefined ? [] : [shown]), base, ...(of === undefined ? [] : [of])])]
  for (const owner of owners) {
    const interaction = interactionsOf(def, owner).find(i => i.on === event && known(def, i.to) !== undefined)
    if (interaction) return { to: interaction.to, delay: interaction.delay ?? 0 }
  }
  return null
}

/** The state an instance keeps; reactive in the renderer. `change` is the last change of the shown variant, for its transition. */
export interface MachineState extends PointerFlags {
  current: string
  appeared: boolean
  change: { from: string, to: string } | null
}

export function initialMachineState(setVariant: string): MachineState {
  return { current: setVariant, hover: false, pressed: false, appeared: false, change: null }
}

export interface MachineOptions {
  component: () => ComponentDefinition | undefined
  /** The instance's set variant, which it starts from and resets to. */
  setVariant: () => string
  timers?: { set: (fn: () => void, ms: number) => unknown, clear: (handle: unknown) => void }
}

export interface InteractionMachine {
  hover: (on: boolean) => void
  press: (on: boolean) => void
  dispatch: (event: InteractionEvent) => void
  /** The instance entered the viewport: fires `appear` the first time only. */
  appear: () => void
  /** Back to the set variant (it changed), dropping a pending switch. */
  reset: () => void
  dispose: () => void
}

/**
 * Drives one instance's `state`: pointer flags, event switches after their
 * delay (a new switch replaces a pending one), and appear once. Every
 * change of the shown variant is recorded in `state.change`.
 */
export function createInteractionMachine(options: MachineOptions, state: MachineState): InteractionMachine {
  const timers = options.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  let pending: unknown
  const shown = () => {
    const def = options.component()
    return def ? renderedVariant(def, state.current, state) : state.current
  }
  const mutate = (change: () => void) => {
    const from = shown()
    change()
    const to = shown()
    if (from !== to) state.change = { from, to }
  }
  const cancel = () => {
    if (pending !== undefined) timers.clear(pending)
    pending = undefined
  }
  const dispatch = (event: InteractionEvent) => {
    const def = options.component()
    const step = def && nextVariant(def, options.setVariant(), state.current, event, shown())
    if (!step) return
    cancel()
    const go = () => {
      pending = undefined
      mutate(() => (state.current = step.to))
    }
    if (step.delay > 0) pending = timers.set(go, step.delay * 1000)
    else go()
  }
  return {
    hover: on => mutate(() => {
      state.hover = on
      if (!on) state.pressed = false
    }),
    press: on => mutate(() => (state.pressed = on)),
    dispatch,
    appear: () => {
      if (state.appeared) return
      state.appeared = true
      dispatch('appear')
    },
    reset: () => {
      cancel()
      mutate(() => (state.current = options.setVariant()))
    },
    dispose: cancel
  }
}

/**
 * The transition a change of the shown variant from `from` to `to` uses:
 * into or out of a state, the state's (else its base's); otherwise the
 * target's. Unset ones fall back to the component's, then the default.
 * Reduced motion is always instant.
 */
export function transitionFor(def: ComponentDefinition, from: string, to: string, { reducedMotion = false } = {}): Transition {
  if (reducedMotion) return { type: 'instant' }
  const fromV = variantById(def, from)
  const toV = variantById(def, to)
  const owner = toV?.state ? toV : fromV?.state && fromV.state.of === to ? fromV : toV
  const base = owner?.state ? variantById(def, owner.state.of) : undefined
  return owner?.transition ?? base?.transition ?? def.transition ?? DEFAULT_TRANSITION
}

const round = (value: number) => Math.round(value * 1000) / 1000

const curves = new Map<string, { duration: number, points: number[] }>()

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

function computeSpring(stiffness: number, damping: number): { duration: number, points: number[] } {
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
  const points = Array.from({ length: count + 1 }, (_, i) => (i === 0 ? 0 : i === count ? 1 : round(at(duration * i / count))))
  return { duration: round(duration), points }
}

/** A CSS `linear()` easing that follows a spring's samples. */
export function springEasing(curve: { points: number[] }): string {
  return `linear(${curve.points.join(', ')})`
}

/** A cubic-bezier near a spring (one overshoot at most), for browsers without `linear()`. */
function springBezier(curve: { points: number[] }): string {
  const overshoot = Math.max(...curve.points) - 1
  return overshoot > 0.001 ? `cubic-bezier(0.3, ${round(1 + Math.min(overshoot * 2.6, 1.5))}, 0.6, 1)` : 'cubic-bezier(0.25, 0.1, 0.25, 1)'
}

/**
 * The CSS `transition` value animating `properties` with `transition`;
 * undefined for instant ones or no properties. Springs need `linear()`
 * for their curve, else they use a cubic-bezier approximation.
 */
export function cssTransition(transition: Transition, properties: string[], { linear = true } = {}): string | undefined {
  if (transition.type === 'instant' || !properties.length) return undefined
  let timing: string
  if (transition.type === 'spring') {
    const curve = springCurve(transition.stiffness ?? SPRING_STIFFNESS, transition.damping ?? SPRING_DAMPING)
    timing = `${Math.round(curve.duration * 1000)}ms ${linear ? springEasing(curve) : springBezier(curve)}`
  } else {
    timing = `${Math.round((transition.duration ?? EASE_DURATION) * 1000)}ms ${transition.easing ?? 'ease'}`
  }
  return properties.map(property => `${property} ${timing}`).join(', ')
}

const sides = (prefix: string, suffix = '') => ({ t: [`${prefix}-top${suffix}`], r: [`${prefix}-right${suffix}`], b: [`${prefix}-bottom${suffix}`], l: [`${prefix}-left${suffix}`] })
const margin = sides('margin')
const padding = sides('padding')
const border = sides('border', '-width')

/** The CSS properties a style token key sets that can animate; layout switches (display, direction…) cannot. */
const ANIMATED: Record<string, string[]> = {
  m: ['margin'], mx: [...margin.l, ...margin.r], my: [...margin.t, ...margin.b], mt: margin.t, mr: margin.r, mb: margin.b, ml: margin.l,
  p: ['padding'], px: [...padding.l, ...padding.r], py: [...padding.t, ...padding.b], pt: padding.t, pr: padding.r, pb: padding.b, pl: padding.l,
  gap: ['gap'],
  w: ['width'], h: ['height'], minW: ['min-width'], maxW: ['max-width'], minH: ['min-height'], maxH: ['max-height'],
  bg: ['background-color'], color: ['color'], borderColor: ['border-color'],
  text: ['font-size', 'line-height'], font: ['font-weight'], tracking: ['letter-spacing'], leading: ['line-height'],
  border: ['border-width'], borderT: border.t, borderR: border.r, borderB: border.b, borderL: border.l,
  rounded: ['border-radius'], roundedTl: ['border-top-left-radius'], roundedTr: ['border-top-right-radius'], roundedBr: ['border-bottom-right-radius'], roundedBl: ['border-bottom-left-radius'],
  shadow: ['box-shadow'], opacity: ['opacity']
}

/** The CSS properties of definition node `nodeId` that any variant of `def` changes (sets or removes) and that can animate. */
export function animatedProperties(def: ComponentDefinition, nodeId: string): string[] {
  const properties = new Set<string>()
  for (const variant of def.variants) {
    const override = variant.overrides[nodeId]
    for (const key of [...Object.keys(override?.style ?? {}), ...(override?.unset ?? [])]) {
      for (const property of ANIMATED[parseStyleKey(key)?.token.key ?? ''] ?? []) properties.add(property)
    }
  }
  return [...properties]
}
