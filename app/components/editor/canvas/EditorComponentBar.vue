<script setup lang="ts">
import { componentUsages } from '#shared/document/usages'
import { PRIMARY_VARIANT, variantItems } from '~/composables/componentVariants'

/**
 * The component view's banner over the canvas: which component is being
 * edited, how many instances the edits reach, which variant shows (and
 * takes prop and style edits) when it has variants, and Done (or Escape
 * with nothing selected) to go back to the page.
 */
const editor = useEditor()
const variantChoices = computed(() => (editor.component ? variantItems(editor.component) : []))
const usages = computed(() => (editor.project && editor.component ? componentUsages(editor.project, editor.component.id).length : 0))
</script>

<template>
  <div
    v-if="editor.component"
    class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center"
  >
    <div
      class="pointer-events-auto flex items-center gap-2 rounded-xl bg-violet-500/15 py-1 ps-3 pe-1 text-[12px] text-highlighted ring-1 ring-violet-400/40 backdrop-blur"
      role="status"
      data-component-view
    >
      <UIcon
        name="i-lucide-component"
        class="size-4 text-violet-400"
      />
      <span>Editing <strong class="font-[550]">{{ editor.component.name }}</strong></span>
      <span class="text-xs text-muted">{{ usages }} instance{{ usages === 1 ? '' : 's' }}</span>
      <USelect
        v-if="editor.component.variants.length"
        :model-value="editor.variant?.id ?? PRIMARY_VARIANT"
        :items="variantChoices"
        aria-label="Variant to show and edit"
        size="xs"
        variant="soft"
        :ui="SELECT_UI"
        class="w-32"
        data-component-view-variant
        @update:model-value="editor.selectVariant($event === PRIMARY_VARIANT ? null : $event)"
      />
      <UButton
        label="Done"
        size="xs"
        color="neutral"
        variant="soft"
        aria-label="Leave the component view"
        @click="editor.exitComponent()"
      />
    </div>
  </div>
</template>
