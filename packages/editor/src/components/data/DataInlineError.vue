<script setup lang="ts">
/**
 * The red box of the Data workspace's forms and dialogs that says what the module refused (`role="alert"`): a message in the
 * default slot, with the icon of a dialog when `icon` is set. Its position (margins, width) and its test hook (`data-…-error`) are the
 * caller's own, as attributes.
 */
const { icon = false } = defineProps<{ icon?: boolean }>()
</script>

<template>
  <p
    class="rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
    :class="{ 'flex items-start gap-2': icon }"
    role="alert"
  >
    <UIcon
      v-if="icon"
      name="i-lucide-circle-alert"
      class="size-4 shrink-0"
    />
    <slot />
  </p>
</template>
