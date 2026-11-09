<script setup lang="ts">
defineProps<{ parentId: string }>()
</script>

<template>
  <div
    :data-bildr-placeholder="parentId"
    class="rounded-md border border-dashed border-accented p-4 text-center text-xs text-dimmed"
  >
    Drop components here
  </div>
</template>
