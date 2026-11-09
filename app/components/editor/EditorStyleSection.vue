<script setup lang="ts">
/**
 * A collapsible style section header (Stacki's SectionBlock). Closed, a dot
 * says what is inside: blue when the device sets a value, orange when it only
 * inherits. The parent owns `open`, so Shift-click can toggle every section.
 */
defineProps<{ label: string, open: boolean, mark?: 'set' | 'inherited' }>()
const emit = defineEmits<{ toggle: [event: MouseEvent] }>()
</script>

<template>
  <section
    class="border-b border-default"
    :data-style-section="label"
    :data-open="open || undefined"
  >
    <button
      type="button"
      class="flex h-9 w-full items-center gap-2 px-3 text-left"
      :aria-expanded="open"
      :title="`${open ? 'Collapse' : 'Expand'} ${label} (Shift-click: all sections)`"
      @click="emit('toggle', $event)"
    >
      <span class="flex-1 text-xs font-semibold text-highlighted">{{ label }}</span>
      <span
        v-if="!open && mark"
        class="size-1.5 shrink-0 rounded-full"
        :class="mark === 'set' ? 'bg-(color:--editor-selection)' : 'bg-(color:--editor-provenance)'"
        :data-section-dot="mark"
        role="img"
        :aria-label="mark === 'set' ? `${label} has values on this device` : `${label} inherits values from a smaller device`"
      />
      <UIcon
        name="i-lucide-chevron-down"
        class="size-3.5 shrink-0 text-dimmed transition-transform"
        :class="{ '-rotate-90': !open }"
      />
    </button>
    <div
      v-if="open"
      class="space-y-1 px-3 pb-3"
    >
      <slot />
    </div>
  </section>
</template>
