<script setup lang="ts">
import { computed } from 'vue'
import { FIELD, FOCUS_RING } from '../editorUi.ts'
/**
 * A compact segmented control (Figma's): equal segments in an inset track,
 * with one pill that slides to the current value. An `inherited` value (from
 * a smaller breakpoint) or a `fallback` (what applies by default) gets a dim
 * pill when nothing is set: only overrides are highlighted, as in Framer. With `tooltips`, icon
 * segments show their label in a delayed tooltip; `dense` (the default) is the
 * kit's 30 px field (FIELD in editorUi.ts), `:dense="false"` a 28 px inset track.
 * The pill and segments are `rounded-md` (6 px), concentric inside the 8 px
 * track's 2 px inset.
 */
const props = withDefaults(defineProps<{
  items: { value: string, label: string, icon?: string }[]
  modelValue: string | undefined
  inherited?: string
  fallback?: string
  tooltips?: boolean
  dense?: boolean
}>(), { inherited: undefined, fallback: undefined, dense: true })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const shown = computed(() => props.modelValue ?? props.inherited ?? props.fallback)
const index = computed(() => props.items.findIndex(item => item.value === shown.value))
const tone = computed(() => (props.modelValue !== undefined ? 'set' : 'fallback'))
const isInherited = (value: string) => props.modelValue === undefined && value === props.inherited
</script>

<template>
  <div
    class="relative flex min-w-0 p-0.5"
    :class="dense ? `${FIELD} w-full` : 'h-7 rounded-lg bg-muted'"
    role="group"
  >
    <span
      v-if="index >= 0"
      class="absolute inset-y-0.5 left-0.5 transition-transform duration-200"
      :class="['rounded-md', tone === 'fallback' ? 'bg-white/6' : dense ? 'bg-white/14' : 'bg-accented']"
      :style="{ width: `calc((100% - 4px) / ${items.length})`, transform: `translateX(${index * 100}%)` }"
      aria-hidden="true"
    />
    <UTooltip
      v-for="item in items"
      :key="item.value"
      :text="item.label"
      :delay-duration="500"
      :disabled="!tooltips || !item.icon"
    >
      <button
        type="button"
        class="relative flex min-w-0 flex-1 items-center justify-center rounded-md px-1 transition-colors"
        :class="[FOCUS_RING, dense ? 'text-[12px]' : 'text-xs', item.value !== shown
          ? 'text-muted hover:text-highlighted'
          : tone === 'set' ? 'text-highlighted' : 'text-toned']"
        :aria-label="item.label"
        :aria-pressed="item.value === modelValue"
        :data-inherited="isInherited(item.value) || undefined"
        @click="emit('update:modelValue', item.value)"
      >
        <UIcon
          v-if="item.icon"
          :name="item.icon"
          :class="dense ? 'size-4' : 'size-3.5'"
          class="shrink-0"
        />
        <span
          v-else
          class="truncate"
        >{{ item.label }}</span>
      </button>
    </UTooltip>
  </div>
</template>
