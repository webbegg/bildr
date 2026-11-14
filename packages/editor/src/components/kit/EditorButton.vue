<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { BUTTON_ICON, BUTTON_SIZES, BUTTON_SQUARE, BUTTON_VARIANTS, mergeUi } from '../../editorUi.ts'
import type { UiSlots } from '../../editorUi.ts'
import type { RouteLocationRaw } from 'vue-router'

/**
 * The kit's button. `primary` (selection blue) for the one main action,
 * `soft` (`bg-elevated`) for secondary ones, `ghost` for toolbar and row
 * actions, `danger` for destructive ones; `sm` is the 30 px field height, `xs`
 * 24 px. Without a label or slot it is a square icon button (give it an
 * `aria-label`).
 */
const props = withDefaults(defineProps<{
  variant?: keyof typeof BUTTON_VARIANTS
  size?: 'sm' | 'xs'
  icon?: string
  trailingIcon?: string
  label?: string
  loading?: boolean
  block?: boolean
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  to?: RouteLocationRaw
  ui?: UiSlots
}>(), { variant: 'soft', size: 'sm', icon: undefined, trailingIcon: undefined, label: undefined, type: 'button', to: undefined, ui: undefined })

const slots = useSlots()
const look = computed(() => BUTTON_VARIANTS[props.variant])
const ui = computed(() => {
  const square = !props.label && !slots.default
  return mergeUi({
    base: [BUTTON_SIZES[props.size], square && !props.block ? BUTTON_SQUARE[props.size] : '', look.value.class].filter(Boolean).join(' '),
    leadingIcon: BUTTON_ICON[props.size],
    trailingIcon: BUTTON_ICON[props.size]
  }, props.ui)
})
</script>

<template>
  <UButton
    :color="look.color"
    :variant="look.variant"
    :size="size"
    :icon="icon"
    :trailing-icon="trailingIcon"
    :label="label"
    :loading="loading"
    :block="block"
    :type="type"
    :disabled="disabled"
    :to="to"
    :ui="ui"
  >
    <template
      v-if="$slots.default"
      #default
    >
      <slot />
    </template>
  </UButton>
</template>
