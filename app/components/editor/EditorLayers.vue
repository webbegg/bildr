<script setup lang="ts">
const editor = useEditor()
</script>

<template>
  <div class="flex flex-col">
    <p class="px-3 pt-3 pb-1 text-xs font-semibold text-muted uppercase">
      Layers
    </p>
    <div
      class="flex-1 overflow-y-auto pb-3"
      @mouseleave="editor.hoveredId = null"
    >
      <EditorLayerItem
        v-if="editor.page"
        :node="editor.page.root"
        :depth="0"
      />
    </div>
  </div>
</template>
