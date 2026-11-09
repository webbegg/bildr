<script setup lang="ts">
import { scaleStops, stopIndex } from '#shared/editor/scale'

/**
 * Framer's slider beside a number field, snapping to the token scale's stops.
 * It previews the stop it is dragged to and commits once on release (one undo
 * step), the same path as a scrub; arrow keys commit each step.
 */
const props = defineProps<{ tokenKey: string, label: string, value: string | undefined }>()
const emit = defineEmits<{ preview: [value: string | null], commit: [value: string] }>()

const stops = computed(() => scaleStops(props.tokenKey))
const draft = ref<string | null>(null)
const index = computed(() => stopIndex(props.tokenKey, draft.value ?? props.value))
const fill = computed(() => `${(index.value / Math.max(1, stops.value.length - 1)) * 100}%`)

function onInput(event: Event) {
  const next = stops.value[Number((event.target as HTMLInputElement).value)]
  if (next === undefined || next === draft.value) return
  draft.value = next
  emit('preview', next)
}

function onChange() {
  const next = draft.value
  draft.value = null
  emit('preview', null)
  if (next !== null && next !== props.value) emit('commit', next)
}
</script>

<template>
  <input
    type="range"
    min="0"
    :max="stops.length - 1"
    step="1"
    :value="index"
    :aria-label="`${label} slider`"
    :aria-valuetext="draft ?? value"
    class="h-[30px] min-w-0 flex-1 cursor-pointer appearance-none bg-transparent outline-none [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-(image:--track) [&::-webkit-slider-thumb]:-mt-[5.5px] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-(color:--editor-selection)"
    :style="{ '--track': `linear-gradient(to right, rgba(255,255,255,0.5) ${fill}, rgba(255,255,255,0.12) ${fill})` }"
    :data-slider="tokenKey"
    @input="onInput"
    @change="onChange"
  >
</template>
