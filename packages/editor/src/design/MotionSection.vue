<script setup lang="ts">
import { computed } from 'vue'
import type { ComponentFile, Transition } from '@bildr/codegen/model'
import CommitInput from './CommitInput.vue'
import { TRANSITION_EASINGS, TRANSITION_TYPES, VARIANT_EVENTS } from './kinds.ts'
import { useDesign } from './store.ts'

/**
 * The interactions (on click, mouseenter, mouseleave or appear: switch the
 * instance to a variant, after a delay) and the transition (how style changes
 * animate between variants) of the variant being edited, or of the primary.
 * A variant's transition is its own; without one it uses the component's.
 */

const props = defineProps<{ component: ComponentFile }>()
const design = useDesign()

const owner = computed(() => design.variant.value ?? props.component)
const ownerId = computed(() => design.variantId.value ?? '')
const interactions = computed(() => owner.value.interactions ?? [])
const targets = computed(() => props.component.variants.filter(variant => !variant.state))
const transition = computed<Transition | undefined>(() => owner.value.transition)

const edit = (action: string, input: Record<string, unknown>) => design.edit(action, { component: props.component.id, variant: ownerId.value, ...input })

const add = () => edit('component_interaction_add', { on: 'click', to: targets.value[0]?.id ?? '' })
const update = (index: number, patch: Record<string, unknown>) => edit('component_interaction_update', { index, ...patch })
const commitDelay = (index: number, raw: string) => update(index, { delay: raw.trim() === '' || Number.isNaN(Number(raw)) ? null : Number(raw) })

const DEFAULTS: Record<string, Transition> = {
  instant: { type: 'instant' },
  ease: { type: 'ease', duration: 0.2, easing: 'ease-out' },
  spring: { type: 'spring', stiffness: 400, damping: 25 }
}
const setTransition = (next: Transition | null) => edit('component_transition_set', { transition: next })
const pickType = (event: Event) => {
  const type = (event.target as HTMLSelectElement).value
  return setTransition(type === 'none' ? null : { ...DEFAULTS[type]! })
}
const number = (raw: string, fallback: number) => raw.trim() === '' || Number.isNaN(Number(raw)) ? fallback : Number(raw)
const ease = (patch: Partial<Transition>) => setTransition({ ...DEFAULTS.ease!, ...transition.value, ...patch, type: 'ease' })
const spring = (patch: Partial<Transition>) => setTransition({ ...DEFAULTS.spring!, ...transition.value, ...patch, type: 'spring' })
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-xs'
</script>

<template>
  <div
    class="flex flex-col gap-3"
    data-testid="motion"
  >
    <div class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-muted">
        Interactions of {{ design.variant.value?.name ?? 'the primary' }}
      </h4>
      <div
        v-for="(interaction, index) in interactions"
        :key="index"
        class="grid grid-cols-[1fr_1fr_3.5rem_1rem] items-center gap-1"
        data-testid="interaction"
      >
        <select
          :data-testid="`interaction-on-${index}`"
          :class="field"
          :value="interaction.on"
          aria-label="On"
          @change="update(index, { on: ($event.target as HTMLSelectElement).value })"
        >
          <option
            v-for="event in VARIANT_EVENTS"
            :key="event"
            :value="event"
          >
            {{ event }}
          </option>
        </select>
        <select
          :data-testid="`interaction-to-${index}`"
          :class="field"
          :value="interaction.do[0].to"
          aria-label="Go to"
          @change="update(index, { to: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">
            Primary
          </option>
          <option
            v-for="target in targets"
            :key="target.id"
            :value="target.id"
          >
            {{ target.name }}
          </option>
        </select>
        <CommitInput
          :data-testid="`interaction-delay-${index}`"
          :model-value="interaction.do[0].delay === undefined ? '' : String(interaction.do[0].delay)"
          placeholder="Delay s"
          @commit="commitDelay(index, $event)"
        />
        <button
          type="button"
          :data-testid="`interaction-remove-${index}`"
          aria-label="Remove interaction"
          @click="edit('component_interaction_remove', { index })"
        >
          <UIcon
            name="i-lucide-x"
            class="size-3"
          />
        </button>
      </div>
      <UButton
        data-testid="interaction-add"
        label="Add interaction"
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="soft"
        class="self-start"
        @click="add()"
      />
    </div>

    <div
      class="flex flex-col gap-1.5"
      data-testid="transition"
    >
      <h4 class="text-xs font-medium text-muted">
        Transition of {{ design.variant.value?.name ?? 'the component' }}
      </h4>
      <select
        data-testid="transition-type"
        :class="field"
        :value="transition?.type ?? 'none'"
        aria-label="Transition"
        @change="pickType"
      >
        <option value="none">
          {{ design.variant.value ? 'Same as the component' : 'None' }}
        </option>
        <option
          v-for="type in TRANSITION_TYPES"
          :key="type"
          :value="type"
        >
          {{ type }}
        </option>
      </select>
      <template v-if="transition?.type === 'ease'">
        <CommitInput
          data-testid="transition-duration"
          :model-value="String(transition.duration ?? 0.2)"
          placeholder="Duration s"
          @commit="ease({ duration: number($event, 0.2) })"
        />
        <select
          data-testid="transition-easing"
          :class="field"
          :value="transition.easing ?? 'ease-out'"
          aria-label="Easing"
          @change="ease({ easing: ($event.target as HTMLSelectElement).value as Transition['easing'] })"
        >
          <option
            v-for="easing in TRANSITION_EASINGS"
            :key="easing"
            :value="easing"
          >
            {{ easing }}
          </option>
        </select>
      </template>
      <template v-else-if="transition?.type === 'spring'">
        <CommitInput
          data-testid="transition-stiffness"
          :model-value="String(transition.stiffness ?? 400)"
          placeholder="Stiffness"
          @commit="spring({ stiffness: number($event, 400) })"
        />
        <CommitInput
          data-testid="transition-damping"
          :model-value="String(transition.damping ?? 25)"
          placeholder="Damping"
          @commit="spring({ damping: number($event, 25) })"
        />
      </template>
    </div>
  </div>
</template>
