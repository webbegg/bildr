<script setup lang="ts">
/**
 * Framer's all / individual toggle (a square, a dashed square) beside a
 * padding, margin, radius or border field. `name` completes the accessible
 * names, e.g. "All padding" and "Individual padding".
 */
const props = defineProps<{ modelValue: boolean, name: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const modes = computed(() => [
  { value: false, icon: 'i-lucide-square', label: `All ${props.name}` },
  { value: true, icon: 'i-lucide-square-dashed', label: `Individual ${props.name}` }
])
</script>

<template>
  <div
    class="flex h-[30px] shrink-0 rounded-lg bg-elevated p-0.5"
    role="group"
  >
    <UTooltip
      v-for="mode in modes"
      :key="mode.label"
      :text="mode.label"
      :delay-duration="500"
    >
      <button
        type="button"
        class="grid w-7 place-items-center rounded-md"
        :class="modelValue === mode.value ? 'bg-white/14 text-highlighted' : 'text-muted hover:text-highlighted'"
        :aria-label="mode.label"
        :aria-pressed="modelValue === mode.value"
        @click="mode.value !== modelValue && emit('update:modelValue', mode.value)"
      >
        <UIcon
          :name="mode.icon"
          class="size-3.5"
        />
      </button>
    </UTooltip>
  </div>
</template>
