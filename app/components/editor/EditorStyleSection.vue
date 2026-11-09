<script setup lang="ts">
/**
 * A collapsible panel section with a Figma UI3 header: the title, then its
 * actions (such as Fill's "+") on the right. Closed, a blue dot says the
 * device overrides a value inside (inherited values get no dot). The parent owns `open`, so Shift-click can toggle every section. An `empty`
 * section (a Fill with no fill) is a header only.
 */
defineProps<{ label: string, open: boolean, mark?: 'set', empty?: boolean }>()
const emit = defineEmits<{ toggle: [event: MouseEvent] }>()
</script>

<template>
  <section
    class="group/section border-b border-default"
    :data-style-section="label"
    :data-open="open || undefined"
  >
    <div class="flex h-9 items-center gap-0.5 pe-2">
      <button
        type="button"
        class="flex h-full min-w-0 flex-1 items-center gap-1.5 ps-3 text-left"
        :aria-expanded="open"
        :title="`${open ? 'Collapse' : 'Expand'} ${label} (Shift-click: all sections)`"
        @click="emit('toggle', $event)"
      >
        <span
          class="text-[11px] font-semibold"
          :class="empty ? 'text-muted' : 'text-highlighted'"
        >{{ label }}</span>
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3 shrink-0 text-dimmed transition-transform"
          :class="open ? 'opacity-0 group-hover/section:opacity-100' : '-rotate-90'"
          aria-hidden="true"
        />
        <span
          v-if="!open && mark"
          class="size-1.5 shrink-0 rounded-full bg-(color:--editor-selection)"
          :data-section-dot="mark"
          role="img"
          :aria-label="`${label} has values on this device`"
        />
      </button>
      <slot name="actions" />
    </div>
    <div
      v-if="open && !empty"
      class="space-y-2 px-3 pb-3"
    >
      <slot />
    </div>
  </section>
</template>
