import type { ComputedRef, InjectionKey, VNode } from 'vue'
import type { DataRecord } from '#shared/data/records'
import { INSTANCE_TYPE } from '#shared/document/components'
import type { ComponentDefinition, DocNode } from '#shared/document/schema'
import type { EnvValues } from '#shared/env/variables'
import { resolveEnv } from '#shared/env/variables'
import type { BindingItem } from '#shared/runtime/bindings'
import { resolveBindings } from '#shared/runtime/bindings'
import { INSTANCE_ID_SEPARATOR } from '#shared/runtime/instances'
import { animatedProperties, createInteractionMachine, cssTransition, hasClick, hasInteractivity, initialMachineState, renderedVariant, rootElementType, transitionFor } from '#shared/runtime/interactions'

export interface RuntimeContext {
  /** Path prefix that page-slug links resolve under, e.g. `/p/shop`. */
  base: string
  /** True inside the editor canvas: links don't navigate, empty containers show a drop hint. */
  editable: boolean
  /**
   * Instances run their states and interactions (hover, pressed, click…)
   * and animate variant changes: the draft preview and published apps.
   * False in the editor canvas, which stays static while editing.
   */
  interactive?: boolean
  /**
   * Records per List query (`listKey`). A query without an entry has no known
   * collection: the canvas shows a hint, published apps render nothing.
   */
  lists: Record<string, DataRecord[]>
  /**
   * Adds a record from a Form (published apps); rejects with a message to show.
   * Absent in the canvas, where forms never submit.
   */
  submitForm?: (collection: string, values: Record<string, string>) => Promise<void>
  /** Public variables for `{{ env.NAME }}`; without them env refs stay as written. */
  env?: EnvValues
  /** The project's component definitions, which Instance nodes render from. */
  components?: ComponentDefinition[]
  /** A missing variable: kept as written (the canvas and the draft preview) or rendered empty (published apps). */
  onMissingEnv?: 'keep' | 'empty'
}

/**
 * A string prop with its bindings resolved: item ones against the List's
 * record (outside a List the canvas shows them as written, published apps
 * empty) and env ones from the runtime's public variables, in one pass.
 */
export function bindValue(value: string, runtime: Pick<RuntimeContext, 'editable' | 'env' | 'onMissingEnv'>, item?: BindingItem | null): string {
  const scope = { env: runtime.env, onMissingEnv: runtime.onMissingEnv }
  if (item) return resolveBindings(value, { item, ...scope })
  if (!runtime.editable) return resolveBindings(value, scope)
  return runtime.env ? resolveEnv(value, runtime.env, { onMissing: runtime.onMissingEnv ?? 'keep' }) : value
}

export const RUNTIME_KEY: InjectionKey<RuntimeContext> = Symbol('bildr-runtime')

export function useRuntime(): RuntimeContext {
  return inject(RUNTIME_KEY, { base: '', editable: false, lists: {} })
}

/**
 * The transitions of one interactive instance, for the nodes of its
 * definition (ids `<prefix><nodeId>`): the CSS `transition` of a node for
 * the instance's last variant change, or undefined.
 */
export interface InstanceMotion {
  prefix: string
  transitionOf: (id: string) => string | undefined
}

export const INSTANCE_MOTION_KEY: InjectionKey<InstanceMotion | null> = Symbol('bildr-instance-motion')

/** The definition node's CSS transition, when `id` is a node of the nearest interactive instance. */
export function useMotionTransition(id: () => string): ComputedRef<string | undefined> {
  const motion = inject(INSTANCE_MOTION_KEY, null)
  return computed(() => {
    if (!motion || !id().startsWith(motion.prefix)) return undefined
    const nodeId = id().slice(motion.prefix.length)
    return nodeId.includes(INSTANCE_ID_SEPARATOR) ? undefined : motion.transitionOf(nodeId)
  })
}

/** Roots that are interactive already: they keep their own role and keyboard handling. */
const NATIVE_INTERACTIVE = ['Button', 'Link', 'Input']

/** True below an instance that acts as a button: nested ones get no button role of their own. */
const BUTTON_ANCESTOR_KEY: InjectionKey<ComputedRef<boolean>> = Symbol('bildr-button-ancestor')

/**
 * Clicks (and Enter/Space) an instance's interaction handled: nested
 * instances' handlers skip them, including outer ones whose handlers sit on
 * the same root element (an instance at the root of another's definition).
 */
const handledClicks = new WeakSet<Event>()

/**
 * The states and interactions of one Instance node, outside edit mode
 * (`runtime.interactive`) and only when its component has any. It keeps the
 * instance's current variant (from its set variant, and back to it when
 * that changes), gives `variant` (the one to render: pressed over hover
 * over current), and `rootAttrs`: pointer handlers for the rendered root,
 * plus `role=button`, `tabindex=0` and Enter/Space for a click interaction
 * on a root that is not interactive (through nested instance roots too) and
 * not inside another instance acting as a button. A click an interaction
 * handled does not reach outer instances. Appear fires once, when the root enters the
 * viewport. Its definition nodes animate the changes (`InstanceMotion`),
 * instant with `prefers-reduced-motion`. Call it in setup.
 */
export function useInstanceInteractions(node: () => DocNode, runtime: RuntimeContext) {
  const definition = computed(() => (node().type === INSTANCE_TYPE ? runtime.components?.find(c => c.id === String(node().props.component)) : undefined))
  const reacts = computed(() => !!runtime.interactive && !!definition.value && hasInteractivity(definition.value))
  const setVariant = () => (typeof node().props.variant === 'string' ? node().props.variant as string : '')
  const state = reactive(initialMachineState(setVariant()))
  const machine = createInteractionMachine({ component: () => definition.value, setVariant }, state)
  watch(setVariant, () => machine.reset())

  const reducedMotion = ref(false)
  const linear = ref(true)
  let media: MediaQueryList | undefined
  const onMedia = () => (reducedMotion.value = !!media?.matches)
  let observer: IntersectionObserver | undefined
  let observed: Element | undefined
  const unobserve = () => {
    observer?.disconnect()
    observer = undefined
    observed = undefined
  }
  const observe = (el: unknown) => {
    const def = definition.value
    if (!(el instanceof Element) || el === observed || !def) return
    const appears = [def.interactions ?? [], ...def.variants.map(v => v.interactions ?? [])].some(list => list.some(i => i.on === 'appear'))
    if (!appears || state.appeared) return
    unobserve()
    if (typeof IntersectionObserver === 'undefined') return machine.appear()
    observed = el
    observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return
      machine.appear()
      unobserve()
    })
    observer.observe(el)
  }
  onMounted(() => {
    media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    onMedia()
    media?.addEventListener?.('change', onMedia)
    linear.value = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)')
  })
  onBeforeUnmount(() => {
    machine.dispose()
    unobserve()
    media?.removeEventListener?.('change', onMedia)
  })

  const variant = computed(() => (reacts.value ? renderedVariant(definition.value!, state.current, state) : undefined))

  const insideButton = inject(BUTTON_ANCESTOR_KEY, null)
  const button = computed(() => {
    const def = definition.value
    if (!reacts.value || !def || insideButton?.value || !hasClick(def)) return false
    return !NATIVE_INTERACTIVE.includes(rootElementType(def, runtime.components ?? []))
  })
  provide(BUTTON_ANCESTOR_KEY, computed(() => !!insideButton?.value || button.value))

  const click = (event: Event) => {
    if (handledClicks.has(event) || !machine.dispatch('click')) return
    handledClicks.add(event)
    event.stopPropagation()
  }

  provide(INSTANCE_MOTION_KEY, {
    prefix: `${node().id}${INSTANCE_ID_SEPARATOR}`,
    transitionOf: (nodeId) => {
      const def = definition.value
      if (!reacts.value || !def || !state.change) return undefined
      const transition = transitionFor(def, state.change.from, state.change.to, { reducedMotion: reducedMotion.value })
      return cssTransition(transition, animatedProperties(def, nodeId), { linear: linear.value })
    }
  })

  const rootAttrs = computed((): Record<string, unknown> | undefined => {
    const def = definition.value
    if (!reacts.value || !def) return undefined
    return {
      onPointerenter: () => {
        machine.hover(true)
        machine.dispatch('mouseenter')
      },
      onPointerleave: () => {
        machine.hover(false)
        machine.dispatch('mouseleave')
      },
      onPointerdown: (event: PointerEvent) => {
        if (event.button === 0) machine.press(true)
      },
      onPointerup: () => machine.press(false),
      onPointercancel: () => machine.press(false),
      onClick: click,
      onVnodeMounted: (vnode: VNode) => observe(vnode.el),
      onVnodeUpdated: (vnode: VNode) => observe(vnode.el),
      onVnodeBeforeUnmount: unobserve,
      ...(button.value
        ? {
            'role': 'button',
            'tabindex': 0,
            'data-bildr-interactive': '',
            'onKeydown': (event: KeyboardEvent) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter') {
                event.preventDefault()
                click(event)
              } else if (event.key === ' ') {
                // Space clicks on release, as a native button does; no page scroll.
                event.preventDefault()
                machine.press(true)
              }
            },
            'onKeyup': (event: KeyboardEvent) => {
              if (event.target !== event.currentTarget || event.key !== ' ') return
              machine.press(false)
              click(event)
            }
          }
        : { 'data-bildr-interactive': '' })
    }
  })

  return { variant, rootAttrs }
}

/** One repetition of a List's children. The innermost List's item shadows outer ones. */
export interface ListItemContext {
  /** The record, or null for the canvas placeholder of an empty collection. */
  item: BindingItem | null
  /** True for every repetition but the first; the canvas keeps outlines and drops on the first. */
  copy: boolean
}

export const LIST_ITEM_KEY: InjectionKey<ListItemContext> = Symbol('bildr-list-item')

export function useListItem(): ListItemContext | undefined {
  return inject(LIST_ITEM_KEY, undefined)
}
