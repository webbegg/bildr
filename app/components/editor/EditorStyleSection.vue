<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * A panel section with Framer's header: a bold white title that never
 * collapses, and on the right an optional "−" (`removeLabel` is its tooltip,
 * e.g. Reset layout) and a "+" opening a small menu of the group's optional
 * properties (`menu`), which emits `add` with the picked item's id. The "+"
 * is named `addLabel`, by default "Add <label> property".
 */
export interface SectionMenuItem {
  id: string
  label: string
  disabled?: boolean
  /** Why a disabled item is disabled. */
  hint?: string
}

const props = withDefaults(defineProps<{ label: string, menu?: SectionMenuItem[], removeLabel?: string, addLabel?: string }>(), { menu: () => [], removeLabel: undefined, addLabel: undefined })
const emit = defineEmits<{ add: [id: string], remove: [] }>()

const items = computed<DropdownMenuItem[]>(() => props.menu.map(item => ({
  label: item.label,
  description: item.hint,
  disabled: item.disabled,
  onSelect: () => emit('add', item.id)
})))
</script>

<template>
  <section
    class="border-b border-default"
    :data-style-section="label"
  >
    <div class="flex h-11 items-center gap-0.5 ps-4 pe-2.5">
      <h3 class="min-w-0 flex-1 truncate text-[12px] font-[550] text-highlighted">
        {{ label }}
      </h3>
      <UTooltip
        v-if="removeLabel"
        :text="removeLabel"
      >
        <button
          type="button"
          :class="ACTION"
          :aria-label="removeLabel"
          data-section-action="remove"
          @click="emit('remove')"
        >
          <UIcon
            name="i-lucide-minus"
            class="size-4"
          />
        </button>
      </UTooltip>
      <UDropdownMenu
        v-if="menu.length"
        :items="items"
        :content="{ align: 'end', side: 'bottom', sideOffset: 4 }"
        :ui="MENU_UI"
      >
        <button
          type="button"
          :class="ACTION"
          :aria-label="addLabel ?? `Add ${label.toLowerCase()} property`"
          data-section-action="add"
        >
          <UIcon
            name="i-lucide-plus"
            class="size-4"
          />
        </button>
      </UDropdownMenu>
    </div>
    <div class="space-y-2 ps-4 pe-3 pb-3.5 empty:hidden">
      <slot />
    </div>
  </section>
</template>
