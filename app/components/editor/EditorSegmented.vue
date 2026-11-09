<script setup lang="ts">
/**
 * A compact segmented control (Stacki's SegmentedControl): equal segments in
 * an inset track, with one pill that slides to the current value. An
 * `inherited` value (from a smaller breakpoint) gets the pill in orange when
 * nothing is set, and a `fallback` (what applies by default) a dim one.
 * With `tooltips`, icon segments show their label in a delayed tooltip.
 */
const props = defineProps<{
  items: { value: string, label: string, icon?: string }[]
  modelValue: string | undefined
  inherited?: string
  fallback?: string
  tooltips?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const shown = computed(() => props.modelValue ?? props.inherited ?? props.fallback)
const index = computed(() => props.items.findIndex(item => item.value === shown.value))
const tone = computed(() => (props.modelValue !== undefined ? 'set' : props.inherited !== undefined ? 'inherited' : 'fallback'))
const isInherited = (value: string) => props.modelValue === undefined && value === props.inherited
</script>

<template>
  <div
    class="relative flex h-7 min-w-0 rounded-md bg-muted p-0.5"
    role="group"
  >
    <span
      v-if="index >= 0"
      class="absolute inset-y-0.5 left-0.5 rounded-[5px] transition-transform duration-200"
      :class="tone === 'fallback' ? 'bg-elevated/60' : 'bg-accented'"
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
        class="relative flex min-w-0 flex-1 items-center justify-center rounded-[5px] px-1 text-xs transition-colors"
        :class="item.value !== shown
          ? 'text-muted hover:text-highlighted'
          : tone === 'set' ? 'text-highlighted' : tone === 'inherited' ? 'text-(color:--editor-provenance)' : 'text-toned'"
        :aria-label="item.label"
        :aria-pressed="item.value === modelValue"
        :data-inherited="isInherited(item.value) || undefined"
        @click="emit('update:modelValue', item.value)"
      >
        <UIcon
          v-if="item.icon"
          :name="item.icon"
          class="size-3.5 shrink-0"
        />
        <span
          v-else
          class="truncate"
        >{{ item.label }}</span>
      </button>
    </UTooltip>
  </div>
</template>
