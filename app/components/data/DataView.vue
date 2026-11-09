<script setup lang="ts">
/** The Data mode centre: the shown collection's schema above its records. */
const editor = useEditor()
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4">
    <template v-if="editor.collection">
      <DataSchema />
      <DataRecords />
    </template>
    <div
      v-else
      class="flex flex-col items-center gap-2 py-24 text-center text-sm text-muted"
    >
      <UIcon
        name="i-lucide-database"
        class="size-8 text-dimmed"
      />
      <p>Collections hold your app's data, like a menu or contact messages.</p>
      <p class="text-xs text-dimmed">
        Add one from the sidebar.
      </p>
    </div>
  </div>
</template>
