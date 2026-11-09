<script setup lang="ts">
/**
 * A compact segmented control (Figma's): equal segments in an inset track,
 * with one pill that slides to the current value. An `inherited` value (from
 * a smaller breakpoint) or a `fallback` (what applies by default) gets a dim
 * pill when nothing is set: only overrides are highlighted, as in Framer. With `tooltips`, icon
 * segments show their label in a delayed tooltip; `dense` is the 24 px panel
 * field height.
 */
const props = defineProps<{
  items: { value: string, label: string, icon?: string }[]
  modelValue: string | undefined
  inherited?: string
  fallback?: string
  tooltips?: boolean
  dense?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const shown = computed(() => props.modelValue ?? props.inherited ?? props.fallback)
const index = computed(() => props.items.findIndex(item => item.value === shown.value))
const tone = computed(() => (props.modelValue !== undefined ? 'set' : 'fallback'))
const isInherited = (value: string) => props.modelValue === undefined && value === props.inherited
</script>

<template>
  <div
    class="relative flex min-w-0 p-0.5"
    :class="dense ? 'h-6 rounded-[5px] bg-elevated' : 'h-7 rounded-md bg-muted'"
    role="group"
  >
    <span
      v-if="index >= 0"
      class="absolute inset-y-0.5 left-0.5 transition-transform duration-200"
      :class="[dense ? 'rounded-[4px]' : 'rounded-[5px]', tone === 'fallback' ? 'bg-white/6' : dense ? 'bg-white/14' : 'bg-accented']"
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
        class="relative flex min-w-0 flex-1 items-center justify-center rounded-[5px] px-1 transition-colors"
        :class="[dense ? 'text-[11px]' : 'text-xs', item.value !== shown
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
          :class="dense ? 'size-3' : 'size-3.5'"
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
