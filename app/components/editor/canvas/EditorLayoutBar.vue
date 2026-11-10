<script setup lang="ts">
import { layoutPages } from '~/composables/layoutEditor'

/**
 * The layout view's banner over the canvas: which layout is being edited,
 * how many pages the edits reach, and Done (or Escape with nothing
 * selected) to go back to the page.
 */
const editor = useEditor()
const pages = computed(() => (editor.project && editor.layout ? layoutPages(editor.project, editor.layout.id).length : 0))
</script>

<template>
  <div
    v-if="editor.layout"
    class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center"
  >
    <div
      class="pointer-events-auto flex items-center gap-2 rounded-xl bg-sky-500/15 py-1 ps-3 pe-1 text-[12px] text-highlighted ring-1 ring-sky-400/40 backdrop-blur"
      role="status"
      data-layout-view
    >
      <UIcon
        name="i-lucide-layout-template"
        class="size-4 text-sky-400"
      />
      <span>Editing layout <strong class="font-[550]">{{ editor.layout.name }}</strong></span>
      <span class="text-xs text-muted">{{ pages }} page{{ pages === 1 ? '' : 's' }}</span>
      <UButton
        label="Done"
        size="xs"
        color="neutral"
        variant="soft"
        aria-label="Leave the layout view"
        @click="editor.exitLayout()"
      />
    </div>
  </div>
</template>
