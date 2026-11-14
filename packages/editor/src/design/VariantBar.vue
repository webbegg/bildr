<script setup lang="ts">
import { useDesign } from './store.ts'

/** Above the canvas of a component: one tab per variant, the one the canvas shows and edits record overrides in. */

const design = useDesign()
</script>

<template>
  <div
    v-if="design.component.value"
    class="flex shrink-0 flex-wrap items-center gap-1 border-b border-default px-3 py-1"
    data-testid="variant-bar"
  >
    <UButton
      data-testid="variant-tab-"
      label="default"
      size="xs"
      color="neutral"
      :variant="design.variantId.value === null ? 'soft' : 'ghost'"
      @click="design.selectVariant(null)"
    />
    <UButton
      v-for="variant in design.component.value.variants"
      :key="variant.id"
      :data-testid="`variant-tab-${variant.id}`"
      :label="variant.name"
      size="xs"
      color="neutral"
      :variant="design.variantId.value === variant.id ? 'soft' : 'ghost'"
      @click="design.selectVariant(variant.id)"
    />
  </div>
</template>
