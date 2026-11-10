<script setup lang="ts">
/** The panel's sticky head, the inspector's: an icon, a bold title with an optional muted detail, and actions on the right. */
defineProps<{ icon: string, title: string, detail?: string }>()
</script>

<template>
  <div
    class="sticky top-0 z-10 border-b border-default bg-default"
    data-data-panel-head
  >
    <div class="flex h-11 items-center gap-1.5 ps-4 pe-2">
      <UIcon
        :name="icon"
        class="size-3.5 shrink-0 text-muted"
      />
      <p class="min-w-0 flex-1 truncate text-[13px] font-semibold text-highlighted">
        {{ title }} <span
          v-if="detail"
          class="ms-1 font-mono text-[11px] font-normal text-dimmed"
        >{{ detail }}</span>
      </p>
      <slot />
    </div>
  </div>
</template>
