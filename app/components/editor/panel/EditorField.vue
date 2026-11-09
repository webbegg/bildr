<script setup lang="ts">
/**
 * The Figma field shell for controls that are not scale fields (selects): a
 * borderless 24 px box on a subtle fill, ringed on hover and focus, with the
 * `prefix` slot (a letter or icon) in front. Scale fields draw the same box.
 */
</script>

<template>
  <div class="flex h-6 min-w-0 items-center rounded-[5px] bg-elevated ring-inset focus-within:ring-1 focus-within:ring-(color:--editor-selection) hover:ring-1 hover:ring-white/10">
    <div
      v-if="$slots.prefix"
      class="flex h-full shrink-0 items-center"
    >
      <slot name="prefix" />
    </div>
    <slot />
  </div>
</template>
