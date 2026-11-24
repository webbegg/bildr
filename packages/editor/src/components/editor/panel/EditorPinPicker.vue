<script setup lang="ts">
import { computed } from 'vue'
import type { Pin, PinAxis } from '../../../shared/pin.ts'

/**
 * The pin of a positioned node (layout-containers L5): a 3×3 grid that pins
 * both axes at once to a side or the centre, and a Stretch toggle per axis
 * (both sides). It emits the axes to write; the panel turns them into the
 * inset tokens (`pinWrite`).
 */
const props = defineProps<{ h: Pin | undefined, v: Pin | undefined, mixed?: boolean }>()
const emit = defineEmits<{ pin: [axes: Partial<Record<PinAxis, Pin>>] }>()

const PLACES = ['start', 'center', 'end'] as const
const H_NAMES = { start: 'left', center: 'centre', end: 'right' }
const V_NAMES = { start: 'Top', center: 'Middle', end: 'Bottom' }
const cells = computed(() => PLACES.flatMap(v => PLACES.map(h => ({
  h,
  v,
  label: `${V_NAMES[v]} ${H_NAMES[h]}`,
  // A stretched axis matches every cell along it.
  active: !props.mixed && (props.h === h || props.h === 'stretch') && (props.v === v || props.v === 'stretch')
}))))
const stretch = (axis: PinAxis) => (axis === 'h' ? props.h : props.v) === 'stretch'
</script>

<template>
  <div class="flex items-center gap-2">
    <div
      class="grid h-[54px] w-[78px] shrink-0 grid-cols-3 grid-rows-3 rounded-lg bg-elevated p-0.5"
      role="group"
      aria-label="Pin"
      data-pin-picker
      :data-pin="`${h ?? ''},${v ?? ''}`"
    >
      <button
        v-for="cell in cells"
        :key="`${cell.h},${cell.v}`"
        type="button"
        class="group grid place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-primary"
        :aria-label="`Pin ${cell.label}`"
        :aria-pressed="cell.active"
        :data-pin-cell="`${cell.h},${cell.v}`"
        @click="emit('pin', { h: cell.h, v: cell.v })"
      >
        <span
          class="block rounded-full"
          :class="cell.active ? 'size-2 bg-primary' : 'size-1 bg-white/25 group-hover:bg-white/60'"
        />
      </button>
    </div>
    <div class="flex flex-col gap-1">
      <button
        v-for="axis in (['h', 'v'] as const)"
        :key="axis"
        type="button"
        class="flex h-6 items-center gap-1 rounded-md bg-elevated px-2 text-[11px]"
        :class="stretch(axis) ? 'text-primary' : 'text-muted hover:text-highlighted'"
        :aria-pressed="stretch(axis)"
        :data-pin-stretch="axis"
        @click="emit('pin', { [axis]: stretch(axis) ? 'start' : 'stretch' })"
      >
        <UIcon
          :name="axis === 'h' ? 'i-lucide-move-horizontal' : 'i-lucide-move-vertical'"
          class="size-3"
        />
        Stretch
      </button>
    </div>
  </div>
</template>
