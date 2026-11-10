<script setup lang="ts">
import { componentUsages } from '#shared/document/usages'

/**
 * The component view's banner over the canvas: which component is being
 * edited, how many instances the edits reach, and Done (or Escape with
 * nothing selected) to go back to the page.
 */
const editor = useEditor()
const usages = computed(() => (editor.project && editor.component ? componentUsages(editor.project, editor.component.id).length : 0))
</script>

<template>
  <div
    v-if="editor.component"
    class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center"
  >
    <div
      class="pointer-events-auto flex items-center gap-2 rounded-xl bg-violet-500/15 py-1 ps-3 pe-1 text-[13px] text-highlighted ring-1 ring-violet-400/40 backdrop-blur"
      role="status"
      data-component-view
    >
      <UIcon
        name="i-lucide-component"
        class="size-4 text-violet-400"
      />
      <span>Editing <strong class="font-semibold">{{ editor.component.name }}</strong></span>
      <span class="text-xs text-muted">{{ usages }} instance{{ usages === 1 ? '' : 's' }}</span>
      <UButton
        label="Done"
        size="xs"
        color="neutral"
        variant="soft"
        aria-label="Leave the component view"
        @click="editor.exitComponent()"
      />
    </div>
  </div>
</template>
