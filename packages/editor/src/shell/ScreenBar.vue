<script setup lang="ts">
import ViewMenu from './ViewMenu.vue'

/** The top bar of the screens that have no editor (Code, Checks, Migrations, Model): the brand and the view menu, as in the editor's toolbar. */
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-1 border-b border-default px-2">
    <ViewMenu />
  </header>
</template>
