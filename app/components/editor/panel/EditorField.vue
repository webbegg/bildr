<script setup lang="ts">
/**
 * Framer's field shell for controls that are not scale fields (selects,
 * summaries): a soft borderless 30 px box, 8 px radius, filled a little
 * lighter than the panel and ringed on hover and focus. Scale fields draw the
 * same box.
 */
</script>

<template>
  <div class="flex h-[30px] min-w-0 items-center rounded-lg bg-elevated text-[13px] ring-inset focus-within:ring-1 focus-within:ring-(color:--editor-selection) hover:ring-1 hover:ring-white/10">
    <slot />
  </div>
</template>
