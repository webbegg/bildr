<script setup lang="ts">
/** A row checkbox that hands over the click, so Shift-click can select a range. */
defineProps<{ checked: boolean, indeterminate?: boolean, label: string }>()
const emit = defineEmits<{ toggle: [event: MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="indeterminate ? 'mixed' : checked"
    :aria-label="label"
    tabindex="-1"
    class="flex size-4 items-center justify-center rounded-[4px] ring-1 ring-inset transition-colors"
    :class="checked || indeterminate ? 'bg-primary text-white ring-primary' : 'ring-white/20 hover:ring-white/40'"
    @mousedown.prevent
    @click.stop="emit('toggle', $event)"
  >
    <UIcon
      v-if="checked || indeterminate"
      :name="indeterminate ? 'i-lucide-minus' : 'i-lucide-check'"
      class="size-3"
    />
  </button>
</template>
