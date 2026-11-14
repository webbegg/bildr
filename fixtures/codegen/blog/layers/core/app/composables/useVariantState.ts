import type { MaybeRefOrGetter, Ref } from 'vue'

/**
 * The variant a component instance shows, for generated components with
 * states or interactions: plain Vue, no bildr runtime (decision D4). It
 * starts from the instance's `variant` prop and follows it when that
 * changes. A hover or pressed state of the current variant shows while the
 * pointer is over or pressing the instance (pressed wins), and interactions
 * switch the variant after their delay: `appear` once, when the root (the
 * template ref that `root` names) enters the viewport. Bind `on` to the
 * root: `v-on="on"`.
 */
export type VariantEvent = 'click' | 'mouseenter' | 'mouseleave' | 'appear'

export interface VariantInteraction<V extends string> {
  on: VariantEvent
  to: V
  /** Seconds before switching. */
  delay?: number
}

export interface VariantMachine<V extends string> {
  /** Per base variant, the variants that are its hover and pressed states. */
  states?: Partial<Record<V, { hover?: V, pressed?: V }>>
  /** Per variant, the events that switch it to another one. */
  interactions?: Partial<Record<V, Array<VariantInteraction<V>>>>
}

export const useVariantState = <V extends string>(variant: MaybeRefOrGetter<V>, machine: VariantMachine<V>, root?: string) => {
  const current = ref(toValue(variant)) as Ref<V>
  const hover = ref(false)
  const pressed = ref(false)
  const shown = computed<V>(() => {
    const states = machine.states?.[current.value]
    return (pressed.value ? states?.pressed : undefined) ?? (hover.value ? states?.hover : undefined) ?? current.value
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  // The state shown until a pointer change still hears the event that ends it (a pressed state's click).
  let released: V | undefined
  const pointer = (change: () => void) => {
    const before = shown.value
    change()
    released = before !== shown.value ? before : undefined
  }
  const dispatch = (event: VariantEvent) => {
    const owners = [...new Set([released, shown.value, current.value])]
    released = undefined
    for (const owner of owners) {
      const step = owner === undefined ? undefined : machine.interactions?.[owner]?.find(interaction => interaction.on === event)
      if (!step) continue
      cancel()
      const go = () => {
        timer = undefined
        current.value = step.to
      }
      if (step.delay) timer = setTimeout(go, step.delay * 1000)
      else go()
      return
    }
  }
  watch(() => toValue(variant), (value) => {
    cancel()
    current.value = value
  })

  const element = root ? useTemplateRef<Element | { $el?: Element }>(root) : undefined
  let observer: IntersectionObserver | undefined
  onMounted(() => {
    const target = element?.value
    const el = target instanceof Element ? target : target?.$el
    if (!el || typeof IntersectionObserver === 'undefined') return
    observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer?.disconnect()
      dispatch('appear')
    })
    observer.observe(el)
  })
  onBeforeUnmount(() => {
    cancel()
    observer?.disconnect()
  })

  return {
    variant: shown,
    on: {
      mouseenter: () => {
        pointer(() => (hover.value = true))
        dispatch('mouseenter')
      },
      mouseleave: () => {
        pointer(() => {
          hover.value = false
          pressed.value = false
        })
        dispatch('mouseleave')
      },
      pointerdown: () => pointer(() => (pressed.value = true)),
      pointerup: () => pointer(() => (pressed.value = false)),
      click: () => dispatch('click')
    }
  }
}
