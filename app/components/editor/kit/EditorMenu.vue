<script setup lang="ts">
import type { DropdownMenuItem, DropdownMenuProps } from '@nuxt/ui'

/**
 * The kit's dropdown over UDropdownMenu with MENU_UI. The default slot is the
 * trigger; UDropdownMenu's other slots and attributes (`modal`, `open`) pass
 * through. `content` defaults to below, aligned to the start, 4 px off; set
 * `onCloseAutoFocus` (`@close-auto-focus`) to choose where focus goes on close,
 * e.g. into a field the menu just revealed.
 */
const props = withDefaults(defineProps<{
  items: DropdownMenuItem[] | DropdownMenuItem[][]
  content?: DropdownMenuProps['content']
  onCloseAutoFocus?: (event: Event) => void
  ui?: UiSlots
}>(), { content: undefined, onCloseAutoFocus: undefined, ui: undefined })

const content = computed(() => ({
  align: 'start' as const,
  side: 'bottom' as const,
  sideOffset: 4,
  ...props.content,
  ...(props.onCloseAutoFocus ? { onCloseAutoFocus: props.onCloseAutoFocus } : {})
}))
const ui = computed(() => mergeUi(MENU_UI, props.ui))
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="content"
    :ui="ui"
  >
    <template
      v-for="(_, name) in $slots"
      #[name]="slotProps"
    >
      <slot
        :name="name"
        v-bind="slotProps ?? {}"
      />
    </template>
  </UDropdownMenu>
</template>
