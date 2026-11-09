<script setup lang="ts">
/**
 * A panel section with Framer's header: a bold white title, and a "+" on the
 * right while it is closed (it opens it) or a "−" while it is open and
 * `removable` (it removes the section's values). Clicking the title also
 * toggles it; the parent owns `open`, so Shift-click can toggle every section.
 * Closed, a blue dot says the device overrides a value inside.
 */
withDefaults(defineProps<{ label: string, open: boolean, mark?: 'set', removable?: boolean }>(), { mark: undefined, removable: false })
const emit = defineEmits<{ toggle: [event: MouseEvent], remove: [] }>()
</script>

<template>
  <section
    class="border-b border-default"
    :data-style-section="label"
    :data-open="open || undefined"
  >
    <div class="flex h-11 items-center gap-1 ps-4 pe-2.5">
      <button
        type="button"
        class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        :aria-expanded="open"
        :title="`${open ? 'Collapse' : 'Expand'} ${label} (Shift-click: all sections)`"
        @click="emit('toggle', $event)"
      >
        <span class="text-[13px] font-semibold text-highlighted">{{ label }}</span>
        <span
          v-if="!open && mark"
          class="size-1.5 shrink-0 rounded-full bg-(color:--editor-selection)"
          :data-section-dot="mark"
          role="img"
          :aria-label="`${label} has values on this device`"
        />
      </button>
      <button
        v-if="!open || removable"
        type="button"
        class="grid size-6 shrink-0 place-items-center rounded-md text-toned hover:bg-white/8 hover:text-highlighted"
        :aria-label="`${open ? 'Remove' : 'Add'} ${label.toLowerCase()}`"
        :data-section-action="open ? 'remove' : 'add'"
        @click="open ? emit('remove') : emit('toggle', $event)"
      >
        <UIcon
          :name="open ? 'i-lucide-minus' : 'i-lucide-plus'"
          class="size-4"
        />
      </button>
    </div>
    <div
      v-if="open"
      class="space-y-2 ps-4 pe-3 pb-3.5"
    >
      <slot />
    </div>
  </section>
</template>
