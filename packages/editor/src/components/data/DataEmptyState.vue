<script setup lang="ts">
/**
 * The Data workspace's one empty state: an icon, a title, a line of text (the default slot) and
 * optionally actions. The start with no collection (`DataEmpty`), a connection or collection with
 * nothing to show in a tab (Endpoints, JSON) are all this.
 */
withDefaults(defineProps<{ icon: string, title: string, heading?: 'h2' | 'h3' }>(), { heading: 'h3' })
</script>

<template>
  <div class="flex size-full items-center justify-center p-6">
    <div class="flex max-w-sm flex-col items-center text-center">
      <div class="mb-4 flex size-12 items-center justify-center rounded-xl bg-white/6">
        <UIcon
          :name="icon"
          class="size-6 text-toned"
        />
      </div>
      <component
        :is="heading"
        class="text-base font-[550] text-highlighted"
      >
        {{ title }}
      </component>
      <p class="mt-1.5 text-[12px] text-muted">
        <slot />
      </p>
      <div
        v-if="$slots.actions"
        class="mt-5 flex items-center gap-2"
      >
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
