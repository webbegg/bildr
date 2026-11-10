<script setup lang="ts">
/**
 * Framer's field shell for controls that are not scale fields (selects,
 * summaries): a soft borderless 30 px box, 8 px radius, filled a little
 * lighter than the panel and ringed on hover and focus (FIELD_SHELL in
 * editorUi.ts). Scale fields draw the same box.
 */
</script>

<template>
  <div :class="FIELD_SHELL">
    <slot />
  </div>
</template>
