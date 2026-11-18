<script setup lang="ts">
/**
 * The failure dot (S8): something in the Checks needs a look. Only decoration, so it is hidden from assistive technology; its reason (`checksSummary`) is said once,
 * by what holds it: the description of the toolbar's menu button, the text of the Checks entry of the menu. Style it where it sits (`class`: its margin).
 */
</script>

<template>
  <span
    class="inline-block size-1.5 shrink-0 rounded-full bg-error"
    aria-hidden="true"
    data-checks-dot
  />
</template>
