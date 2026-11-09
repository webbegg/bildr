<script setup lang="ts">
import type { Provenance } from '#shared/editor/styleFields'

/**
 * One label-column row of the panel, Framer's layout: a grey label in a
 * fixed column on the left (blue when overridden, with Reset override), the
 * control on the right. `scrub` makes dragging the label scrub the control,
 * and the `below` slot spans the control column under it (joined side fields).
 */
withDefaults(defineProps<{
  label: string
  /** The full property name, for the tooltip. */
  title?: string
  provenance?: Provenance
  device?: string
  /** The row's key, for `data-field-label`. */
  name?: string
  scrub?: (event: PointerEvent) => void
}>(), { title: undefined, provenance: () => ({ state: 'unset' }), device: '', name: undefined, scrub: undefined })
const emit = defineEmits<{ reset: [] }>()
</script>

<template>
  <div class="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-2">
    <div
      class="flex h-[30px] min-w-0 items-center"
      :class="{ 'cursor-ew-resize': scrub }"
      :data-field-label="name"
      @pointerdown="scrub?.($event)"
    >
      <EditorFieldLabel
        :label="label"
        :title="title ?? label"
        :provenance="provenance"
        :device="device"
        @reset="emit('reset')"
      />
    </div>
    <div class="flex min-h-[30px] min-w-0 items-center gap-2">
      <slot />
    </div>
    <div
      v-if="$slots.below"
      class="col-start-2 mt-2 min-w-0"
    >
      <slot name="below" />
    </div>
  </div>
</template>
