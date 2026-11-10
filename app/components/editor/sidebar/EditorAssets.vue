<script setup lang="ts">
/**
 * The Assets panel: Components (see `EditorComponents`), Layouts (see
 * `EditorLayouts`) and Styles (the
 * project theme, previewed live on the canvas, with an expandable token
 * preview sheet), filtered by the sidebar search.
 * Collections live in the Data view's sidebar.
 */
const { query = '' } = defineProps<{ query?: string }>()
const tokensOpen = ref(false)
</script>

<template>
  <div
    class="space-y-5 overflow-y-auto px-3 pt-2 pb-4"
    data-assets
  >
    <EditorComponents :query="query" />
    <EditorLayouts :query="query" />
    <section data-assets-styles>
      <p class="mb-2 text-[13px] font-semibold text-highlighted">
        Styles
      </p>
      <EditorDesignPanel :query="query" />
      <button
        type="button"
        class="mt-3 flex w-full items-center gap-1.5 text-[12px] text-muted hover:text-highlighted"
        :aria-expanded="tokensOpen"
        data-preview-tokens
        @click="tokensOpen = !tokensOpen"
      >
        <UIcon
          name="i-lucide-chevron-right"
          class="size-3 transition-transform"
          :class="{ 'rotate-90': tokensOpen }"
        />
        Preview tokens
      </button>
      <EditorCanvas
        v-if="tokensOpen"
        view="tokens"
        class="mt-2"
        style="height: 420px"
      />
    </section>
  </div>
</template>
