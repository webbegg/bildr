<script setup lang="ts">
import { BAR_CLASS } from './bar.ts'
import ViewMenu from './ViewMenu.vue'

/** The top bar of the screens that have no editor (Code, Checks, Migrations, Model): the same bar as the editor's toolbar (`BAR_CLASS`), holding ViewMenu, which renders the brand and the view menu. */
</script>

<template>
  <header
    class="flex items-center gap-1"
    :class="BAR_CLASS"
  >
    <ViewMenu />
  </header>
</template>
