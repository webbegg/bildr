<script setup lang="ts">
import type { Provenance } from '#shared/editor/styleFields'

/**
 * One label-column row of the panel, Framer's layout: a grey label in a
 * fixed column on the left (blue when overridden, with Reset override), the
 * control on the right. `scrub` makes dragging the label scrub the control,
 * and the `below` slot spans the control column under it (joined side fields).
 * A `removable` row (an added optional property) shows a "−" (or `removeIcon`)
 * at the end of the label column on hover, which emits `remove`. `bind` (a
 * base token key) puts the binding dot in the gutter before the label
 * (see EditorBindingDot), and while that key is bound, the property's chip
 * in place of the control (EditorBindingValue).
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
  removable?: boolean
  removeIcon?: string
  bind?: string
}>(), { title: undefined, provenance: () => ({ state: 'unset' }), device: '', name: undefined, scrub: undefined, removable: false, removeIcon: 'i-lucide-minus', bind: undefined })
const emit = defineEmits<{ reset: [], remove: [] }>()
</script>

<template>
  <div class="group/row grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-2">
    <div
      class="relative flex h-[30px] min-w-0 items-center gap-1"
      :class="{ 'cursor-ew-resize': scrub }"
      :data-field-label="name"
      @pointerdown="scrub?.($event)"
    >
      <EditorBindingDot
        v-if="bind"
        mode="style"
        :name="bind"
      />
      <EditorFieldLabel
        :label="label"
        :title="title ?? label"
        :provenance="provenance"
        :device="device"
        @reset="emit('reset')"
      />
      <button
        v-if="removable"
        type="button"
        class="order-2 ms-auto grid size-5 shrink-0 place-items-center rounded-lg text-dimmed opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-white/8 hover:text-highlighted focus-visible:opacity-100"
        :aria-label="`Remove ${(title ?? label).toLowerCase()}`"
        :title="`Remove ${(title ?? label).toLowerCase()}${device ? ` on ${device}` : ''}`"
        data-row-remove
        @pointerdown.stop
        @click="emit('remove')"
      >
        <UIcon
          :name="removeIcon"
          class="size-3.5"
        />
      </button>
    </div>
    <div class="flex min-h-[30px] min-w-0 items-center gap-2">
      <EditorBindingValue
        v-if="bind"
        mode="style"
        :name="bind"
      >
        <slot />
      </EditorBindingValue>
      <slot v-else />
    </div>
    <div
      v-if="$slots.below"
      class="col-start-2 mt-2 min-w-0"
    >
      <slot name="below" />
    </div>
  </div>
</template>
