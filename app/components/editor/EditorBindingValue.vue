<script setup lang="ts">
import { useBinding } from '~/composables/useBinding'

/**
 * A bindable row's value column, Framer's token chip: while the row's own
 * key is bound to a property (or layout variable), a chip `◇ Title ×` takes
 * the place of the value control. Clicking the chip opens the properties
 * modal on that property, × unbinds it (one undo step). Otherwise the
 * default slot (the row's control) shows.
 */
const props = defineProps<{ mode: 'style' | 'prop', name: string }>()
const { editor, ownBound, owner, unbind } = useBinding(() => props.mode, () => props.name)
</script>

<template>
  <div
    v-if="ownBound && owner"
    class="flex h-[30px] w-full min-w-0 items-center"
    data-binding-chip
    :data-bound-name="ownBound.name"
  >
    <div class="flex h-6 min-w-0 items-center rounded-md bg-(--editor-context)/15 text-(--editor-context) ring-1 ring-(--editor-context)/30 ring-inset">
      <button
        type="button"
        class="flex h-full min-w-0 items-center gap-1 rounded-s-md ps-1.5 pe-1 text-[12px] font-[550] outline-none hover:bg-(--editor-context)/15 focus-visible:ring-1 focus-visible:ring-(--editor-context)"
        :title="`Bound to the ${owner.noun} ${ownBound.name}: click to edit it`"
        :aria-label="`Edit ${owner.noun} ${ownBound.name}`"
        data-binding-chip-open
        @click="editor.openProperties(ownBound.id)"
      >
        <UIcon
          name="i-lucide-diamond"
          class="size-3 shrink-0"
        />
        <span class="truncate">{{ ownBound.name }}</span>
      </button>
      <button
        type="button"
        class="grid h-full w-5 shrink-0 place-items-center rounded-e-md outline-none hover:bg-(--editor-context)/25 focus-visible:ring-1 focus-visible:ring-(--editor-context)"
        :title="`Unbind ${owner.noun}`"
        :aria-label="`Unbind ${owner.noun} ${ownBound.name}`"
        data-binding-chip-unbind
        @click="unbind(ownBound)"
      >
        <UIcon
          name="i-lucide-x"
          class="size-3"
        />
      </button>
    </div>
  </div>
  <slot v-else />
</template>
