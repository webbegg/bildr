<script setup lang="ts">
/**
 * The Assets panel: Components (see `EditorComponents`), Layouts (see
 * `EditorLayouts`) and one Design system row, which opens the Design view
 * (the theme, its style guide and the theme library); filtered by the
 * sidebar search. Collections live in the Data view's sidebar.
 */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()
const showDesign = computed(() => !query.trim() || 'design system styles theme'.includes(query.trim().toLowerCase()))
</script>

<template>
  <div
    class="space-y-5 overflow-y-auto px-3 pt-2 pb-4"
    data-assets
  >
    <EditorComponents :query="query" />
    <EditorLayouts :query="query" />
    <section
      v-if="showDesign"
      data-assets-design
    >
      <button
        type="button"
        class="flex h-8 w-full items-center gap-2 rounded-lg ps-1.5 pe-2 text-left text-sm text-toned hover:bg-white/4"
        data-assets-design-system
        @click="editor.mode = 'design'"
      >
        <UIcon
          name="i-lucide-swatch-book"
          class="size-4 shrink-0 text-pink-400"
        />
        <span class="truncate">Design system</span>
        <UIcon
          name="i-lucide-arrow-up-right"
          class="ms-auto size-3.5 shrink-0 text-dimmed"
        />
      </button>
    </section>
  </div>
</template>
