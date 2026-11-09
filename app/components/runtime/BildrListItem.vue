<script setup lang="ts">
import type { BindingItem } from '#shared/runtime/bindings'

/** Scopes one repetition of a List's children to its record; renders no element of its own. */
const props = defineProps<{ item: BindingItem | null, copy: boolean }>()
const outer = useListItem()

provide(LIST_ITEM_KEY, reactive({
  item: computed(() => props.item),
  // Everything inside a copy of an outer List is a copy too.
  copy: computed(() => props.copy || outer?.copy === true)
}) as ListItemContext)
</script>

<template>
  <slot />
</template>
