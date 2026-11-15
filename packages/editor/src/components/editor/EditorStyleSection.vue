<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { ACTION, MENU_UI } from '../../editorUi.ts'

/**
 * A panel section with Framer's header: a bold white title, and on the right
 * an optional "−" (`removeLabel` is its tooltip, e.g. Reset layout) and a "+"
 * opening a small menu of the group's optional properties (`menu`, two-line
 * items when they have a `hint`), which emits `add` with the picked item's
 * id. The "+" is named `addLabel`, by default "Add <label> property".
 * `collapsed` (a section with nothing to show yet) renders the header only:
 * Framer's title plus "+". `editLabel` adds a gear before them, which emits
 * `edit` (e.g. "Edit properties…", opening the properties modal). An item
 * with `children` is a submenu (e.g. On › a target), which emits its
 * children's ids.
 */
export interface SectionMenuItem {
  id: string
  label: string
  disabled?: boolean
  /** The item's second line: what it adds, or why a disabled item is disabled. */
  hint?: string
  children?: SectionMenuItem[]
}

const props = withDefaults(defineProps<{ label: string, menu?: SectionMenuItem[], removeLabel?: string, addLabel?: string, editLabel?: string, collapsed?: boolean }>(), { menu: () => [], removeLabel: undefined, addLabel: undefined, editLabel: undefined })
const emit = defineEmits<{ add: [id: string], remove: [], edit: [] }>()

const toItem = (item: SectionMenuItem): DropdownMenuItem => ({
  label: item.label,
  description: item.hint,
  disabled: item.disabled,
  ...(item.children ? { children: item.children.map(toItem) } : { onSelect: () => emit('add', item.id) })
})
const items = computed<DropdownMenuItem[]>(() => props.menu.map(toItem))
</script>

<template>
  <section
    class="border-b border-default"
    :data-style-section="label"
    :data-collapsed="collapsed || undefined"
  >
    <div class="flex h-11 items-center gap-0.5 ps-4 pe-2.5">
      <h3 class="min-w-0 flex-1 truncate text-[12px] font-[550] text-highlighted">
        {{ label }}
      </h3>
      <UTooltip
        v-if="editLabel"
        :text="editLabel"
      >
        <button
          type="button"
          :class="ACTION"
          :aria-label="editLabel"
          data-section-action="edit"
          @click="emit('edit')"
        >
          <UIcon
            name="i-lucide-settings-2"
            class="size-4"
          />
        </button>
      </UTooltip>
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
    <div
      v-if="!collapsed"
      class="space-y-2 ps-4 pe-3 pb-3.5 empty:hidden"
    >
      <slot />
    </div>
  </section>
</template>
