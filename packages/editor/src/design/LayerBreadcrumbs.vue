<script setup lang="ts">
import { useDesign } from './store.ts'

/** The path from the root of the file to the selected layer, under the canvas: a click selects that ancestor. */

const design = useDesign()
</script>

<template>
  <nav
    v-if="design.breadcrumbs.value.length"
    class="flex shrink-0 items-center gap-0.5 overflow-x-auto border-t border-default px-3 py-1 text-xs"
    aria-label="Selection"
    data-testid="breadcrumbs"
  >
    <template
      v-for="(crumb, index) in design.breadcrumbs.value"
      :key="crumb.id"
    >
      <UIcon
        v-if="index"
        name="i-lucide-chevron-right"
        class="size-3 shrink-0 text-muted"
      />
      <span data-testid="breadcrumb">
        <button
          type="button"
          :data-testid="`breadcrumb-${crumb.id}`"
          class="rounded-sm px-1 py-0.5 whitespace-nowrap hover:bg-elevated"
          :class="index === design.breadcrumbs.value.length - 1 ? 'font-medium text-default' : 'text-muted'"
          :aria-current="index === design.breadcrumbs.value.length - 1 ? 'true' : undefined"
          @click="design.select([crumb.id])"
        >{{ crumb.label }}</button>
      </span>
    </template>
  </nav>
</template>
