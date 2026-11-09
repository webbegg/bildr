<script setup lang="ts">
const editor = useEditor()
</script>

<template>
  <div class="p-3">
    <p class="text-xs font-semibold text-muted uppercase">
      Properties
    </p>
    <p
      v-if="!editor.selected"
      class="mt-3 text-sm text-dimmed"
    >
      Select a component on the canvas or in the layers.
    </p>
    <p
      v-else
      class="mt-3 text-sm"
    >
      {{ editor.selected.type }} <span class="text-dimmed">{{ editor.selected.id }}</span>
    </p>
  </div>
</template>
